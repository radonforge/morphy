import {
  type BotAct,
  computePropBounds,
  type InputMessage,
  type Intent,
  isDisguise,
  type MapDefinition,
  MOVE_SPEED,
  type Observation,
  type ObservedEntity,
  type ObservedMap,
  type ObservedSelf,
  type ObservedSound,
  type Phase,
  type PropBounds,
  type PropInstance,
  RUN_MULTIPLIER_HUNTER,
  RUN_MULTIPLIER_PROP,
  SONAR_COOLDOWN_MS,
  SONAR_HEARING_RADIUS,
  type SoundKind,
  TAUNT_COOLDOWN_MS,
  TAUNT_HEARING_RADIUS,
  UNTRANSFORMED_PROP_HEIGHT,
  UNTRANSFORMED_PROP_RADIUS,
  type Visibility,
} from "@morphy/shared";
import {
  aimSpread,
  directionOf,
  driftStep,
  fireChance,
  followUpDelayMs,
  gaussian,
  lateralSpeed,
  overshootRad,
  type Rng,
  reactionDelayMs,
  VelocityEstimate,
} from "./aim";
import {
  buildObstacles,
  buildWalls,
  type Obstacle,
  resolveCollisions,
  type Wall,
} from "./collision";
import {
  AIM_OVERSHOOT_SETTLE_RAD,
  AIM_PITCH_SPREAD_SHARE,
  AIM_TRIGGER_TICK_S,
  AIM_TURN_RATE_MAX,
  AIM_TURN_RATE_MIN,
  ARRIVE_EPSILON,
  BOT_BODY_RADIUS,
  BOT_EYE_HEIGHT,
  BOT_FIRE_COOLDOWN_MS,
  BOT_HEARING_RADIUS,
  BOT_PROBE_INTERVAL_MAX_MS,
  BOT_PROBE_INTERVAL_MIN_MS,
  BOT_PROBE_RETRY_MS,
  BOT_TELL_MATCH_RADIUS,
  BOT_TELL_WINDOW_MS,
  BOT_VISION_RANGE,
  DOORWAY_TILE_MARKER,
  ENGAGE_RANGE_MAX,
  ENGAGE_RANGE_MIN,
  FACING_CONE_COS,
  HEARD_POSITION_CELL,
  HEARD_SOUND_MEMORY_MS,
  lerp,
  MAX_REPLANS_BEFORE_BLOCKED,
  MOVED_RECENTLY_MIN_DIST,
  MOVED_RECENTLY_MIN_TURN_RAD,
  MOVED_RECENTLY_MS,
  NAV_CELL_SIZE,
  NAV_SNAP_RADIUS_CELLS,
  NEARBY_PROP_RADIUS,
  PATH_REPLAN_MS,
  PATROL_PICK_ATTEMPTS,
  STUCK_PROGRESS_FRACTION,
  STUCK_TICK_LIMIT,
  TARGET_MOVE_REPLAN_CELLS,
  WAYPOINT_MARGIN,
} from "./config";
import { ContactHandles, decoySource, playerSource, scenePropSource } from "./contacts";
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
import type { BotDecoy, BotPlayer } from "./view";

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
  decoys: BotDecoy[];
}

/** The synchronous motor commands the bot ships to the server this tick. */
export interface MotorOutput {
  input: InputMessage;
  shoot: { dir: Vec3 } | null;
}

/**
 * Something an intent can name as its target: a player, a decoy or a scene
 * prop. The last two never move, so they can be seen but never heard.
 */
interface Contact {
  source: string;
  x: number;
  y: number;
  z: number;
  propType: string;
  /** The player behind the contact, whose movement can be heard; null for a decoy or a scene prop. */
  playerId: string | null;
}

/** A sound as the bot heard it, fixed where and when it was heard. */
interface HeardSound {
  id: string;
  kind: SoundKind;
  x: number;
  z: number;
  hasLineOfSight: boolean;
  heardAt: number;
}

/** How far each kind of sound carries: the distance a player's client stops playing it at. */
const HEARING_RANGE: Record<SoundKind, number> = {
  taunt: TAUNT_HEARING_RADIUS,
  sonar: SONAR_HEARING_RADIUS,
};

interface MovementSample {
  x: number;
  z: number;
  /** Which way the disguise faces; a spin in place is movement too. */
  rot: number;
  /** Null until the contact has actually been seen to move. */
  lastMovedAt: number | null;
}

/** A contact the bot perceives this observation, before it is handed its handle. */
interface Sensed {
  source: string;
  entity: Omit<ObservedEntity, "id">;
}

const HOLD = (x: number, z: number, rot: number): MotorOutput => ({
  input: { x, y: 0, z, rot, aim: rot, propRot: rot },
  shoot: null,
});

/**
 * The synchronous engine. It owns the bot's motor state (position, heading,
 * fire cooldown), the navigation grid, and path following, and exposes exactly
 * two operations: {@link buildObservation} (perception → the policy's input) and
 * {@link executeIntent} (the current intent → motor output, run every 20 Hz
 * tick). It never blocks and never decides *what* to do, only *how/when*.
 */
export class Reflex {
  private map: MapDefinition | null = null;
  private grid: NavGrid | null = null;
  private walls: Wall[] = [];
  private obstacles: Obstacle[] = [];
  private activeObstacles: Obstacle[] = [];
  private propBounds = new Map<string, PropBounds>();
  private sceneProps = new Map<string, PropInstance>();
  private doorways: Point2[] = [];

  private posX = 0;
  private posZ = 0;
  private rot = 0;
  private lastShotAt = 0;
  private lastShotTargetId: string | null = null;
  private probeMissed = false;

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
  private fireReadyAt = 0;
  private aimDrift = 0;
  private overshoot = 0;
  private readonly targetVelocity = new VelocityEstimate();
  private readonly selfVelocity = new VelocityEstimate();

  private readonly movement = new Map<string, MovementSample>();
  private readonly lastPerceived = new Map<string, Point2>();
  /** When each contact last gave itself away; see {@link toldRecently}. */
  private readonly tellAt = new Map<string, number>();
  /** Each player's disguise as last observed, so a change of shape can be noticed. */
  private readonly shapes = new Map<string, string>();
  private readonly handles = new ContactHandles();
  private heard: HeardSound[] = [];
  private soundSeq = 0;
  private heardEdge = false;
  private readonly pressedAt = new Map<BotAct, number>();

  /** `rng` draws the aim's noise; tests pass a seeded `makeRng` to replay it. */
  constructor(
    private readonly difficulty: number,
    private readonly visibility: Visibility,
    private readonly rng: Rng = Math.random,
  ) {}

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
   * height): the scheduler's cheap per-tick "new contact?" probe. */
  canSee(x: number, y: number, z: number): boolean {
    return this.canSeePoint(x, y + BOT_EYE_HEIGHT, z);
  }

  /** As {@link canSee}, for a point already at an absolute world height. */
  private canSeePoint(x: number, y: number, z: number): boolean {
    const map = this.map;
    if (!map) return false;
    const origin: Vec3 = { x: this.posX, y: BOT_EYE_HEIGHT, z: this.posZ };
    return lineOfSightClear(origin, { x, y, z }, map.colliders);
  }

  /**
   * Where the bot may believe a contact is. A contact in line of sight is at its
   * true position; one known only because it was *heard* is snapped to a
   * {@link HEARD_POSITION_CELL} cell, so a noise through a wall yields a
   * neighbourhood to search rather than a point to walk onto. A human hearing
   * footsteps gets a rough direction, and this is the one place a filling bot
   * still knew better.
   *
   * `"full"` visibility keeps ground truth: it is the measuring anchor, not a
   * mode any live room runs.
   */
  private sensedPosition(
    other: { readonly x: number; readonly z: number },
    hasLineOfSight: boolean,
  ): Point2 {
    if (this.visibility === "full" || hasLineOfSight) return { x: other.x, z: other.z };
    return {
      x: Math.round(other.x / HEARD_POSITION_CELL) * HEARD_POSITION_CELL,
      z: Math.round(other.z / HEARD_POSITION_CELL) * HEARD_POSITION_CELL,
    };
  }

  /** Rebuild navigation from a freshly received map. One source of truth: the
   * grid is inflated from the same wall/obstacle arrays the physics resolves. */
  setMap(map: MapDefinition): void {
    this.map = map;
    this.walls = buildWalls(map);
    this.obstacles = buildObstacles(map);
    this.activeObstacles = this.obstacles;
    this.grid = buildNavGrid(map.bounds, this.walls, this.obstacles);
    this.propBounds = new Map(
      map.propCatalog.map((def) => [def.id, computePropBounds(def)] as const),
    );
    const worn = new Set(map.propCatalog.filter(isDisguise).map((def) => def.id));
    this.sceneProps = new Map(
      map.props.flatMap((prop, index) =>
        worn.has(prop.type) ? [[scenePropSource(index), prop] as const] : [],
      ),
    );
    this.doorways = map.tiles
      .filter((tile) => tile.model.includes(DOORWAY_TILE_MARKER))
      .map((tile) => ({ x: tile.position.x, z: tile.position.z }));
    this.resetMotion();
    this.forgetContacts();
    this.lastShotAt = 0;
  }

  /**
   * Drop every contact handle, last sighting, movement sample, tell and heard
   * sound, and the aim on and record of whatever was last fired at, as a new
   * round begins: handles restart, so a record kept would name another
   * contact. A sample kept from before the props hid would read every prop
   * that walked to its spot as one seen moving the moment the hunt opens.
   */
  forgetContacts(): void {
    this.aimTargetId = null;
    this.overshoot = 0;
    this.aimDrift = 0;
    this.targetVelocity.reset();
    this.lastPerceived.clear();
    this.movement.clear();
    this.tellAt.clear();
    this.shapes.clear();
    this.handles.clear();
    this.heard = [];
    this.lastShotTargetId = null;
    this.probeMissed = false;
  }

  /**
   * Take in a sound the room played at (x, z), if it carries this far. It is
   * placed the way footsteps are: exactly when the spot is in line of sight,
   * and only to a neighbourhood otherwise, which is what a panned honk tells a
   * player through a wall.
   */
  hear(kind: SoundKind, x: number, z: number, now: number): void {
    this.forgetOldSounds(now);
    if (Math.hypot(x - this.posX, z - this.posZ) > HEARING_RANGE[kind]) return;
    const hasLineOfSight = this.canSee(x, 0, z);
    const at = this.sensedPosition({ x, z }, hasLineOfSight);
    this.heard.push({
      id: `s${++this.soundSeq}`,
      kind,
      x: at.x,
      z: at.z,
      hasLineOfSight,
      heardAt: now,
    });
    this.heardEdge = true;
  }

  consumeHeardEvent(): boolean {
    const v = this.heardEdge;
    this.heardEdge = false;
    return v;
  }

  /** Record a key the bot pressed, for the cooldowns its own HUD would show. */
  notePressed(act: BotAct, now: number): void {
    this.pressedAt.set(act, now);
  }

  private sincePressed(act: BotAct, now: number): number {
    return now - (this.pressedAt.get(act) ?? Number.NEGATIVE_INFINITY);
  }

  private forgetOldSounds(now: number): void {
    this.heard = this.heard.filter((sound) => now - sound.heardAt <= HEARD_SOUND_MEMORY_MS);
  }

  private observeSounds(now: number): ObservedSound[] {
    this.forgetOldSounds(now);
    return this.heard.map((sound) => ({
      id: sound.id,
      kind: sound.kind,
      x: sound.x,
      z: sound.z,
      distance: Math.hypot(sound.x - this.posX, sound.z - this.posZ),
      hasLineOfSight: sound.hasLineOfSight,
      ageMs: now - sound.heardAt,
    }));
  }

  /** Adopt an authoritative position; a path planned from anywhere else is dropped with it. */
  syncPosition(x: number, z: number, rot?: number): void {
    this.posX = x;
    this.posZ = z;
    if (rot !== undefined) this.rot = rot;
    this.selfVelocity.reset();
    this.resetMotion();
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

  /**
   * What the bot perceives right now. A limited-vision hunter perceives nothing
   * while the props hide, because a player hunter stares at a blindout card for
   * that whole phase: a bot that watched the props walk to their spots started
   * the hunt knowing where each one stood.
   */
  buildObservation(world: ReflexWorld, seq: number, now: number): Observation {
    const self = world.self;
    const probeInterval = lerp(
      BOT_PROBE_INTERVAL_MAX_MS,
      BOT_PROBE_INTERVAL_MIN_MS,
      this.difficulty,
    );
    const selfObs: ObservedSelf = {
      role: self.role,
      alive: self.alive,
      hp: self.hp,
      x: this.posX,
      z: this.posZ,
      rot: this.rot,
      propType: self.propType,
      canShootNow: now - this.lastShotAt >= BOT_FIRE_COOLDOWN_MS,
      canTauntNow: this.sincePressed("taunt", now) >= TAUNT_COOLDOWN_MS,
      canSonarNow: this.sincePressed("sonar", now) >= SONAR_COOLDOWN_MS,
      canProbeNow: now - this.lastShotAt >= (this.probeMissed ? BOT_PROBE_RETRY_MS : probeInterval),
      lastShotTargetId: this.lastShotTargetId,
    };
    this.forgetDeparted(world.others, world.decoys);
    const blind =
      this.visibility === "limited" && self.role === "hunter" && world.phase === "hiding";
    let entities: ObservedEntity[] = [];
    if (!blind) {
      entities =
        this.visibility === "full" ? this.observeFull(world, now) : this.observeLimited(world, now);
    }

    return {
      seq,
      visibility: this.visibility,
      phase: world.phase,
      pathBlocked: this.pathBlocked,
      arrived: this.settled,
      self: selfObs,
      entities,
      sounds: blind ? [] : this.observeSounds(now),
      map: this.buildObservedMap(),
    };
  }

  /** Whether the bot sees the middle of a body of this shape standing at (x, y, z). */
  private seesBody(x: number, y: number, z: number, propType: string): boolean {
    const bounds = this.propBounds.get(propType) ?? UNTRANSFORMED_BOUNDS;
    const origin: Vec3 = { x: this.posX, y: BOT_EYE_HEIGHT, z: this.posZ };
    const target: Vec3 = { x, y: y + (bounds.yMin + bounds.yMax) / 2, z };
    return lineOfSightClear(origin, target, this.map?.colliders ?? []);
  }

  /** Ground truth for every live player: the measuring anchor, never a live room's mode. */
  private observeFull(world: ReflexWorld, now: number): ObservedEntity[] {
    const entities: ObservedEntity[] = [];
    for (const other of world.others) {
      if (!other.alive) continue;
      const hasLineOfSight = this.seesBody(other.x, other.y, other.z, other.propType);
      entities.push({
        id: other.id,
        x: other.x,
        z: other.z,
        distance: Math.hypot(other.x - this.posX, other.z - this.posZ),
        hasLineOfSight,
        role: other.role,
        alive: other.alive,
        propType: other.propType,
        disguised: other.propType !== "",
        movedRecently: this.trackMovement(other, now),
        facingMe: hasLineOfSight && this.isAimedAtMe(other),
      });
    }
    return entities;
  }

  /**
   * What a player would read off the screen: players in sight or earshot,
   * decoys in sight and, for a hunter, every scene prop in sight, with handles
   * dealt nearest first so the order they are named in says nothing about what
   * they are.
   */
  private observeLimited(world: ReflexWorld, now: number): ObservedEntity[] {
    const sensed: Sensed[] = [];
    for (const other of world.others) {
      if (!other.alive) continue;
      const contact = this.observePlayer(other, now);
      if (contact) sensed.push(contact);
    }
    sensed.push(...this.observeDecoys(world.decoys, now));
    if (world.self.role === "hunter") sensed.push(...this.observeSceneProps(now));
    sensed.sort((a, b) => a.entity.distance - b.entity.distance);
    return sensed.map(({ source, entity }) => ({ id: this.handles.handleFor(source), ...entity }));
  }

  private observePlayer(other: BotPlayer, now: number): Sensed | null {
    const distance = Math.hypot(other.x - this.posX, other.z - this.posZ);
    const hasLineOfSight = this.seesBody(other.x, other.y, other.z, other.propType);
    const movedRecently = this.trackMovement(other, now);
    const disguised = other.propType !== "";
    const source = playerSource(other.id);
    const previousShape = this.shapes.get(other.id);
    this.shapes.set(other.id, other.propType);
    const morphed =
      previousShape !== undefined && previousShape !== "" && previousShape !== other.propType;
    if (hasLineOfSight && disguised && (movedRecently || morphed)) this.tellAt.set(source, now);
    const sensed =
      (hasLineOfSight && distance <= BOT_VISION_RANGE) ||
      (movedRecently && distance <= BOT_HEARING_RADIUS);
    if (!sensed) return null;
    const at = this.sensedPosition(other, hasLineOfSight);
    this.lastPerceived.set(source, at);
    return {
      source,
      entity: {
        x: at.x,
        z: at.z,
        distance: Math.hypot(at.x - this.posX, at.z - this.posZ),
        hasLineOfSight,
        disguised: hasLineOfSight ? disguised : undefined,
        movedRecently,
        facingMe: hasLineOfSight && !disguised && this.isAimedAtMe(other),
        tellRecently: hasLineOfSight && disguised ? this.toldRecently(source, at, now) : undefined,
      },
    };
  }

  /**
   * Decoys in sight, listed exactly as a disguised player standing still would
   * be: a decoy is built to be mistaken for one, and a human hunter pays for
   * that mistake, so a bot must be able to make it too. Only sight senses one;
   * it never moves, so it is never heard. `facingMe` is false for it and for
   * every other disguise alike, because a player cannot see where a disguise is
   * looking.
   */
  private observeDecoys(decoys: readonly BotDecoy[], now: number): Sensed[] {
    const seen: Sensed[] = [];
    for (const decoy of decoys) {
      const at = { x: decoy.x, z: decoy.z };
      const contact = this.stillDisguise(decoySource(decoy.id), at, decoy.y, decoy.propType, now);
      if (contact) seen.push(contact);
    }
    return seen;
  }

  /**
   * The furniture a hunter looks at, listed exactly as a disguised player
   * standing still would be. Every scene prop a player can wear (decor is left out)
   * is a shape from the catalog, so to a player a still disguise is one more object in the
   * room until it moves, honks or is shot; a hunter shown only players knew
   * every disguise in sight was one, and shot it on sight.
   */
  private observeSceneProps(now: number): Sensed[] {
    const seen: Sensed[] = [];
    for (const [source, prop] of this.sceneProps) {
      const at = { x: prop.position.x, z: prop.position.z };
      const contact = this.stillDisguise(source, at, prop.position.y, prop.type, now);
      if (contact) seen.push(contact);
    }
    return seen;
  }

  /** A shape that never moves, if it stands in sight within vision range. */
  private stillDisguise(
    source: string,
    at: Point2,
    y: number,
    propType: string,
    now: number,
  ): Sensed | null {
    const distance = Math.hypot(at.x - this.posX, at.z - this.posZ);
    if (distance > BOT_VISION_RANGE) return null;
    if (!this.seesBody(at.x, y, at.z, propType)) return null;
    this.lastPerceived.set(source, at);
    return {
      source,
      entity: {
        x: at.x,
        z: at.z,
        distance,
        hasLineOfSight: true,
        disguised: true,
        movedRecently: false,
        facingMe: false,
        tellRecently: this.toldRecently(source, at, now),
      },
    };
  }

  /**
   * Whether a contact in sight gave itself away within {@link BOT_TELL_WINDOW_MS}.
   * Movement and a change of shape are noted as they are observed; a honk is
   * pinned on whatever stands within {@link BOT_TELL_MATCH_RADIUS} of where it
   * was seen, which is also how a player can pin one on the wrong crate.
   */
  private toldRecently(source: string, at: Point2, now: number): boolean {
    for (const sound of this.heard) {
      if (sound.kind !== "taunt" || !sound.hasLineOfSight) continue;
      if (Math.hypot(sound.x - at.x, sound.z - at.z) > BOT_TELL_MATCH_RADIUS) continue;
      if (sound.heardAt > (this.tellAt.get(source) ?? Number.NEGATIVE_INFINITY)) {
        this.tellAt.set(source, sound.heardAt);
      }
    }
    const told = this.tellAt.get(source);
    return told !== undefined && now - told <= BOT_TELL_WINDOW_MS;
  }

  private buildObservedMap(): ObservedMap {
    const map = this.map;
    if (!map) {
      return {
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
        doorways: [],
        nearbyProps: [],
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
    };
  }

  private trackMovement(other: BotPlayer, now: number): boolean {
    const prev = this.movement.get(other.id);
    if (!prev) {
      this.movement.set(other.id, {
        x: other.x,
        z: other.z,
        rot: other.propRot,
        lastMovedAt: null,
      });
      return false;
    }
    const stepped = Math.hypot(other.x - prev.x, other.z - prev.z) > MOVED_RECENTLY_MIN_DIST;
    const spun =
      other.propType !== "" &&
      Math.abs(wrapAngle(other.propRot - prev.rot)) > MOVED_RECENTLY_MIN_TURN_RAD;
    if (stepped || spun) {
      prev.x = other.x;
      prev.z = other.z;
      prev.rot = other.propRot;
      prev.lastMovedAt = now;
    }
    return this.movedRecently(other.id, now);
  }

  /** As {@link trackMovement}, without recording a sample: a query the motor can
   * run every tick without disturbing the movement history the observation reads. */
  private movedRecently(id: string, now: number): boolean {
    const prev = this.movement.get(id);
    if (prev === undefined || prev.lastMovedAt === null) return false;
    return now - prev.lastMovedAt <= MOVED_RECENTLY_MS;
  }

  /**
   * Drop what the bot remembers about players who have left the room and
   * decoys that have broken. These maps were only ever cleared with the map, so
   * a long session accumulated an entry per player who ever appeared, and a
   * returning id would be measured against a sample from its previous life.
   */
  private forgetDeparted(others: readonly BotPlayer[], decoys: readonly BotDecoy[]): void {
    const present = new Set(others.map((o) => o.id));
    for (const id of [...this.movement.keys()]) {
      if (!present.has(id)) this.movement.delete(id);
    }
    for (const id of [...this.shapes.keys()]) {
      if (!present.has(id)) this.shapes.delete(id);
    }
    const live = new Set([
      ...others.map((o) => playerSource(o.id)),
      ...decoys.map((d) => decoySource(d.id)),
      ...this.sceneProps.keys(),
    ]);
    for (const source of [...this.lastPerceived.keys()]) {
      if (!live.has(source)) this.lastPerceived.delete(source);
    }
    for (const source of [...this.tellAt.keys()]) {
      if (!live.has(source)) this.tellAt.delete(source);
    }
    this.handles.retain(live);
  }

  /**
   * The player, decoy or scene prop an intent names. Under `"full"` visibility the name is
   * a session id; under `"limited"` it is a handle the observation handed out,
   * which this resolves without the policy ever learning what it stood for.
   */
  private resolveContact(targetId: string, world: ReflexWorld): Contact | null {
    const source =
      this.visibility === "full" ? playerSource(targetId) : this.handles.sourceOf(targetId);
    if (source === undefined) return null;
    for (const other of world.others) {
      if (playerSource(other.id) !== source) continue;
      if (!other.alive) return null;
      return {
        source,
        x: other.x,
        y: other.y,
        z: other.z,
        propType: other.propType,
        playerId: other.id,
      };
    }
    for (const decoy of world.decoys) {
      if (decoySource(decoy.id) !== source) continue;
      return {
        source,
        x: decoy.x,
        y: decoy.y,
        z: decoy.z,
        propType: decoy.propType,
        playerId: null,
      };
    }
    const prop = this.sceneProps.get(source);
    if (prop === undefined) return null;
    return {
      source,
      x: prop.position.x,
      y: prop.position.y,
      z: prop.position.z,
      propType: prop.type,
      playerId: null,
    };
  }

  /**
   * Where the bot is entitled to believe a contact is: its sensed position while
   * the contact clears the same sight/hearing gate {@link buildObservation}
   * applies, and the last such position once it does not. Null when the contact
   * has never been sensed.
   *
   * The motor runs on an intent for as long as a decision cycle, so without this
   * it kept reading `world.others`: a target that broke line of sight was still
   * pathed to by its live coordinates, letting a bot follow someone through a
   * wall that a player would have lost.
   */
  private perceivedPosition(contact: Contact, now: number): Point2 | null {
    const bounds = this.propBounds.get(contact.propType) ?? UNTRANSFORMED_BOUNDS;
    const aimY = contact.y + (bounds.yMin + bounds.yMax) / 2;
    const hasLineOfSight = this.canSeePoint(contact.x, aimY, contact.z);
    const distance = Math.hypot(contact.x - this.posX, contact.z - this.posZ);
    const heard =
      contact.playerId !== null &&
      this.movedRecently(contact.playerId, now) &&
      distance <= BOT_HEARING_RADIUS;
    const sensed =
      this.visibility === "full" || (hasLineOfSight && distance <= BOT_VISION_RANGE) || heard;
    if (!sensed) return this.lastPerceived.get(contact.source) ?? null;
    const at = this.sensedPosition(contact, hasLineOfSight);
    this.lastPerceived.set(contact.source, at);
    return at;
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
    this.activeObstacles = [
      ...this.obstacles,
      ...world.decoys
        .filter((decoy) => decoy.y < UNTRANSFORMED_PROP_HEIGHT)
        .map((decoy) => ({
          x: decoy.x,
          z: decoy.z,
          radius: (this.propBounds.get(decoy.propType) ?? UNTRANSFORMED_BOUNDS).radius,
        })),
    ];
    let shoot: MotorOutput["shoot"] = null;

    // Drop the aim lock whenever we are not actively shooting, so re-acquiring a
    // target after losing the shot re-arms the difficulty-scaled reaction gate.
    if (intent.kind !== "shootTarget") this.aimTargetId = null;

    switch (intent.kind) {
      case "idle":
      case "chat":
        break;
      case "patrol":
        this.runPatrol(world, dt, now);
        break;
      case "moveTo":
        this.runMoveTo(intent.x, intent.z, intent.run, world, dt, now);
        break;
      case "hideAs":
        this.runHideAs(intent.x, intent.z, world, dt, now);
        break;
      case "inspect":
        this.runApproach(intent.targetId, intent.run, world, dt, now);
        break;
      case "shootTarget":
        shoot = this.runShoot(intent.targetId, intent.probe === true, world, dt, now);
        break;
    }

    this.separateFromCrowd(world.others);
    this.selfVelocity.observe(this.posX, this.posZ, now);
    return {
      input: {
        x: this.posX,
        y: 0,
        z: this.posZ,
        rot: this.rot,
        aim: this.rot,
        propRot: this.rot,
      },
      shoot,
    };
  }

  /**
   * Nudge out of any overlapping player body and re-resolve against the static
   * world. Runs every tick, including while settled or frozen, because nothing
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
    const resolved = resolveCollisions({ x, z }, this.walls, this.activeObstacles, this.map.bounds);
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
   * stops re-planning until the intent changes. Settling on path-exhaustion, not
   * on a tight epsilon against the policy's exact coordinate, is what stops the
   * back-and-forth jitter when a hide spot lands on a cell centre or inside the
   * inflated furniture ring it can't quite touch.
   *
   * A goal that could not be planned at all leaves no path either, so settling
   * is gated on a path having actually been walked. Treating a failed plan as
   * an arrival parked the bot where it stood and (since a settled bot stops
   * calling `ensurePath`) froze the replan counter before it could ever reach
   * `pathBlocked`, hiding the failure from the policy as well.
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
    if (this.follower.consumed) this.settle();
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
    const target = this.resolveContact(targetId, world);
    if (!target) return;
    const goal = this.perceivedPosition(target, now);
    if (!goal) return;
    this.ensurePath(goal.x, goal.z, now, true);
    const wp = this.follower.advance(this.posX, this.posZ);
    if (wp) this.steer(wp, run, world.self.role, dt);
    else this.faceToward(goal.x, goal.z);
  }

  private runShoot(
    targetId: string,
    probe: boolean,
    world: ReflexWorld,
    dt: number,
    now: number,
  ): MotorOutput["shoot"] {
    const map = this.map;
    const target = this.resolveContact(targetId, world);
    if (!target || !map) {
      this.aimTargetId = null;
      return null;
    }
    const origin: Vec3 = { x: this.posX, y: BOT_EYE_HEIGHT, z: this.posZ };
    const bounds = this.propBounds.get(target.propType) ?? UNTRANSFORMED_BOUNDS;
    const aimY = target.y + (bounds.yMin + bounds.yMax) / 2;
    const dir = normalize3({ x: target.x - origin.x, y: aimY - origin.y, z: target.z - origin.z });
    const dist = Math.hypot(target.x - this.posX, target.z - this.posZ);
    const engageRange = lerp(ENGAGE_RANGE_MIN, ENGAGE_RANGE_MAX, this.difficulty);
    const canHit =
      dir !== null &&
      dist <= engageRange &&
      canHitTarget(origin, dir, target.x, target.y, target.z, bounds, map.colliders);

    if (canHit && dir) {
      this.follower.clear();
      const shot = this.aimAndFire(target, dir, dist, dt, now);
      if (shot) {
        const struck = canHitTarget(
          origin,
          shot.dir,
          target.x,
          target.y,
          target.z,
          bounds,
          map.colliders,
        );
        this.lastShotTargetId = struck ? targetId : null;
        this.probeMissed = probe && !struck;
      }
      return shot;
    }

    this.aimTargetId = null;
    const goal = this.perceivedPosition(target, now);
    if (!goal) return null;
    this.ensurePath(goal.x, goal.z, now, true);
    const wp = this.follower.advance(this.posX, this.posZ);
    if (wp) this.steer(wp, true, world.self.role, dt);
    else this.faceToward(goal.x, goal.z);
    return null;
  }

  /**
   * Track a target in the clear and fire when the shot looks good, the way a
   * player does. The crosshair follows the target with a hand's wander, a new
   * target is flicked onto (sometimes past) and fired at only after a reaction
   * time drawn for it, and each tick the trigger is pulled with a chance that
   * falls with how far the crosshair sits off the target. The shot itself then
   * leaves with an error drawn from {@link aimSpread}: what makes a running
   * prop hard to hit is how fast it crosses the line of sight, read off where
   * the bot has seen it, never anything it could not see.
   */
  private aimAndFire(
    target: Contact,
    dir: Vec3,
    distance: number,
    dt: number,
    now: number,
  ): MotorOutput["shoot"] {
    const dx = target.x - this.posX;
    const dz = target.z - this.posZ;
    const bearing = Math.atan2(dx, dz);
    if (this.aimTargetId !== target.source) {
      this.aimTargetId = target.source;
      this.fireReadyAt = now + reactionDelayMs(this.difficulty, this.rng);
      this.overshoot = overshootRad(wrapAngle(bearing - this.rot), this.rng);
      this.targetVelocity.reset();
    }
    this.targetVelocity.observe(target.x, target.z, now);
    this.aimDrift = driftStep(this.aimDrift, dt, this.difficulty, this.rng);
    const turnRate = lerp(AIM_TURN_RATE_MIN, AIM_TURN_RATE_MAX, this.difficulty);
    const left = this.turnTo(bearing + this.overshoot + this.aimDrift, turnRate * dt);
    if (left < AIM_OVERSHOOT_SETTLE_RAD || now >= this.fireReadyAt) this.overshoot = 0;
    if (now < this.fireReadyAt || now - this.lastShotAt < BOT_FIRE_COOLDOWN_MS) return null;
    const holdChance = 1 - fireChance(Math.abs(wrapAngle(bearing - this.rot)));
    if (this.rng() >= 1 - holdChance ** (dt / AIM_TRIGGER_TICK_S)) return null;
    const spread = aimSpread(
      {
        lateralSpeed: lateralSpeed(this.targetVelocity.vx, this.targetVelocity.vz, dx, dz),
        distance,
        selfSpeed: this.selfVelocity.speed,
      },
      this.difficulty,
    );
    const yaw = this.rot + spread * gaussian(this.rng);
    const pitch =
      Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) +
      spread * AIM_PITCH_SPREAD_SHARE * gaussian(this.rng);
    this.lastShotAt = now;
    this.fireReadyAt = now + BOT_FIRE_COOLDOWN_MS + followUpDelayMs(this.rng);
    return { dir: directionOf(yaw, pitch) };
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

  /** Rotate at most `maxStep` radians toward the heading `desired`; returns the angular error still remaining. */
  private turnTo(desired: number, maxStep: number): number {
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
      this.activeObstacles,
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
