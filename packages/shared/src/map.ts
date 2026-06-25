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
}

/**
 * A full glTF model placed as decorative exterior scenery (rockets, hangars,
 * craft, debris). Rendered un-instanced so multi-mesh models display in full,
 * and uniformly scaled. Purely visual — never produces a collider.
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

export interface MapDefinition {
  id: string;
  name: string;
  bounds: MapBounds;
  spawnPoints: { hunters: Vec3[]; props: Vec3[] };
  colliders: BoxCollider[];
  tiles: TileInstance[];
  scenery: SceneryInstance[];
  props: PropInstance[];
  propCatalog: PropDefinition[];
}

class MapValidationError extends Error {
  constructor(mapId: string, detail: string) {
    super(`invalid map "${mapId}": ${detail}`);
    this.name = "MapValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVec3(value: unknown): value is Vec3 {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.z === "number"
  );
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
    isVec3(value.size) &&
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
    (value.modelScale === undefined || typeof value.modelScale === "number")
  );
}

function isPropInstance(value: unknown): value is PropInstance {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    isVec3(value.position) &&
    typeof value.rotation === "number"
  );
}

function isBoxCollider(value: unknown): value is BoxCollider {
  return isRecord(value) && isVec3(value.position) && isVec3(value.size);
}

function isTileInstance(value: unknown): value is TileInstance {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    isVec3(value.position) &&
    typeof value.rotationY === "number"
  );
}

function isSceneryInstance(value: unknown): value is SceneryInstance {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    isVec3(value.position) &&
    typeof value.rotationY === "number" &&
    typeof value.scale === "number"
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
  if (typeof raw.name !== "string") {
    throw new MapValidationError(id, "missing string field 'name'");
  }
  if (!isRecord(raw.bounds) || !isVec3(raw.bounds.min) || !isVec3(raw.bounds.max)) {
    throw new MapValidationError(id, "field 'bounds' must have Vec3 'min' and 'max'");
  }
  if (
    !isRecord(raw.spawnPoints) ||
    !vec3List(raw.spawnPoints.hunters) ||
    !vec3List(raw.spawnPoints.props)
  ) {
    throw new MapValidationError(id, "field 'spawnPoints' must have Vec3[] 'hunters' and 'props'");
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
  if (!Array.isArray(raw.props) || !raw.props.every(isPropInstance)) {
    throw new MapValidationError(id, "field 'props' must be PropInstance[]");
  }
  if (!Array.isArray(raw.propCatalog) || !raw.propCatalog.every(isPropDefinition)) {
    throw new MapValidationError(id, "field 'propCatalog' must be PropDefinition[]");
  }

  const catalogIds = new Set(raw.propCatalog.map((p) => p.id));
  for (const instance of raw.props) {
    if (!catalogIds.has(instance.type)) {
      throw new MapValidationError(id, `prop instance references unknown type '${instance.type}'`);
    }
  }

  return {
    id,
    name: raw.name,
    bounds: { min: raw.bounds.min, max: raw.bounds.max },
    spawnPoints: { hunters: raw.spawnPoints.hunters, props: raw.spawnPoints.props },
    colliders: raw.colliders,
    tiles: raw.tiles,
    scenery,
    props: raw.props,
    propCatalog: raw.propCatalog,
  };
}
