import {
  ASSET_CARDS,
  type BotAct,
  computePropBounds,
  fittedExtent,
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
  type Role,
  RUN_MULTIPLIER_HUNTER,
  RUN_MULTIPLIER_PROP,
  type ShapeExtent,
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
  HUNTER_VIEW_HALF_ANGLE_RAD,
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
import {
  ContactHandles,
  decoySource,
  heardSpotSource,
  playerSource,
  scenePropSource,
} from "./contacts";
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
import { type Body, Glance, inscribedExtent, SightIndex, sightOf, type Viewer } from "./perception";
import { canHitTarget, normalize3, type Vec3 } from "./raycast";
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

const UNTRANSFORMED_EXTENT = inscribedExtent(UNTRANSFORMED_BOUNDS);

/** Which way a player's model is turned: a prop's disguise by its own turn, anyone else by their heading. */
function modelYaw(player: BotPlayer): number {
  return player.role === "prop" && player.propType !== "" ? player.propRot : player.rot;
}

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
 * Something an intent can name as its target: a player, a decoy, a scene prop
 * or a spot footsteps were heard from. Only a player is ever seen to move.
 */
interface Contact {
  source: string;
  x: number;
  y: number;
  z: number;
  propType: string;
  /** Which way its model is turned. */
  yaw: number;
  /** For a scene prop, its index in the map's prop list: the furniture that must not hide itself. */
  owner?: number;
  /** A spot footsteps were heard from: a place to go, never seen and never shot at. */
  spot: boolean;
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

/** How a player looked the last time the bot saw it change, while it stays in sight. */
interface SeenPose {
  x: number;
  z: number;
  /** Which way the disguise faces; a spin in place is seen as movement too. */
  rot: number;
  shape: string;
}

/**
 * What the bot has perceived of one player, kept tick by tick, so that a step,
 * a spin or a change of shape counts only when the bot saw it happen.
 */
interface PlayerTrack {
  /** Null while the player is out of sight: a sighting after a gap starts afresh and witnesses nothing. */
  seen: SeenPose | null;
  /** When the bot last saw it step or spin. */
  seenMovedAt: number | null;
  /** Where it stood when it last stepped, in sight or not: what its rustle is measured from. */
  stepX: number;
  stepZ: number;
  /**
   * When it last stepped, sight or no sight. Ground truth: read only as the
   * rustle a moving prop makes, which carries through walls, and by the
   * full-vision anchor.
   */
  steppedAt: number | null;
}

/** A player or decoy the bot sees this tick: the body seen and the first point of it seen. */
interface Sighting {
  body: Body;
  at: Vec3;
  player: boolean;
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
  private propExtents = new Map<string, ShapeExtent>();
  private sceneProps = new Map<string, { prop: PropInstance; index: number }>();
  private sight: SightIndex | null = null;
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

  private readonly tracks = new Map<string, PlayerTrack>();
  private sightings = new Map<string, Sighting>();
  /** Where the bot looked from on its last {@link sense}: every sighting of that tick is taken from it. */
  private sensedFrom: Viewer | null = null;
  private sensedAt: number | null = null;
  private blind = false;
  /**
   * The spots rustles were heard from within {@link HEARD_SOUND_MEMORY_MS},
   * and when, so a handle to one still leads there for the next few decisions.
   */
  private readonly spots = new Map<string, Point2 & { heardAt: number }>();
  private readonly lastPerceived = new Map<string, Point2>();
  /** When each contact last gave itself away; see {@link toldRecently}. */
  private readonly tellAt = new Map<string, number>();
  private readonly handles = new ContactHandles();
  private readonly glance = new Glance();
  private glanceApplied = 0;
  private tracking = false;
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

  /**
   * Take in what the bot perceives this tick: which players and decoys it
   * sees, and what each player was seen or heard to do. Every reader of
   * perception (the observation, the policy's wake-up, the motor chasing a
   * target, the attribution of a honk) reads this one result, so no path can
   * see what another would hide. Runs once per tick, however often it is
   * asked, from where the bot stood and looked as the tick began; a honk is
   * matched to it, then looked at again from where the bot looks as it plays.
   *
   * A limited-vision hunter sees only what lies in the cone it faces, as a
   * player sees only the screen; a prop sees all round, since a player prop
   * orbits a third-person camera without turning its disguise. Both see
   * nothing through a wall or a piece of furniture.
   */
  sense(world: ReflexWorld, now: number): void {
    const sight = this.sight;
    if (!sight || this.sensedAt === now) return;
    this.sensedAt = now;
    this.blind =
      this.visibility === "limited" && world.self.role === "hunter" && world.phase === "hiding";
    const viewer = this.viewer(world.self.role);
    this.sensedFrom = viewer;
    const sightings = new Map<string, Sighting>();
    for (const other of world.others) {
      const body = this.bodyOf(other, modelYaw(other));
      const at = this.blind || !other.alive ? null : sightOf(sight, viewer, body);
      if (at) sightings.set(playerSource(other.id), { body, at, player: true });
      this.track(other, at !== null, now);
    }
    if (this.visibility === "limited" && !this.blind) {
      for (const decoy of world.decoys) {
        const body = this.bodyOf(decoy, decoy.rot);
        const at = sightOf(sight, viewer, body);
        if (at) sightings.set(decoySource(decoy.id), { body, at, player: false });
      }
    }
    this.sightings = sightings;
  }

  /** The players (and, with limited vision, decoys) the bot saw on its last {@link sense}, by source. */
  seenSources(): ReadonlySet<string> {
    return new Set(this.sightings.keys());
  }

  private viewer(role: Role): Viewer {
    return {
      x: this.posX,
      y: BOT_EYE_HEIGHT,
      z: this.posZ,
      heading: this.rot,
      halfAngle:
        this.visibility === "limited" && role === "hunter" ? HUNTER_VIEW_HALF_ANGLE_RAD : null,
      range: this.visibility === "full" ? Number.POSITIVE_INFINITY : BOT_VISION_RANGE,
    };
  }

  private bodyOf(
    thing: { x: number; y: number; z: number; propType: string },
    yaw: number,
    owner?: number,
  ): Body {
    return {
      x: thing.x,
      y: thing.y,
      z: thing.z,
      yaw,
      extent: this.propExtents.get(thing.propType) ?? UNTRANSFORMED_EXTENT,
      owner,
    };
  }

  /**
   * Note what one player did since the last tick. Its steps are measured
   * whether or not it is in sight, because a moving prop rustles through walls;
   * a step, spin or change of shape is *witnessed* only between two ticks that
   * both saw it, so a player that reappears is measured from where it is seen
   * again, never against where it was last seen.
   */
  private track(other: BotPlayer, seen: boolean, now: number): void {
    let track = this.tracks.get(other.id);
    if (!track) {
      track = { seen: null, seenMovedAt: null, stepX: other.x, stepZ: other.z, steppedAt: null };
      this.tracks.set(other.id, track);
    }
    if (Math.hypot(other.x - track.stepX, other.z - track.stepZ) > MOVED_RECENTLY_MIN_DIST) {
      track.stepX = other.x;
      track.stepZ = other.z;
      track.steppedAt = now;
    }
    const pose = track.seen;
    if (!seen) {
      track.seen = null;
      return;
    }
    if (!pose) {
      track.seen = { x: other.x, z: other.z, rot: other.propRot, shape: other.propType };
      return;
    }
    const disguised = other.propType !== "";
    const stepped = Math.hypot(other.x - pose.x, other.z - pose.z) > MOVED_RECENTLY_MIN_DIST;
    const spun =
      disguised && Math.abs(wrapAngle(other.propRot - pose.rot)) > MOVED_RECENTLY_MIN_TURN_RAD;
    const morphed = pose.shape !== "" && pose.shape !== other.propType;
    if (stepped || spun) {
      pose.x = other.x;
      pose.z = other.z;
      pose.rot = other.propRot;
      track.seenMovedAt = now;
    }
    pose.shape = other.propType;
    if (disguised && (stepped || spun || morphed)) this.tellAt.set(playerSource(other.id), now);
  }

  /** Whether the bot saw this player step or spin within {@link MOVED_RECENTLY_MS}. */
  private seenMovedRecently(id: string, now: number): boolean {
    const at = this.tracks.get(id)?.seenMovedAt;
    return at !== undefined && at !== null && now - at <= MOVED_RECENTLY_MS;
  }

  /** Whether this player stepped at all within {@link MOVED_RECENTLY_MS}: ground truth, for the anchor. */
  private steppedRecently(id: string, now: number): boolean {
    const at = this.tracks.get(id)?.steppedAt;
    return at !== undefined && at !== null && now - at <= MOVED_RECENTLY_MS;
  }

  /**
   * Whether the bot hears this player's rustle: a live prop that stepped a
   * moment ago within earshot, which is exactly when a player's client plays
   * one. A spin makes no sound, and a hunter's footsteps are not played to
   * anyone, so neither is heard.
   */
  private hears(other: BotPlayer, now: number): boolean {
    if (this.blind || other.role !== "prop" || !other.alive) return false;
    if (Math.hypot(other.x - this.posX, other.z - this.posZ) > BOT_HEARING_RADIUS) return false;
    return this.steppedRecently(other.id, now);
  }

  /**
   * Whether the bot sees, as a sound plays at (x, z), the player it came from:
   * a player sees a honk as the disguise pulsing, so one whose source stands
   * hidden is only heard. The sound carries no source, so it is matched by
   * place to a player seen on the last {@link sense}, within
   * {@link BOT_TELL_MATCH_RADIUS}; two players' bodies push apart further than
   * that, so the match is the honker. The match is then looked at again, where
   * the sound played, from where the bot stands and looks now: the motor may
   * have turned or moved it since the tick began, and a honk behind its new
   * view is not seen.
   */
  private seesSourceAt(x: number, z: number): boolean {
    const sight = this.sight;
    const sensed = this.sensedFrom;
    if (!sight || !sensed) return false;
    const viewer: Viewer = { ...sensed, x: this.posX, z: this.posZ, heading: this.rot };
    for (const sighting of this.sightings.values()) {
      if (!sighting.player) continue;
      if (Math.hypot(sighting.body.x - x, sighting.body.z - z) > BOT_TELL_MATCH_RADIUS) continue;
      if (sightOf(sight, viewer, { ...sighting.body, x, z })) return true;
    }
    return false;
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
    this.propExtents = new Map(
      map.propCatalog.map(
        (def) =>
          [
            def.id,
            fittedExtent(def, ASSET_CARDS) ?? inscribedExtent(computePropBounds(def)),
          ] as const,
      ),
    );
    const worn = new Set(map.propCatalog.filter(isDisguise).map((def) => def.id));
    this.sceneProps = new Map(
      map.props.flatMap((prop, index) =>
        worn.has(prop.type) ? [[scenePropSource(index), { prop, index }] as const] : [],
      ),
    );
    this.sight = new SightIndex(map);
    this.doorways = map.tiles
      .filter((tile) => tile.model.includes(DOORWAY_TILE_MARKER))
      .map((tile) => ({ x: tile.position.x, z: tile.position.z }));
    this.resetMotion();
    this.forgetContacts();
    this.lastShotAt = 0;
  }

  /**
   * Drop every contact handle, last sighting, player track, heard spot, tell
   * and heard sound, and the aim on and record of whatever was last fired at,
   * as a new round begins: handles restart, so a record kept would name
   * another contact. A track kept from before the props hid would read every
   * prop that walked to its spot as one seen moving the moment the hunt opens.
   */
  forgetContacts(): void {
    this.aimTargetId = null;
    this.overshoot = 0;
    this.aimDrift = 0;
    this.targetVelocity.reset();
    this.lastPerceived.clear();
    this.tracks.clear();
    this.sightings.clear();
    this.sensedFrom = null;
    this.sensedAt = null;
    this.spots.clear();
    this.tellAt.clear();
    this.handles.clear();
    this.glance.reset();
    this.heard = [];
    this.lastShotTargetId = null;
    this.probeMissed = false;
  }

  /**
   * Take in a sound the room played at (x, z), if it carries this far. It is
   * placed the way footsteps are: exactly when the bot sees the player it came
   * from, and only to a neighbourhood otherwise, which is what a panned honk
   * tells a player through a wall or behind their back.
   */
  hear(kind: SoundKind, x: number, z: number, now: number): void {
    this.forgetOldSounds(now);
    if (Math.hypot(x - this.posX, z - this.posZ) > HEARING_RANGE[kind]) return;
    const hasLineOfSight = this.seesSourceAt(x, z);
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
    this.sense(world, now);
    this.forgetDeparted(world.others, world.decoys, now);
    const blind = this.blind;
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

  /** Ground truth for every live player: the measuring anchor, never a live room's mode. */
  private observeFull(world: ReflexWorld, now: number): ObservedEntity[] {
    const entities: ObservedEntity[] = [];
    for (const other of world.others) {
      if (!other.alive) continue;
      const hasLineOfSight = this.sightings.has(playerSource(other.id));
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
        movedRecently: this.steppedRecently(other.id, now),
        facingMe: hasLineOfSight && this.isAimedAtMe(other),
      });
    }
    return entities;
  }

  /**
   * What a player would read off the screen and hear: players and decoys in
   * sight, for a hunter every scene prop in sight, and the spots rustles came
   * from out of sight, with handles dealt nearest first so the order they are
   * named in says nothing about what they are.
   */
  private observeLimited(world: ReflexWorld, now: number): ObservedEntity[] {
    const sensed: Sensed[] = [];
    const spots = new Set<string>();
    for (const other of world.others) {
      if (!other.alive) continue;
      if (this.sightings.has(playerSource(other.id))) {
        sensed.push(this.seenPlayer(other, now));
        continue;
      }
      if (!this.hears(other, now)) continue;
      const spot = this.heardSpot(other, now);
      if (spots.has(spot.source)) continue;
      spots.add(spot.source);
      sensed.push(spot);
    }
    sensed.push(...this.observeDecoys(world.decoys, now));
    if (world.self.role === "hunter") sensed.push(...this.observeSceneProps(now));
    sensed.sort((a, b) => a.entity.distance - b.entity.distance);
    return sensed.map(({ source, entity }) => ({ id: this.handles.handleFor(source), ...entity }));
  }

  private seenPlayer(other: BotPlayer, now: number): Sensed {
    const disguised = other.propType !== "";
    const source = playerSource(other.id);
    const at = { x: other.x, z: other.z };
    this.lastPerceived.set(source, at);
    return {
      source,
      entity: {
        x: at.x,
        z: at.z,
        distance: Math.hypot(at.x - this.posX, at.z - this.posZ),
        hasLineOfSight: true,
        disguised,
        movedRecently: this.seenMovedRecently(other.id, now),
        facingMe: !disguised && this.isAimedAtMe(other),
        tellRecently: disguised ? this.toldRecently(source, at, now) : undefined,
      },
    };
  }

  /**
   * A rustle out of sight, as a place and nothing more: the neighbourhood it
   * came from, named by that neighbourhood rather than by who made it, with no
   * shape, since footsteps through a wall say nothing about what is walking.
   * Following it leads to where it was heard, never on to wherever its maker
   * went next.
   */
  private heardSpot(other: BotPlayer, now: number): Sensed {
    const at = this.sensedPosition(other, false);
    const source = heardSpotSource(at.x, at.z);
    this.spots.set(source, { ...at, heardAt: now });
    return {
      source,
      entity: {
        x: at.x,
        z: at.z,
        distance: Math.hypot(at.x - this.posX, at.z - this.posZ),
        hasLineOfSight: false,
        movedRecently: true,
        facingMe: false,
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
      const source = decoySource(decoy.id);
      if (!this.sightings.has(source)) continue;
      seen.push(this.stillDisguise(source, { x: decoy.x, z: decoy.z }, now));
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
    const sight = this.sight;
    const viewer = this.sensedFrom;
    if (!sight || !viewer) return [];
    const seen: Sensed[] = [];
    for (const [source, { prop, index }] of this.sceneProps) {
      if (
        !sightOf(
          sight,
          viewer,
          this.bodyOf({ ...prop.position, propType: prop.type }, prop.rotation, index),
        )
      )
        continue;
      seen.push(this.stillDisguise(source, { x: prop.position.x, z: prop.position.z }, now));
    }
    return seen;
  }

  /** A shape in sight that never moves. */
  private stillDisguise(source: string, at: Point2, now: number): Sensed {
    this.lastPerceived.set(source, at);
    return {
      source,
      entity: {
        x: at.x,
        z: at.z,
        distance: Math.hypot(at.x - this.posX, at.z - this.posZ),
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

  /**
   * Drop what the bot remembers about players who have left the room, decoys
   * that have broken and spots it has not heard a rustle from for a while.
   * These maps were only ever cleared with the map, so a long session
   * accumulated an entry per player who ever appeared, and a returning id
   * would be measured against a sample from its previous life.
   */
  private forgetDeparted(
    others: readonly BotPlayer[],
    decoys: readonly BotDecoy[],
    now: number,
  ): void {
    const present = new Set(others.map((o) => o.id));
    for (const id of [...this.tracks.keys()]) {
      if (!present.has(id)) this.tracks.delete(id);
    }
    for (const [source, spot] of [...this.spots]) {
      if (now - spot.heardAt > HEARD_SOUND_MEMORY_MS) this.spots.delete(source);
    }
    const live = new Set([
      ...others.map((o) => playerSource(o.id)),
      ...decoys.map((d) => decoySource(d.id)),
      ...this.sceneProps.keys(),
      ...this.spots.keys(),
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
   * The player, decoy, scene prop or heard spot an intent names. Under `"full"`
   * visibility the name is a session id; under `"limited"` it is a handle the
   * observation handed out, which this resolves without the policy ever
   * learning what it stood for.
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
        yaw: modelYaw(other),
        spot: false,
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
        yaw: decoy.rot,
        spot: false,
      };
    }
    const spot = this.spots.get(source);
    if (spot !== undefined) {
      return { source, x: spot.x, y: 0, z: spot.z, propType: "", yaw: 0, spot: true };
    }
    const scene = this.sceneProps.get(source);
    if (scene === undefined) return null;
    const { prop, index } = scene;
    return {
      source,
      x: prop.position.x,
      y: prop.position.y,
      z: prop.position.z,
      propType: prop.type,
      yaw: prop.rotation,
      owner: index,
      spot: false,
    };
  }

  /**
   * The first point of a contact the bot sees this tick, by the same test and
   * from the same viewpoint {@link sense} used, or null. A heard spot is never
   * seen: it is a place.
   */
  private sightOfContact(contact: Contact): Vec3 | null {
    if (contact.spot || !this.sight || !this.sensedFrom) return null;
    if (contact.owner === undefined) return this.sightings.get(contact.source)?.at ?? null;
    return sightOf(this.sight, this.sensedFrom, this.bodyOf(contact, contact.yaw, contact.owner));
  }

  /**
   * Where the bot is entitled to believe a contact is: where it stands while
   * the bot sees it, the last place it was seen once it does not, and for a
   * heard spot the spot itself. Null when the contact has never been sensed.
   *
   * The motor runs on an intent for as long as a decision cycle, so without this
   * it kept reading `world.others`: a target that broke line of sight was still
   * pathed to by its live coordinates, letting a bot follow someone through a
   * wall that a player would have lost.
   */
  private perceivedPosition(contact: Contact, seen: boolean): Point2 | null {
    if (this.visibility === "full" || contact.spot) return { x: contact.x, z: contact.z };
    if (!seen) return this.lastPerceived.get(contact.source) ?? null;
    const at = { x: contact.x, z: contact.z };
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
    this.sense(world, now);
    this.rot = wrapAngle(this.rot - this.glanceApplied);
    this.glanceApplied = 0;
    this.tracking = false;
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
    this.lookAround(intent, world.self.role, dt, now);

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
   * Turn a searching hunter's view off the way it walks now and then (see
   * {@link Glance}), so a limited cone still sweeps the room it walks through.
   * A hunter keeping a target in sight looks at it instead, and a prop never
   * glances: it sees all round, and turning a disguise is a tell. Glances draw
   * on the same random stream as patrol goals, never on the aim's, so where a
   * bot looked never changes how it shoots.
   */
  private lookAround(intent: Intent, role: Role, dt: number, now: number): void {
    const searching =
      this.visibility === "limited" &&
      role === "hunter" &&
      !this.tracking &&
      intent.kind !== "idle" &&
      intent.kind !== "chat";
    if (!searching) {
      this.glance.reset();
      return;
    }
    this.glanceApplied = this.glance.update(now, dt, Math.random);
    this.rot = wrapAngle(this.rot + this.glanceApplied);
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
    const seenAt = this.sightOfContact(target);
    const goal = this.perceivedPosition(target, seenAt !== null);
    if (!goal) return;
    this.closeOn(goal, run, world.self.role, dt, now);
    if (seenAt) this.keepInSight(seenAt);
  }

  /** Walk or run toward a goal, and face it once there is no path left to walk. */
  private closeOn(goal: Point2, run: boolean, role: Role, dt: number, now: number): void {
    this.ensurePath(goal.x, goal.z, now, true);
    const wp = this.follower.advance(this.posX, this.posZ);
    if (wp) this.steer(wp, run, role, dt);
    else this.faceToward(goal.x, goal.z);
  }

  /** Look at a target in sight while closing on it, as a player does, so a turn in the path never loses it. */
  private keepInSight(at: Vec3): void {
    this.tracking = true;
    this.faceToward(at.x, at.z);
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
    const seenAt = this.sightOfContact(target);
    const dir = seenAt
      ? normalize3({ x: seenAt.x - origin.x, y: seenAt.y - origin.y, z: seenAt.z - origin.z })
      : null;
    const dist = Math.hypot(target.x - this.posX, target.z - this.posZ);
    const engageRange = lerp(ENGAGE_RANGE_MIN, ENGAGE_RANGE_MAX, this.difficulty);
    const canHit =
      seenAt !== null &&
      dir !== null &&
      dist <= engageRange &&
      canHitTarget(origin, dir, target.x, target.y, target.z, bounds, map.colliders);

    if (canHit && seenAt && dir) {
      this.follower.clear();
      this.tracking = true;
      const shot = this.aimAndFire(target, seenAt, dir, dist, dt, now);
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
    const goal = this.perceivedPosition(target, seenAt !== null);
    if (!goal) return null;
    this.closeOn(goal, true, world.self.role, dt, now);
    if (seenAt) this.keepInSight(seenAt);
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
   * the bot has seen it, never anything it could not see. It aims at the part
   * of the target it sees, so a disguise half behind a cabinet is shot at by
   * the half that shows.
   */
  private aimAndFire(
    target: Contact,
    seenAt: Vec3,
    dir: Vec3,
    distance: number,
    dt: number,
    now: number,
  ): MotorOutput["shoot"] {
    const dx = seenAt.x - this.posX;
    const dz = seenAt.z - this.posZ;
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
