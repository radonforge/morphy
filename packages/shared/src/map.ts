export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PrimitiveKind = "box" | "cylinder" | "cone";

const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ["box", "cylinder", "cone"];

export interface PrimitiveSpec {
  kind: PrimitiveKind;
  position: Vec3;
  size: Vec3;
  color: string;
}

export interface PropDefinition {
  id: string;
  name: string;
  parts: PrimitiveSpec[];
  model?: string;
  modelScale?: number;
}

export interface PropInstance {
  type: string;
  position: Vec3;
  rotation: number;
}

/** Vertical bounding cylinder of a prop, around its (x, z) origin, in world space. */
export interface PropBounds {
  radius: number;
  yMin: number;
  yMax: number;
}

/**
 * Derive a prop's bounding volume from its visual parts so server-side hit
 * detection matches what the player sees through the crosshair. Each part is a
 * primitive centered at `position` with full extents `size`; the horizontal
 * reach is rotation-agnostic (a circle) and the vertical span is the union of
 * all parts.
 */
export function computePropBounds(def: PropDefinition): PropBounds {
  let radius = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const part of def.parts) {
    const reach =
      Math.hypot(part.position.x, part.position.z) + Math.max(part.size.x, part.size.z) / 2;
    if (reach > radius) radius = reach;
    const bottom = part.position.y - part.size.y / 2;
    const top = part.position.y + part.size.y / 2;
    if (bottom < yMin) yMin = bottom;
    if (top > yMax) yMax = top;
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return { radius: 0, yMin: 0, yMax: 0 };
  }
  return { radius, yMin, yMax };
}

export interface BoxCollider {
  position: Vec3;
  size: Vec3;
}

/** A modular glTF piece (floor/wall) placed at a grid-snapped pose for rendering. */
export interface TileInstance {
  model: string;
  position: Vec3;
  rotationY: number;
  /** Uniform scale applied per instance (default 1). Lets small unit-sized kits tile at world scale. */
  scale?: number;
  /** Vertical scale override (defaults to `scale`). Lets flat kits span in XZ without growing tall. */
  scaleY?: number;
}

/**
 * A full glTF model placed as decorative exterior scenery (rockets, hangars,
 * craft, debris). Rendered un-instanced so multi-mesh models display in full,
 * and uniformly scaled. Scenery is purely visual; when a piece is solid its
 * collision is authored separately as a {@link BoxCollider} in the map's
 * `colliders`, so every layer (client movement, server hit resolution, bot
 * navigation) agrees on it.
 */
export interface SceneryInstance {
  model: string;
  position: Vec3;
  rotationY: number;
  scale: number;
}

export interface MapBounds {
  min: Vec3;
  max: Vec3;
}

/**
 * Where players are put down. Everyone waits for a round on a `props` point;
 * hunters are released onto `hunters` points as the hunt opens, and respawn on
 * them, so they start the hunt away from where the props went to hide.
 */
export interface SpawnPoints {
  props: Vec3[];
  hunters: Vec3[];
}

export type MapLightKind = "room" | "corridor";

const MAP_LIGHT_KINDS: readonly MapLightKind[] = ["room", "corridor"];

/**
 * A point light hung over a night map's deck. `room` lights pool warm over
 * furniture, `corridor` lights mark a route; the theme decides colour and reach.
 */
export interface MapLight {
  id: string;
  x: number;
  z: number;
  kind: MapLightKind;
}

export type CeilingKind = "glass" | "solid";

const CEILING_KINDS: readonly CeilingKind[] = ["glass", "solid"];

/**
 * One square ceiling panel over a floor cell, centred on `x`/`z` with its
 * underside at `y`. `glass` shows the sky through a ribbed pane; `solid` closes
 * it off.
 */
export interface CeilingPanel {
  x: number;
  z: number;
  y: number;
  size: number;
  kind: CeilingKind;
}

export interface MapDefinition {
  id: string;
  bounds: MapBounds;
  spawnPoints: SpawnPoints;
  colliders: BoxCollider[];
  tiles: TileInstance[];
  scenery: SceneryInstance[];
  props: PropInstance[];
  propCatalog: PropDefinition[];
  /** Authored point lights; a map without them has its lights picked from its layout. */
  lights?: MapLight[];
  /** Panels over the floor cells; a map without them is open to the sky. */
  ceiling?: CeilingPanel[];
}

export class MapValidationError extends Error {
  constructor(mapId: string, detail: string) {
    super(`invalid map "${mapId}": ${detail}`);
    this.name = "MapValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isVec3(value: unknown): value is Vec3 {
  return (
    isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)
  );
}

function isPositiveVec3(value: unknown): value is Vec3 {
  return isVec3(value) && value.x > 0 && value.y > 0 && value.z > 0;
}

function vec3List(value: unknown): value is Vec3[] {
  return Array.isArray(value) && value.every(isVec3);
}

function isPrimitive(value: unknown): value is PrimitiveSpec {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    PRIMITIVE_KINDS.includes(value.kind as PrimitiveKind) &&
    isVec3(value.position) &&
    isPositiveVec3(value.size) &&
    typeof value.color === "string"
  );
}

function isPropDefinition(value: unknown): value is PropDefinition {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.parts) &&
    value.parts.every(isPrimitive) &&
    (value.model === undefined || typeof value.model === "string") &&
    (value.modelScale === undefined || (isFiniteNumber(value.modelScale) && value.modelScale > 0))
  );
}

function isPropInstance(value: unknown): value is PropInstance {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    isVec3(value.position) &&
    isFiniteNumber(value.rotation)
  );
}

function isBoxCollider(value: unknown): value is BoxCollider {
  return isRecord(value) && isVec3(value.position) && isPositiveVec3(value.size);
}

function isTileInstance(value: unknown): value is TileInstance {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    isVec3(value.position) &&
    isFiniteNumber(value.rotationY) &&
    (value.scale === undefined || (isFiniteNumber(value.scale) && value.scale > 0)) &&
    (value.scaleY === undefined || (isFiniteNumber(value.scaleY) && value.scaleY > 0))
  );
}

function isSceneryInstance(value: unknown): value is SceneryInstance {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    isVec3(value.position) &&
    isFiniteNumber(value.rotationY) &&
    isFiniteNumber(value.scale) &&
    value.scale > 0
  );
}

function isMapLight(value: unknown): value is MapLight {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.z) &&
    MAP_LIGHT_KINDS.includes(value.kind as MapLightKind)
  );
}

function isCeilingPanel(value: unknown): value is CeilingPanel {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.size) &&
    value.size > 0 &&
    CEILING_KINDS.includes(value.kind as CeilingKind)
  );
}

/**
 * Parse and validate a map loaded from an untrusted source (file / bundle).
 * Throws {@link MapValidationError} with an actionable message on malformed input.
 */
export function parseMapDefinition(raw: unknown): MapDefinition {
  if (!isRecord(raw)) {
    throw new MapValidationError("?", "root is not an object");
  }
  const id = typeof raw.id === "string" ? raw.id : "?";
  if (id === "?") {
    throw new MapValidationError(id, "missing string field 'id'");
  }
  if (!isRecord(raw.bounds) || !isVec3(raw.bounds.min) || !isVec3(raw.bounds.max)) {
    throw new MapValidationError(id, "field 'bounds' must have Vec3 'min' and 'max'");
  }
  if (
    !isRecord(raw.spawnPoints) ||
    !vec3List(raw.spawnPoints.props) ||
    !vec3List(raw.spawnPoints.hunters)
  ) {
    throw new MapValidationError(id, "field 'spawnPoints' must have Vec3[] 'props' and 'hunters'");
  }
  if (raw.spawnPoints.props.length === 0) {
    throw new MapValidationError(id, "field 'spawnPoints.props' must not be empty");
  }
  if (raw.spawnPoints.hunters.length === 0) {
    throw new MapValidationError(id, "field 'spawnPoints.hunters' must not be empty");
  }
  if (!Array.isArray(raw.colliders) || !raw.colliders.every(isBoxCollider)) {
    throw new MapValidationError(id, "field 'colliders' must be BoxCollider[]");
  }
  if (!Array.isArray(raw.tiles) || !raw.tiles.every(isTileInstance)) {
    throw new MapValidationError(id, "field 'tiles' must be TileInstance[]");
  }
  let scenery: SceneryInstance[] = [];
  if (raw.scenery !== undefined) {
    if (!Array.isArray(raw.scenery) || !raw.scenery.every(isSceneryInstance)) {
      throw new MapValidationError(id, "field 'scenery' must be SceneryInstance[]");
    }
    scenery = raw.scenery;
  }
  let lights: MapLight[] | undefined;
  if (raw.lights !== undefined) {
    if (!Array.isArray(raw.lights) || !raw.lights.every(isMapLight)) {
      throw new MapValidationError(id, "field 'lights' must be MapLight[]");
    }
    const lightIds = new Set<string>();
    for (const light of raw.lights) {
      if (lightIds.has(light.id)) {
        throw new MapValidationError(id, `lights contain duplicate id '${light.id}'`);
      }
      lightIds.add(light.id);
    }
    lights = raw.lights.map(({ id: lightId, x, z, kind }) => ({ id: lightId, x, z, kind }));
  }
  let ceiling: CeilingPanel[] | undefined;
  if (raw.ceiling !== undefined) {
    if (!Array.isArray(raw.ceiling) || !raw.ceiling.every(isCeilingPanel)) {
      throw new MapValidationError(id, "field 'ceiling' must be CeilingPanel[]");
    }
    ceiling = raw.ceiling.map(({ x, z, y, size, kind }) => ({ x, z, y, size, kind }));
  }
  if (!Array.isArray(raw.props) || !raw.props.every(isPropInstance)) {
    throw new MapValidationError(id, "field 'props' must be PropInstance[]");
  }
  if (!Array.isArray(raw.propCatalog) || !raw.propCatalog.every(isPropDefinition)) {
    throw new MapValidationError(id, "field 'propCatalog' must be PropDefinition[]");
  }

  const { min, max } = raw.bounds;
  if (min.x >= max.x || min.y >= max.y || min.z >= max.z) {
    throw new MapValidationError(id, "field 'bounds' must have min < max on every axis");
  }
  for (const spawn of [...raw.spawnPoints.props, ...raw.spawnPoints.hunters]) {
    if (
      spawn.x < min.x ||
      spawn.x > max.x ||
      spawn.y < min.y ||
      spawn.y > max.y ||
      spawn.z < min.z ||
      spawn.z > max.z
    ) {
      throw new MapValidationError(id, "spawn point lies outside map bounds");
    }
  }

  const catalogIds = new Set<string>();
  for (const definition of raw.propCatalog) {
    if (catalogIds.has(definition.id)) {
      throw new MapValidationError(id, `prop catalog contains duplicate id '${definition.id}'`);
    }
    catalogIds.add(definition.id);
  }
  for (const instance of raw.props) {
    if (!catalogIds.has(instance.type)) {
      throw new MapValidationError(id, `prop instance references unknown type '${instance.type}'`);
    }
  }

  return {
    id,
    bounds: { min: raw.bounds.min, max: raw.bounds.max },
    spawnPoints: { props: raw.spawnPoints.props, hunters: raw.spawnPoints.hunters },
    colliders: raw.colliders,
    tiles: raw.tiles,
    scenery,
    props: raw.props,
    propCatalog: raw.propCatalog,
    ...(lights !== undefined ? { lights } : {}),
    ...(ceiling !== undefined ? { ceiling } : {}),
  };
}
