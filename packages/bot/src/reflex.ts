import {
  computePropBounds,
  type Intent,
  type MapDefinition,
  MOVE_SPEED,
  type Observation,
  type ObservedEntity,
  type ObservedMap,
  type ObservedSelf,
  type Phase,
  type PropBounds,
  RUN_MULTIPLIER_HUNTER,
  RUN_MULTIPLIER_PROP,
  UNTRANSFORMED_PROP_HEIGHT,
  UNTRANSFORMED_PROP_RADIUS,
  type Visibility,
} from "@webhunt/shared";
import {
  buildObstacles,
  buildWalls,
  type Obstacle,
  resolveCollisions,
  type Wall,
} from "./collision";
import {
  AIM_TOLERANCE_RAD,
  AIM_TURN_RATE_MAX,
  AIM_TURN_RATE_MIN,
  ARRIVE_EPSILON,
  BOT_BODY_RADIUS,
  BOT_EYE_HEIGHT,
  BOT_FIRE_COOLDOWN_MS,
  BOT_HEARING_RADIUS,
  BOT_VISION_RANGE,
  DOORWAY_TILE_MARKER,
  ENGAGE_RANGE_MAX,
  ENGAGE_RANGE_MIN,
  FACING_CONE_COS,
  lerp,
  MAX_REPLANS_BEFORE_BLOCKED,
  MOVED_RECENTLY_MIN_DIST,
  MOVED_RECENTLY_MS,
  NAV_CELL_SIZE,
  NAV_SNAP_RADIUS_CELLS,
  NEARBY_PROP_RADIUS,
  PATH_REPLAN_MS,
  PATROL_PICK_ATTEMPTS,
  REACTION_MS_MAX,
  REACTION_MS_MIN,
  STUCK_PROGRESS_FRACTION,
  STUCK_TICK_LIMIT,
  TARGET_MOVE_REPLAN_CELLS,
  WAYPOINT_MARGIN,
} from "./config";
import { findPath } from "./nav/astar";
import {
  buildNavGrid,
  cellCenter,
  type NavGrid,
  nearestFreeCell,
  type Point2,
  worldToCell,
} from "./nav/grid";
import { PathFollower, smoothPath } from "./nav/path";
import { canHitTarget, lineOfSightClear, normalize3, type Vec3 } from "./raycast";
import type { BotPlayer } from "./view";

const STEER_MIN_DIST = 1e-4;

/** Wrap any angle into (-π, π] so rotation always takes the shortest path. */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const UNTRANSFORMED_BOUNDS: PropBounds = {
  radius: UNTRANSFORMED_PROP_RADIUS,
  yMin: 0,
  yMax: UNTRANSFORMED_PROP_HEIGHT,
};

/** What the bot perceives this tick; the reflex's input alongside the current intent. */
export interface ReflexWorld {
  phase: Phase;
  self: BotPlayer;
  others: BotPlayer[];
}

/** The synchronous motor commands the bot ships to the server this tick. */
export interface MotorOutput {
  input: { x: number; y: number; z: number; rot: number; aim: number };
  transformTo: string | null;
  shoot: { origin: Vec3; dir: Vec3 } | null;
}

interface MovementSample {
  x: number;
  z: number;
  lastMovedAt: number;
}

const HOLD = (x: number, z: number, rot: number): MotorOutput => ({
  input: { x, y: 0, z, rot, aim: rot },
  transformTo: null,
  shoot: null,
});

/**
 * The synchronous engine. It owns the bot's motor state (position, heading,
 * fire cooldown), the navigation grid, and path following, and exposes exactly
 * two operations: {@link buildObservation} (perception → the policy's input) and
 * {@link executeIntent} (the current intent → motor output, run every 20 Hz
 * tick). It never blocks and never decides *what* to do — only *how/when*.
 */
export class Reflex {
  private map: MapDefinition | null = null;
  private grid: NavGrid | null = null;
  private walls: Wall[] = [];
  private obstacles: Obstacle[] = [];
  private propBounds = new Map<string, PropBounds>();
  private doorways: Point2[] = [];

  private posX = 0;
  private posZ = 0;
  private rot = 0;
  private lastShotAt = 0;

  private readonly follower = new PathFollower();
  private pathGoal: Point2 | null = null;
  private patrolTarget: Point2 | null = null;
  private lastReplanAt = 0;
  private stuckTicks = 0;
  private replanCount = 0;
  private pathBlocked = false;
  private settled = false;
  private arrivalEdge = false;
  private blockedEdge = false;

  private aimTargetId: string | null = null;
  private aimAcquiredAt = 0;

  private readonly movement = new Map<string, MovementSample>();

  constructor(private readonly difficulty: number) {}

  get ready(): boolean {
    return this.grid !== null;
  }

  get x(): number {
    return this.posX;
  }

  get z(): number {
    return this.posZ;
  }

  /** Whether the bot has clear line of sight to a world point (eye height to eye
   * height) — the scheduler's cheap per-tick "new contact?" probe. */
  canSee(x: number, z: number): boolean {
    const map = this.map;
    if (!map) return false;
    const origin: Vec3 = { x: this.posX, y: BOT_EYE_HEIGHT, z: this.posZ };
    return lineOfSightClear(origin, { x, y: BOT_EYE_HEIGHT, z }, map.colliders);
  }

  /** Rebuild navigation from a freshly received map. One source of truth: the
   * grid is inflated from the same wall/obstacle arrays the physics resolves. */
  setMap(map: MapDefinition): void {
    this.map = map;
    this.walls = buildWalls(map);
    this.obstacles = buildObstacles(map);
    this.grid = buildNavGrid(map.bounds, this.walls, this.obstacles);
    this.propBounds = new Map(
      map.propCatalog.map((def) => [def.id, computePropBounds(def)] as const),
    );
    this.doorways = map.tiles
      .filter((tile) => tile.model.includes(DOORWAY_TILE_MARKER))
      .map((tile) => ({ x: tile.position.x, z: tile.position.z }));
    this.resetMotion();
    this.movement.clear();
    this.lastShotAt = 0;
  }

  syncPosition(x: number, z: number, rot?: number): void {
    this.posX = x;
    this.posZ = z;
    if (rot !== undefined) this.rot = rot;
  }

  /** Called when the scheduler swaps in a new intent: drop the stale path so the
   * next tick re-plans toward the new goal; keep patrol/aim continuity. */
  onIntentChanged(): void {
    this.resetMotion();
  }

  private resetMotion(): void {
    this.follower.clear();
    this.pathGoal = null;
    this.pathBlocked = false;
    this.settled = false;
    this.stuckTicks = 0;
    this.replanCount = 0;
    this.arrivalEdge = false;
    this.blockedEdge = false;
  }

  consumeArrivalEvent(): boolean {
    const v = this.arrivalEdge;
    this.arrivalEdge = false;
    return v;
  }

  consumeBlockedEvent(): boolean {
    const v = this.blockedEdge;
    this.blockedEdge = false;
    return v;
  }

  buildObservation(
    world: ReflexWorld,
    seq: number,
    visibility: Visibility,
    now: number,
  ): Observation {
    const self = world.self;
    const selfObs: ObservedSelf = {
      role: self.role,
      alive: self.alive,
      hp: self.hp,
      x: this.posX,
      z: this.posZ,
      rot: this.rot,
      propType: self.propType,
      canShootNow: now - this.lastShotAt >= BOT_FIRE_COOLDOWN_MS,
    };

    const origin: Vec3 = { x: this.posX, y: BOT_EYE_HEIGHT, z: this.posZ };
    const colliders = this.map?.colliders ?? [];
    const entities: ObservedEntity[] = [];
    for (const other of world.others) {
      const distance = Math.hypot(other.x - this.posX, other.z - this.posZ);
      const bounds = this.propBounds.get(other.propType) ?? UNTRANSFORMED_BOUNDS;
      const aimY = (bounds.yMin + bounds.yMax) / 2;
      const hasLineOfSight = lineOfSightClear(
        origin,
        { x: other.x, y: aimY, z: other.z },
        colliders,
      );
      const movedRecently = this.trackMovement(other, now);
      const looksLikeProp = other.propType !== "" && !movedRecently;
      const facingMe = hasLineOfSight && this.isAimedAtMe(other);
      if (visibility === "full") {
        entities.push({
          id: other.id,
          x: other.x,
          z: other.z,
          distance,
          hasLineOfSight,
          role: other.role,
          alive: other.alive,
          propType: other.propType,
          looksLikeProp,
          movedRecently,
          facingMe,
        });
        continue;
      }
      const sensed =
        (hasLineOfSight && distance <= BOT_VISION_RANGE) ||
        (movedRecently && distance <= BOT_HEARING_RADIUS);
      if (!sensed) continue;
      entities.push({
        id: other.id,
        x: other.x,
        z: other.z,
        distance,
        hasLineOfSight,
        looksLikeProp,
        movedRecently,
        facingMe,
      });
    }

    return {
      seq,
      visibility,
      phase: world.phase,
      pathBlocked: this.pathBlocked,
      self: selfObs,
      entities,
      map: this.buildObservedMap(),
    };
  }

  private buildObservedMap(): ObservedMap {
    const map = this.map;
    if (!map) {
      return {
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
        doorways: [],
        nearbyProps: [],
        propCatalogIds: [],
      };
    }
    const nearbyProps = map.props
      .filter(
        (p) => Math.hypot(p.position.x - this.posX, p.position.z - this.posZ) <= NEARBY_PROP_RADIUS,
      )
      .map((p) => ({ type: p.type, x: p.position.x, z: p.position.z }));
    return {
      bounds: map.bounds,
      doorways: this.doorways.map((d) => ({ x: d.x, z: d.z })),
      nearbyProps,
      propCatalogIds: map.propCatalog.map((def) => def.id),
    };
  }

  private trackMovement(other: BotPlayer, now: number): boolean {
    const prev = this.movement.get(other.id);
    if (!prev) {
      this.movement.set(other.id, { x: other.x, z: other.z, lastMovedAt: now });
      return false;
    }
    if (Math.hypot(other.x - prev.x, other.z - prev.z) > MOVED_RECENTLY_MIN_DIST) {
      prev.x = other.x;
      prev.z = other.z;
      prev.lastMovedAt = now;
    }
    return now - prev.lastMovedAt <= MOVED_RECENTLY_MS;
  }

  private isAimedAtMe(other: BotPlayer): boolean {
    const dx = this.posX - other.x;
    const dz = this.posZ - other.z;
    const len = Math.hypot(dx, dz);
    if (len < STEER_MIN_DIST) return true;
    return (Math.sin(other.aim) * dx + Math.cos(other.aim) * dz) / len >= FACING_CONE_COS;
  }

  executeIntent(intent: Intent, world: ReflexWorld, dt: number, now: number): MotorOutput {
    if (!this.grid || !this.map) return HOLD(this.posX, this.posZ, this.rot);
    const self = world.self;
    let transformTo: string | null = null;
    let shoot: MotorOutput["shoot"] = null;

    // Drop the aim lock whenever we are not actively shooting, so re-acquiring a
    // target after losing the shot re-arms the difficulty-scaled reaction gate.
    if (intent.kind !== "shootTarget") this.aimTargetId = null;

    switch (intent.kind) {
      case "idle":
      case "taunt":
      case "chat":
        break;
      case "transform":
        transformTo = self.propType !== intent.propType ? intent.propType : null;
        break;
      case "patrol":
        this.runPatrol(world, dt, now);
        break;
      case "moveTo":
        this.runMoveTo(intent.x, intent.z, intent.run, world, dt, now);
        break;
      case "hideAs":
        transformTo = self.propType !== intent.propType ? intent.propType : null;
        this.runHideAs(intent.x, intent.z, world, dt, now);
        break;
      case "inspect":
        this.runApproach(intent.targetId, false, world, dt, now);
        break;
      case "shootTarget":
        shoot = this.runShoot(intent.targetId, world, dt, now);
        break;
    }

    this.separateFromCrowd(world.others);
    return {
      input: { x: this.posX, y: 0, z: this.posZ, rot: this.rot, aim: this.rot },
      transformTo,
      shoot,
    };
  }

  /**
   * Nudge out of any overlapping player body and re-resolve against the static
   * world. Runs every tick — including while settled or frozen — because nothing
   * else separates one bot from another: the client only pushes the *local*
   * player apart and the server merely clamps. Mirrors the client's own
   * player-vs-player resolution so stacked disguises drift apart instead of
   * fusing into one silhouette.
   */
  private separateFromCrowd(others: readonly BotPlayer[]): void {
    if (!this.map) return;
    const minSep = BOT_BODY_RADIUS * 2;
    const minSepSq = minSep * minSep;
    let x = this.posX;
    let z = this.posZ;
    let pushed = false;
    for (const other of others) {
      if (!other.alive) continue;
      const dx = x - other.x;
      const dz = z - other.z;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minSepSq) continue;
      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const scale = (minSep - dist) / dist;
        x += dx * scale;
        z += dz * scale;
      } else {
        x += Math.sin(this.rot) * minSep;
        z += Math.cos(this.rot) * minSep;
      }
      pushed = true;
    }
    if (!pushed) return;
    const resolved = resolveCollisions({ x, z }, this.walls, this.obstacles, this.map.bounds);
    this.posX = resolved.x;
    this.posZ = resolved.z;
  }

  private runMoveTo(
    gx: number,
    gz: number,
    run: boolean,
    world: ReflexWorld,
    dt: number,
    now: number,
  ): void {
    this.runStatic(gx, gz, run, world.self.role, dt, now);
  }

  private runHideAs(gx: number, gz: number, world: ReflexWorld, dt: number, now: number): void {
    this.runStatic(gx, gz, world.phase === "hiding", world.self.role, dt, now);
  }

  /**
   * Move toward a fixed goal, then *stay put*. Once the planned path is consumed
   * (or the exact goal is reached), the goal is "settled": the bot holds still and
   * stops re-planning until the intent changes. Settling on path-exhaustion — not
   * on a tight epsilon against the policy's exact coordinate — is what stops the
   * back-and-forth jitter when a hide spot lands on a cell centre or inside the
   * inflated furniture ring it can't quite touch.
   */
  private runStatic(
    gx: number,
    gz: number,
    run: boolean,
    role: BotPlayer["role"],
    dt: number,
    now: number,
  ): void {
    if (this.settled) return;
    if (this.arrivedAt(gx, gz)) {
      this.settle();
      return;
    }
    this.ensurePath(gx, gz, now, false);
    const wp = this.follower.advance(this.posX, this.posZ);
    if (wp) {
      this.steer(wp, run, role, dt);
      return;
    }
    if (!this.pathBlocked) this.settle();
  }

  private runPatrol(world: ReflexWorld, dt: number, now: number): void {
    const t = this.patrolTarget;
    if (!t || this.arrivedAt(t.x, t.z) || this.pathBlocked) {
      this.pickPatrolTarget();
    }
    const target = this.patrolTarget;
    if (!target) return;
    this.ensurePath(target.x, target.z, now, false);
    const wp = this.follower.advance(this.posX, this.posZ);
    if (wp) this.steer(wp, false, world.self.role, dt);
  }

  private runApproach(
    targetId: string,
    run: boolean,
    world: ReflexWorld,
    dt: number,
    now: number,
  ): void {
    const target = world.others.find((o) => o.id === targetId);
    if (!target || !target.alive) return;
    this.ensurePath(target.x, target.z, now, true);
    const wp = this.follower.advance(this.posX, this.posZ);
    if (wp) this.steer(wp, run, world.self.role, dt);
    else this.faceToward(target.x, target.z);
  }

  private runShoot(
    targetId: string,
    world: ReflexWorld,
    dt: number,
    now: number,
  ): MotorOutput["shoot"] {
    const map = this.map;
    const target = world.others.find((o) => o.id === targetId);
    if (!target || !target.alive || !map) {
      this.aimTargetId = null;
      return null;
    }
    const origin: Vec3 = { x: this.posX, y: BOT_EYE_HEIGHT, z: this.posZ };
    const bounds = this.propBounds.get(target.propType) ?? UNTRANSFORMED_BOUNDS;
    const aimY = (bounds.yMin + bounds.yMax) / 2;
    const dir = normalize3({ x: target.x - origin.x, y: aimY - origin.y, z: target.z - origin.z });
    const dist = Math.hypot(target.x - this.posX, target.z - this.posZ);
    const engageRange = lerp(ENGAGE_RANGE_MIN, ENGAGE_RANGE_MAX, this.difficulty);
    const canHit =
      dir !== null &&
      dist <= engageRange &&
      canHitTarget(origin, dir, target.x, target.z, bounds, map.colliders);

    if (canHit && dir) {
      this.follower.clear();
      const turnRate = lerp(AIM_TURN_RATE_MIN, AIM_TURN_RATE_MAX, this.difficulty);
      const aimError = this.turnToward(target.x, target.z, turnRate * dt);
      if (aimError > AIM_TOLERANCE_RAD) {
        this.aimTargetId = null;
        return null;
      }
      if (this.aimTargetId !== target.id) {
        this.aimTargetId = target.id;
        this.aimAcquiredAt = now;
      }
      const reactionMs = lerp(REACTION_MS_MAX, REACTION_MS_MIN, this.difficulty);
      const ready = now - this.aimAcquiredAt >= reactionMs;
      if (ready && now - this.lastShotAt >= BOT_FIRE_COOLDOWN_MS) {
        this.lastShotAt = now;
        return { origin, dir };
      }
      return null;
    }

    this.aimTargetId = null;
    this.ensurePath(target.x, target.z, now, true);
    const wp = this.follower.advance(this.posX, this.posZ);
    if (wp) this.steer(wp, true, world.self.role, dt);
    else this.faceToward(target.x, target.z);
    return null;
  }

  private arrivedAt(gx: number, gz: number): boolean {
    return Math.hypot(this.posX - gx, this.posZ - gz) <= ARRIVE_EPSILON;
  }

  private settle(): void {
    if (!this.settled) this.arrivalEdge = true;
    this.settled = true;
    this.follower.clear();
  }

  private faceToward(tx: number, tz: number): void {
    this.rot = Math.atan2(tx - this.posX, tz - this.posZ);
  }

  /** Rotate at most `maxStep` radians toward (tx,tz); returns the angular error still remaining. */
  private turnToward(tx: number, tz: number, maxStep: number): number {
    const desired = Math.atan2(tx - this.posX, tz - this.posZ);
    const delta = wrapAngle(desired - this.rot);
    const step = Math.max(-maxStep, Math.min(maxStep, delta));
    this.rot = wrapAngle(this.rot + step);
    return Math.abs(delta - step);
  }

  private pickPatrolTarget(): void {
    const grid = this.grid;
    const map = this.map;
    if (!grid || !map) {
      this.patrolTarget = null;
      return;
    }
    const b = map.bounds;
    for (let attempt = 0; attempt < PATROL_PICK_ATTEMPTS; attempt++) {
      const x = lerp(b.min.x + WAYPOINT_MARGIN, b.max.x - WAYPOINT_MARGIN, Math.random());
      const z = lerp(b.min.z + WAYPOINT_MARGIN, b.max.z - WAYPOINT_MARGIN, Math.random());
      const free = nearestFreeCell(grid, worldToCell(grid, x, z), NAV_SNAP_RADIUS_CELLS);
      if (free) {
        this.patrolTarget = cellCenter(grid, free);
        this.pathBlocked = false;
        return;
      }
    }
    this.patrolTarget = null;
  }

  private ensurePath(gx: number, gz: number, now: number, dynamic: boolean): void {
    const cell = this.grid?.cellSize ?? NAV_CELL_SIZE;
    const goalMoved =
      this.pathGoal === null ||
      Math.hypot(this.pathGoal.x - gx, this.pathGoal.z - gz) > cell * TARGET_MOVE_REPLAN_CELLS;
    const sinceReplan = now - this.lastReplanAt;
    let replan = false;
    if (goalMoved) replan = true;
    else if (this.pathBlocked) replan = sinceReplan >= PATH_REPLAN_MS;
    else if (!this.follower.hasPath) replan = true;
    else if (this.stuckTicks >= STUCK_TICK_LIMIT) replan = true;
    else if (dynamic && sinceReplan >= PATH_REPLAN_MS) replan = true;
    if (replan) this.planTo(gx, gz, now);
  }

  private planTo(gx: number, gz: number, now: number): void {
    this.lastReplanAt = now;
    this.stuckTicks = 0;
    this.pathGoal = { x: gx, z: gz };
    const grid = this.grid;
    if (!grid) {
      this.failPath();
      return;
    }
    const start = nearestFreeCell(
      grid,
      worldToCell(grid, this.posX, this.posZ),
      NAV_SNAP_RADIUS_CELLS,
    );
    const goal = nearestFreeCell(grid, worldToCell(grid, gx, gz), NAV_SNAP_RADIUS_CELLS);
    if (!start || !goal) {
      this.failPath();
      return;
    }
    const cells = findPath(grid, start, goal);
    if (!cells) {
      this.failPath();
      return;
    }
    this.follower.setPath(smoothPath(grid, cells));
    this.pathBlocked = false;
    this.replanCount = 0;
  }

  private failPath(): void {
    this.follower.clear();
    this.replanCount += 1;
    if (this.replanCount >= MAX_REPLANS_BEFORE_BLOCKED && !this.pathBlocked) {
      this.pathBlocked = true;
      this.blockedEdge = true;
    }
  }

  private steer(target: Point2, run: boolean, role: BotPlayer["role"], dt: number): void {
    const toX = target.x - this.posX;
    const toZ = target.z - this.posZ;
    const dist = Math.hypot(toX, toZ);
    if (dist <= STEER_MIN_DIST) return;
    const dirX = toX / dist;
    const dirZ = toZ / dist;
    const runMult = role === "hunter" ? RUN_MULTIPLIER_HUNTER : RUN_MULTIPLIER_PROP;
    const speed = MOVE_SPEED * (run ? runMult : 1);
    const step = Math.min(dist, speed * dt);
    const prevX = this.posX;
    const prevZ = this.posZ;
    const resolved = resolveCollisions(
      { x: this.posX + dirX * step, z: this.posZ + dirZ * step },
      this.walls,
      this.obstacles,
      this.map!.bounds,
    );
    this.posX = resolved.x;
    this.posZ = resolved.z;
    this.rot = Math.atan2(dirX, dirZ);
    const moved = Math.hypot(this.posX - prevX, this.posZ - prevZ);
    if (step > STEER_MIN_DIST && moved < step * STUCK_PROGRESS_FRACTION) this.stuckTicks += 1;
    else this.stuckTicks = 0;
  }
}
