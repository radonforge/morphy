import {
  UNTRANSFORMED_PROP_RADIUS,
  UNTRANSFORMED_PROP_HEIGHT,
  type MapBounds,
  type MapDefinition,
  type Phase,
  type PropBounds,
} from "@webhunt/shared";
import {
  ARRIVE_EPSILON,
  BOT_EYE_HEIGHT,
  ENGAGE_RANGE_MAX,
  ENGAGE_RANGE_MIN,
  HIDE_OFFSET_MAX,
  HIDE_OFFSET_MIN,
  PANIC_RADIUS,
  REACTION_MS_MAX,
  REACTION_MS_MIN,
  WAYPOINT_MARGIN,
  lerp,
} from "./config";
import { canHitTarget, normalize3, type Vec3 } from "./raycast";
import type { BotPlayer } from "./view";

export interface World {
  phase: Phase;
  self: BotPlayer;
  others: BotPlayer[];
  map: MapDefinition;
  propBounds: Map<string, PropBounds>;
  difficulty: number;
  now: number;
}

export interface Decision {
  move: { x: number; z: number } | null;
  run: boolean;
  face: number | null;
  transformTo: string | null;
  shoot: { origin: Vec3; dir: Vec3 } | null;
}

export interface Brain {
  decide(world: World): Decision;
  reset(): void;
}

const HOLD: Decision = { move: null, run: false, face: null, transformTo: null, shoot: null };

const UNTRANSFORMED_BOUNDS: PropBounds = {
  radius: UNTRANSFORMED_PROP_RADIUS,
  yMin: 0,
  yMax: UNTRANSFORMED_PROP_HEIGHT,
};

function distXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clampToBounds(point: { x: number; z: number }, bounds: MapBounds): { x: number; z: number } {
  return {
    x: Math.min(Math.max(point.x, bounds.min.x + WAYPOINT_MARGIN), bounds.max.x - WAYPOINT_MARGIN),
    z: Math.min(Math.max(point.z, bounds.min.z + WAYPOINT_MARGIN), bounds.max.z - WAYPOINT_MARGIN),
  };
}

function randomWaypoint(bounds: MapBounds): { x: number; z: number } {
  const minX = bounds.min.x + WAYPOINT_MARGIN;
  const maxX = bounds.max.x - WAYPOINT_MARGIN;
  const minZ = bounds.min.z + WAYPOINT_MARGIN;
  const maxZ = bounds.max.z - WAYPOINT_MARGIN;
  return { x: minX + Math.random() * (maxX - minX), z: minZ + Math.random() * (maxZ - minZ) };
}

function nearestHunter(world: World): { player: BotPlayer; dist: number } | null {
  let best: { player: BotPlayer; dist: number } | null = null;
  for (const player of world.others) {
    if (player.role !== "hunter" || !player.alive) continue;
    const dist = distXZ(world.self, player);
    if (!best || dist < best.dist) best = { player, dist };
  }
  return best;
}

export class HunterBrain implements Brain {
  private targetId: string | null = null;
  private acquiredAt = 0;
  private waypoint: { x: number; z: number } | null = null;

  reset(): void {
    this.targetId = null;
    this.acquiredAt = 0;
    this.waypoint = null;
  }

  decide(world: World): Decision {
    if (world.phase !== "hunting") {
      this.targetId = null;
      return HOLD;
    }

    const origin: Vec3 = { x: world.self.x, y: BOT_EYE_HEIGHT, z: world.self.z };
    const engageRange = lerp(ENGAGE_RANGE_MIN, ENGAGE_RANGE_MAX, world.difficulty);
    const reactionMs = lerp(REACTION_MS_MAX, REACTION_MS_MIN, world.difficulty);

    const inRange = world.others
      .filter((player) => player.role === "prop" && player.alive)
      .map((player) => ({ player, dist: distXZ(world.self, player) }))
      .filter((candidate) => candidate.dist <= engageRange)
      .sort((a, b) => a.dist - b.dist);

    for (const { player } of inRange) {
      const bounds = world.propBounds.get(player.propType) ?? UNTRANSFORMED_BOUNDS;
      const aimY = (bounds.yMin + bounds.yMax) / 2;
      const dir = normalize3({ x: player.x - origin.x, y: aimY - origin.y, z: player.z - origin.z });
      if (!dir) continue;
      if (!canHitTarget(origin, dir, player.x, player.z, bounds, world.map.colliders)) continue;

      if (this.targetId !== player.id) {
        this.targetId = player.id;
        this.acquiredAt = world.now;
      }
      const ready = world.now - this.acquiredAt >= reactionMs;
      return {
        move: null,
        run: false,
        face: Math.atan2(player.x - world.self.x, player.z - world.self.z),
        transformTo: null,
        shoot: ready ? { origin, dir } : null,
      };
    }

    this.targetId = null;
    const nearest = inRange[0];
    if (nearest) {
      return { move: { x: nearest.player.x, z: nearest.player.z }, run: true, face: null, transformTo: null, shoot: null };
    }
    return this.patrol(world);
  }

  private patrol(world: World): Decision {
    if (!this.waypoint || distXZ(this.waypoint, world.self) <= ARRIVE_EPSILON) {
      this.waypoint = randomWaypoint(world.map.bounds);
    }
    return { move: this.waypoint, run: false, face: null, transformTo: null, shoot: null };
  }
}

export class PropBrain implements Brain {
  private hideType: string | null = null;
  private hideSpot: { x: number; z: number } | null = null;

  reset(): void {
    this.hideType = null;
    this.hideSpot = null;
  }

  decide(world: World): Decision {
    if (world.phase !== "hiding" && world.phase !== "hunting") return HOLD;
    if (!this.hideSpot || !this.hideType) this.plan(world);
    const spot = this.hideSpot;
    const type = this.hideType;
    if (!spot || !type) return HOLD;

    const threat = nearestHunter(world);
    if (threat && threat.dist < PANIC_RADIUS) {
      let dx = world.self.x - threat.player.x;
      let dz = world.self.z - threat.player.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const flee = clampToBounds(
        { x: world.self.x + dx * PANIC_RADIUS, z: world.self.z + dz * PANIC_RADIUS },
        world.map.bounds,
      );
      return { move: flee, run: true, face: null, transformTo: this.wantTransform(world, type), shoot: null };
    }

    const arrived = distXZ(spot, world.self) <= ARRIVE_EPSILON;
    return {
      move: arrived ? null : spot,
      run: !arrived && world.phase === "hiding",
      face: null,
      transformTo: this.wantTransform(world, type),
      shoot: null,
    };
  }

  private wantTransform(world: World, type: string): string | null {
    return world.self.propType === type ? null : type;
  }

  private plan(world: World): void {
    const instances = world.map.props;
    if (instances.length > 0) {
      const pick = instances[Math.floor(Math.random() * instances.length)];
      if (pick) {
        const angle = Math.random() * Math.PI * 2;
        const offset = HIDE_OFFSET_MIN + Math.random() * (HIDE_OFFSET_MAX - HIDE_OFFSET_MIN);
        this.hideType = pick.type;
        this.hideSpot = clampToBounds(
          { x: pick.position.x + Math.cos(angle) * offset, z: pick.position.z + Math.sin(angle) * offset },
          world.map.bounds,
        );
        return;
      }
    }
    const catalog = world.map.propCatalog;
    const def = catalog[Math.floor(Math.random() * catalog.length)];
    this.hideType = def ? def.id : null;
    this.hideSpot = randomWaypoint(world.map.bounds);
  }
}
