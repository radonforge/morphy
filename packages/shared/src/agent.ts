import { MAX_CHAT_LENGTH } from "./constants";
import type { MapBounds } from "./map";
import type { Phase, Role } from "./protocol";

/**
 * The two-level agent contract shared by server, bot and the future control
 * plane (MCP). A {@link Policy} emits a declarative {@link Intent} — *what* to
 * achieve — at low frequency; the bot's synchronous reflex decides *how/when*
 * (pathfinding, aim, fire cooldown) from a compact {@link Observation}.
 *
 * Kept dependency-free TS (types + boundary guards) so it can live in
 * `@webhunt/shared` alongside {@link parseMapDefinition}.
 */

/** Fields every {@link Intent} carries regardless of `kind`. */
export interface IntentMeta {
  /** Monotonic decision id (echoes {@link Observation.seq}); used for trace correlation and stale-result drop. */
  seq: number;
  /** Optional one-shot chat line spoken when this intent becomes current. */
  say?: string;
}

/**
 * A declarative goal produced by a {@link Policy}. The reflex executes the
 * current intent fluidly until the next one replaces it. The policy never
 * computes a firing direction — it names a target and the reflex aims, gates on
 * line-of-sight and respects the fire cooldown — so a slow or weak policy can
 * never waste HP.
 */
export type Intent =
  | (IntentMeta & { kind: "idle" })
  | (IntentMeta & { kind: "patrol" })
  | (IntentMeta & { kind: "moveTo"; x: number; z: number; run: boolean })
  | (IntentMeta & { kind: "hideAs"; propType: string; x: number; z: number })
  | (IntentMeta & { kind: "inspect"; targetId: string })
  | (IntentMeta & { kind: "shootTarget"; targetId: string })
  | (IntentMeta & { kind: "transform"; propType: string })
  | (IntentMeta & { kind: "taunt" })
  | (IntentMeta & { kind: "chat"; text: string });

export type IntentKind = Intent["kind"];

export type Visibility = "full" | "limited";

/** The bot's own state, always known in full. */
export interface ObservedSelf {
  role: Role;
  alive: boolean;
  hp: number;
  x: number;
  z: number;
  rot: number;
  propType: string;
  canShootNow: boolean;
}

/**
 * Another player as perceived by the bot. Ground-truth fields
 * (`role`/`alive`/`propType`) are present only under `"full"` visibility; under
 * `"limited"` the list is filtered to what the bot can sense and only the
 * deduction signals remain.
 */
export interface ObservedEntity {
  id: string;
  x: number;
  z: number;
  distance: number;
  hasLineOfSight: boolean;
  role?: Role;
  alive?: boolean;
  propType?: string;
  looksLikeProp?: boolean;
  movedRecently?: boolean;
}

export interface ObservedDoorway {
  x: number;
  z: number;
}

export interface ObservedProp {
  type: string;
  x: number;
  z: number;
}

export interface ObservedMap {
  bounds: MapBounds;
  doorways: ObservedDoorway[];
  nearbyProps: ObservedProp[];
  propCatalogIds: string[];
}

/** The compact JSON snapshot handed to a {@link Policy.decide} call. */
export interface Observation {
  /** Monotonic decision id; the returned {@link Intent} echoes it for stale-drop. */
  seq: number;
  visibility: Visibility;
  phase: Phase;
  /** True when the reflex could not path to the current intent's target. */
  pathBlocked: boolean;
  self: ObservedSelf;
  entities: ObservedEntity[];
  map: ObservedMap;
}

export class IntentValidationError extends Error {
  constructor(detail: string) {
    super(`invalid intent: ${detail}`);
    this.name = "IntentValidationError";
  }
}

export class ObservationValidationError extends Error {
  constructor(detail: string) {
    super(`invalid observation: ${detail}`);
    this.name = "ObservationValidationError";
  }
}

type ErrorCtor = new (detail: string) => Error;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, field: string, Err: ErrorCtor): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Err(`field '${field}' must be a finite number`);
  }
  return value;
}

function nonEmptyString(value: unknown, field: string, Err: ErrorCtor): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Err(`field '${field}' must be a non-empty string`);
  }
  return value;
}

function plainString(value: unknown, field: string, Err: ErrorCtor): string {
  if (typeof value !== "string") throw new Err(`field '${field}' must be a string`);
  return value;
}

function parseRole(value: unknown, Err: ErrorCtor): Role {
  if (value === "hunter" || value === "prop") return value;
  throw new Err(`field 'role' must be 'hunter' or 'prop'`);
}

/**
 * Validate an {@link Intent} from an untrusted source (policy output replayed
 * from a trace, MCP/LLM JSON). Throws {@link IntentValidationError} on a missing
 * `seq`, unknown `kind`, non-finite coordinate or wrong field type; clamps
 * `say`/`chat.text` to {@link MAX_CHAT_LENGTH}. The caller logs once and keeps
 * its last good intent.
 */
export function parseIntent(raw: unknown): Intent {
  if (!isRecord(raw)) throw new IntentValidationError("root is not an object");
  const meta: IntentMeta = { seq: finiteNumber(raw.seq, "seq", IntentValidationError) };
  if (raw.say !== undefined) meta.say = plainString(raw.say, "say", IntentValidationError).slice(0, MAX_CHAT_LENGTH);

  switch (raw.kind) {
    case "idle":
      return { kind: "idle", ...meta };
    case "patrol":
      return { kind: "patrol", ...meta };
    case "taunt":
      return { kind: "taunt", ...meta };
    case "moveTo":
      return {
        kind: "moveTo",
        x: finiteNumber(raw.x, "x", IntentValidationError),
        z: finiteNumber(raw.z, "z", IntentValidationError),
        run: raw.run === true,
        ...meta,
      };
    case "hideAs":
      return {
        kind: "hideAs",
        propType: nonEmptyString(raw.propType, "propType", IntentValidationError),
        x: finiteNumber(raw.x, "x", IntentValidationError),
        z: finiteNumber(raw.z, "z", IntentValidationError),
        ...meta,
      };
    case "inspect":
      return { kind: "inspect", targetId: nonEmptyString(raw.targetId, "targetId", IntentValidationError), ...meta };
    case "shootTarget":
      return { kind: "shootTarget", targetId: nonEmptyString(raw.targetId, "targetId", IntentValidationError), ...meta };
    case "transform":
      return { kind: "transform", propType: nonEmptyString(raw.propType, "propType", IntentValidationError), ...meta };
    case "chat":
      return { kind: "chat", text: plainString(raw.text, "text", IntentValidationError).slice(0, MAX_CHAT_LENGTH), ...meta };
    default:
      throw new IntentValidationError(`unknown kind '${String(raw.kind)}'`);
  }
}

function parseObservedSelf(raw: unknown): ObservedSelf {
  if (!isRecord(raw)) throw new ObservationValidationError("field 'self' is not an object");
  return {
    role: parseRole(raw.role, ObservationValidationError),
    alive: raw.alive === true,
    hp: finiteNumber(raw.hp, "self.hp", ObservationValidationError),
    x: finiteNumber(raw.x, "self.x", ObservationValidationError),
    z: finiteNumber(raw.z, "self.z", ObservationValidationError),
    rot: finiteNumber(raw.rot, "self.rot", ObservationValidationError),
    propType: plainString(raw.propType, "self.propType", ObservationValidationError),
    canShootNow: raw.canShootNow === true,
  };
}

function parseObservedEntity(raw: unknown): ObservedEntity {
  if (!isRecord(raw)) throw new ObservationValidationError("entity is not an object");
  const entity: ObservedEntity = {
    id: nonEmptyString(raw.id, "entity.id", ObservationValidationError),
    x: finiteNumber(raw.x, "entity.x", ObservationValidationError),
    z: finiteNumber(raw.z, "entity.z", ObservationValidationError),
    distance: finiteNumber(raw.distance, "entity.distance", ObservationValidationError),
    hasLineOfSight: raw.hasLineOfSight === true,
  };
  if (raw.role !== undefined) entity.role = parseRole(raw.role, ObservationValidationError);
  if (raw.alive !== undefined) entity.alive = raw.alive === true;
  if (raw.propType !== undefined) entity.propType = plainString(raw.propType, "entity.propType", ObservationValidationError);
  if (raw.looksLikeProp !== undefined) entity.looksLikeProp = raw.looksLikeProp === true;
  if (raw.movedRecently !== undefined) entity.movedRecently = raw.movedRecently === true;
  return entity;
}

function parseBounds(raw: unknown): MapBounds {
  if (!isRecord(raw)) throw new ObservationValidationError("field 'map.bounds' is not an object");
  if (!isRecord(raw.min) || !isRecord(raw.max)) {
    throw new ObservationValidationError("field 'map.bounds' must have 'min' and 'max'");
  }
  const min = raw.min;
  const max = raw.max;
  return {
    min: {
      x: finiteNumber(min.x, "bounds.min.x", ObservationValidationError),
      y: finiteNumber(min.y, "bounds.min.y", ObservationValidationError),
      z: finiteNumber(min.z, "bounds.min.z", ObservationValidationError),
    },
    max: {
      x: finiteNumber(max.x, "bounds.max.x", ObservationValidationError),
      y: finiteNumber(max.y, "bounds.max.y", ObservationValidationError),
      z: finiteNumber(max.z, "bounds.max.z", ObservationValidationError),
    },
  };
}

function parseObservedMap(raw: unknown): ObservedMap {
  if (!isRecord(raw)) throw new ObservationValidationError("field 'map' is not an object");
  if (!Array.isArray(raw.doorways)) throw new ObservationValidationError("field 'map.doorways' must be an array");
  if (!Array.isArray(raw.nearbyProps)) throw new ObservationValidationError("field 'map.nearbyProps' must be an array");
  if (!Array.isArray(raw.propCatalogIds)) throw new ObservationValidationError("field 'map.propCatalogIds' must be an array");
  return {
    bounds: parseBounds(raw.bounds),
    doorways: raw.doorways.map((d) => {
      if (!isRecord(d)) throw new ObservationValidationError("doorway is not an object");
      return {
        x: finiteNumber(d.x, "doorway.x", ObservationValidationError),
        z: finiteNumber(d.z, "doorway.z", ObservationValidationError),
      };
    }),
    nearbyProps: raw.nearbyProps.map((p) => {
      if (!isRecord(p)) throw new ObservationValidationError("nearbyProp is not an object");
      return {
        type: nonEmptyString(p.type, "nearbyProp.type", ObservationValidationError),
        x: finiteNumber(p.x, "nearbyProp.x", ObservationValidationError),
        z: finiteNumber(p.z, "nearbyProp.z", ObservationValidationError),
      };
    }),
    propCatalogIds: raw.propCatalogIds.map((id) => nonEmptyString(id, "propCatalogId", ObservationValidationError)),
  };
}

/**
 * Validate an {@link Observation} from an untrusted source (a trace line on
 * replay, an MCP payload). Throws {@link ObservationValidationError} on
 * malformed input. Used to prove trace lines round-trip and as the boundary
 * guard for the future training/replay pipeline.
 */
export function parseObservation(raw: unknown): Observation {
  if (!isRecord(raw)) throw new ObservationValidationError("root is not an object");
  if (raw.visibility !== "full" && raw.visibility !== "limited") {
    throw new ObservationValidationError("field 'visibility' must be 'full' or 'limited'");
  }
  const phase = raw.phase;
  if (phase !== "lobby" && phase !== "starting" && phase !== "hiding" && phase !== "hunting" && phase !== "round_end") {
    throw new ObservationValidationError(`field 'phase' has unknown value '${String(phase)}'`);
  }
  if (!Array.isArray(raw.entities)) throw new ObservationValidationError("field 'entities' must be an array");
  return {
    seq: finiteNumber(raw.seq, "seq", ObservationValidationError),
    visibility: raw.visibility,
    phase,
    pathBlocked: raw.pathBlocked === true,
    self: parseObservedSelf(raw.self),
    entities: raw.entities.map((e) => parseObservedEntity(e)),
    map: parseObservedMap(raw.map),
  };
}
