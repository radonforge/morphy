import { type MapBounds, type MapDefinition, PLAYER_HEIGHT } from "@webhunt/shared";
import { BOT_BODY_RADIUS, FURNITURE_MIN_RADIUS } from "./config";

export interface Wall {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

export interface Point2 {
  x: number;
  z: number;
}

/**
 * Solid footprints for ground-level bot navigation. Boxes fully above player
 * height (elevated decks, catwalks) are skipped — bots walk under them; stair
 * steps keep their footprint so bots path around instead of climbing.
 */
export function buildWalls(map: MapDefinition): Wall[] {
  return map.colliders
    .filter(
      (collider) =>
        collider.position.y > 0 &&
        collider.position.y - collider.size.y / 2 < PLAYER_HEIGHT,
    )
    .map((collider) => ({
      minX: collider.position.x - collider.size.x / 2,
      maxX: collider.position.x + collider.size.x / 2,
      minZ: collider.position.z - collider.size.z / 2,
      maxZ: collider.position.z + collider.size.z / 2,
    }));
}

export function buildObstacles(map: MapDefinition): Obstacle[] {
  const catalog = new Map(map.propCatalog.map((def) => [def.id, def] as const));
  const obstacles: Obstacle[] = [];
  for (const instance of map.props) {
    const def = catalog.get(instance.type);
    if (!def) continue;
    if (instance.position.y >= PLAYER_HEIGHT) continue;
    let radius = 0;
    for (const part of def.parts) {
      const reach =
        Math.hypot(part.position.x, part.position.z) + Math.max(part.size.x, part.size.z) / 2;
      if (reach > radius) radius = reach;
    }
    if (radius >= FURNITURE_MIN_RADIUS) {
      obstacles.push({ x: instance.position.x, z: instance.position.z, radius });
    }
  }
  return obstacles;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Push a point out of furniture circles and wall boxes, then clamp to map bounds — the same resolution the client applies locally. */
export function resolveCollisions(
  point: Point2,
  walls: Wall[],
  obstacles: Obstacle[],
  bounds: MapBounds,
): Point2 {
  let x = point.x;
  let z = point.z;

  for (const obstacle of obstacles) {
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    const minSep = BOT_BODY_RADIUS + obstacle.radius;
    const distSq = dx * dx + dz * dz;
    if (distSq > 1e-8 && distSq < minSep * minSep) {
      const dist = Math.sqrt(distSq);
      const push = minSep - dist;
      x += (dx / dist) * push;
      z += (dz / dist) * push;
    }
  }

  for (const wall of walls) {
    const nearestX = clamp(x, wall.minX, wall.maxX);
    const nearestZ = clamp(z, wall.minZ, wall.maxZ);
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= BOT_BODY_RADIUS * BOT_BODY_RADIUS) continue;
    if (distSq > 1e-8) {
      const dist = Math.sqrt(distSq);
      const push = BOT_BODY_RADIUS - dist;
      x += (dx / dist) * push;
      z += (dz / dist) * push;
    } else {
      const toMinX = x - wall.minX;
      const toMaxX = wall.maxX - x;
      const toMinZ = z - wall.minZ;
      const toMaxZ = wall.maxZ - z;
      const minPen = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
      if (minPen === toMinX) x = wall.minX - BOT_BODY_RADIUS;
      else if (minPen === toMaxX) x = wall.maxX + BOT_BODY_RADIUS;
      else if (minPen === toMinZ) z = wall.minZ - BOT_BODY_RADIUS;
      else z = wall.maxZ + BOT_BODY_RADIUS;
    }
  }

  return {
    x: clamp(x, bounds.min.x + BOT_BODY_RADIUS, bounds.max.x - BOT_BODY_RADIUS),
    z: clamp(z, bounds.min.z + BOT_BODY_RADIUS, bounds.max.z - BOT_BODY_RADIUS),
  };
}
