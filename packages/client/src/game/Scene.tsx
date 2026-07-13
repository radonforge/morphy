import type { Room } from "@colyseus/sdk";
import { Billboard, Sky, Text, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AIR_CONTROL,
  computePropBounds,
  FALL_GRAVITY_MULT,
  GRAVITY,
  INPUT_IDLE_EPSILON,
  INPUT_SEND_RATE_MS,
  JUMP_BUFFER_MS,
  JUMP_RELEASE_GRAVITY_MULT,
  JUMP_SPEED,
  MAP_CATALOG,
  type MapBounds,
  type MapDefinition,
  MOVE_ACCEL,
  MOVE_DECEL,
  MOVE_SPEED,
  MSG_DECOY,
  MSG_INPUT,
  MSG_REROLL,
  MSG_SHOOT,
  type Phase,
  PLAYER_HEIGHT,
  PROP_TURN_SNAP,
  PROP_TURN_SPEED,
  PROP_TURN_TAP_MS,
  type PrimitiveSpec,
  type PropBounds,
  type PropDefinition,
  type Role,
  RUN_MULTIPLIER_HUNTER,
  RUN_MULTIPLIER_PROP,
  type SceneryInstance,
  type TileInstance,
  WEAPONS,
  type WeaponId,
} from "@webhunt/shared";
import { memo, type ReactElement, Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { playJump, playLand, playMorph, playStep, playWeaponShot } from "./audio";
import type {
  BreaksRef,
  DecoyBreakFx,
  DecoyView,
  MetaMap,
  PlayersRef,
  RemotePlayerView,
  ShotsRef,
  TauntPulseRef,
  TeleportRef,
} from "./types";
import { useControls } from "./useControls";

function applyTauntPulse(
  group: THREE.Group,
  pulses: TauntPulseRef,
  id: string,
  delta: number,
): void {
  const remaining = pulses.current.get(id) ?? 0;
  if (remaining <= 0) {
    group.scale.setScalar(1);
    return;
  }
  const next = Math.max(0, remaining - delta);
  pulses.current.set(id, next);
  const progress = 1 - next / TAUNT_PULSE_SECONDS;
  group.scale.setScalar(1 + TAUNT_AMPLITUDE * Math.sin(progress * Math.PI));
}

const PLAYER_RADIUS = 0.4;
const PLAYER_SEPARATION = PLAYER_RADIUS * 2;
const STEP_HEIGHT = 0.35;
const GROUND_EPSILON = 1e-3;
const FURNITURE_MIN_RADIUS = 0.3;
const PLAYER_BODY_LENGTH = 0.9;
const PLAYER_BODY_Y = PLAYER_BODY_LENGTH / 2 + PLAYER_RADIUS;
const PLAYER_HEAD_Y = PLAYER_BODY_LENGTH + PLAYER_RADIUS * 1.6;
const HUNTER_COLOR = "#e8564a";
const PROP_COLOR = "#5bd75b";
const MODEL_MIN_SIZE = 0.001;
const BASE_PLANE_MARGIN = 8;
const BASE_PLANE_Y = -0.02;
const animalModel = (id: string): string => `/models/pets/animal-${id}.glb`;
const WEAPON_SCALE = 0.32;
const WEAPON_OFFSET: [number, number, number] = [0.2, -0.22, -0.6];
const WEAPON_ROTATION: [number, number, number] = [0, Math.PI, 0];
const NAMEPLATE_GAP = 0.45;
const NAMEPLATE_FONT_SIZE = 0.34;
const NAMEPLATE_COLOR = "#eef4ff";
const NAMEPLATE_OUTLINE_COLOR = "#11161f";
const NAMEPLATE_OUTLINE_WIDTH = 0.03;

const CAMERA_DISTANCE = 8;
const CAMERA_TARGET_Y = 1.2;
const CAMERA_DAMP = 0.0008;
const CAMERA_WALL_MARGIN = 0.35;
const CAMERA_MIN_DISTANCE = 0.2;
const CAMERA_SLAB_EPSILON = 1e-4;
const CAMERA_OCCLUDER_BASE_MAX = 0.5;
const CAMERA_OCCLUDER_TOP_MIN = 2.5;
const REMOTE_DAMP = 0.0009;
export const TAUNT_PULSE_SECONDS = 0.5;
const TAUNT_AMPLITUDE = 0.18;
const TRACER_TTL = 0.12;
const MAX_TRACERS = 16;
const MORPH_COLOR = "#7de8ff";
const MORPH_MAX_BURSTS = 6;
const MORPH_DURATION_S = 0.5;
const MORPH_BEAM_DURATION_S = 0.3;
const MORPH_BEAM_GROW_FRACTION = 0.35;
const MORPH_BEAM_OPACITY = 0.55;
const MORPH_BEAM_SEGMENTS = 12;
const MORPH_BEAM_RADIUS_MULT = 1.15;
const MORPH_BEAM_HEIGHT_MULT = 1.6;
const MORPH_SHARD_COUNT = 24;
const MORPH_SHARD_SIZE = 0.14;
const MORPH_SHARD_SPAWN_RADIUS = 1.4;
const MORPH_SHARD_SPAWN_HEIGHT_MULT = 1.5;
const MORPH_SHARD_SPIN = 9;
const MORPH_POP_DURATION_S = 0.35;
const BREAK_MAX_BURSTS = 4;
const BREAK_CHUNK_COUNT = 16;
const BREAK_DURATION_S = 0.6;
const BREAK_CHUNK_SIZE = 0.16;
const BREAK_GRAVITY = 10;
const BREAK_OUT_SPEED_MIN = 2;
const BREAK_OUT_SPEED_MAX = 4;
const BREAK_UP_SPEED_MIN = 1.2;
const BREAK_UP_SPEED_MAX = 3.2;
const BREAK_SPIN = 12;
const BREAK_FLASH_DURATION_S = 0.15;
const BREAK_FLASH_COLOR = "#ffc98a";
const BREAK_FLASH_OPACITY = 0.75;
const BREAK_FLASH_RADIUS_MULT = 1.25;
const EASE_BACK_OVERSHOOT = 1.70158;
const MORPH_SOUND_MAX_DISTANCE = 24;
const MORPH_REMOTE_VOLUME = 0.8;
const STEP_DISTANCE = 2.2;
const REMOTE_STEP_MAX_DISTANCE = 24;
const REMOTE_STEP_VOLUME = 0.8;
const REMOTE_STEP_TELEPORT_SKIP = 2;
const LOOK_SENSITIVITY = 0.0025;
const PITCH_MIN = -1.4;
const PITCH_MAX = 1.4;
const TP_PITCH_MIN = -0.15;
const TP_PITCH_MAX = 1.2;
const DEFAULT_PITCH = 0.5;
const EYE_HEIGHT = 1.6;
const SUN_POSITION: [number, number, number] = [14, 26, 10];
const SHADOW_MAP_SIZE = 2048;
const SHADOW_MARGIN = 4;
const SHADOW_NORMAL_BIAS_TEXELS = 2;
const SHADOW_UPDATE_INTERVAL_S = 1 / 30;
const SHADOW_SETTLE_S = 0.4;
const SHADOW_HEARTBEAT_S = 2;
const UP = new THREE.Vector3(0, 1, 0);
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const noRaycast = () => {};
const LOCAL_AVATAR_KEY = "localAvatar";

export const GAME_FOV = 55;
export const GAME_DPR: [number, number] = [1, 1.25];
const SPRINT_FOV_ADD = 7;
const FOV_DAMP = 0.02;
const FOV_EPSILON = 0.05;
const HEADING_MIN_SPEED = 0.4;
const HEADING_DAMP = 1e-8;
const RECOIL_MAX_PITCH = 0.045;
const RECOIL_DAMP = 1e-8;
const LAND_DIP_Y = 0.16;
const LAND_DAMP = 5e-7;
const WEAPON_BOB_FREQ = 1.9;
const WEAPON_BOB_X = 0.014;
const WEAPON_BOB_Y = 0.011;
const WEAPON_SWAY = 0.9;
const WEAPON_SWAY_MAX = 0.06;
const WEAPON_SWAY_DAMP = 1e-5;
const WEAPON_KICK_Z = 0.11;
const WEAPON_KICK_ROT = 0.12;

/** Per-theme sky/light/ground preset, keyed by `MapInfo.theme`; falls back to {@link DEFAULT_THEME}. */
interface ThemePreset {
  ground: string;
  background: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambient: number;
  dir: number;
  sky: boolean;
  turbidity: number;
  rayleigh: number;
}

const DEFAULT_THEME: ThemePreset = {
  ground: "#9c5a40",
  background: "#adcdec",
  hemiSky: "#cfe2f7",
  hemiGround: "#7a6e5c",
  hemiIntensity: 1.0,
  ambient: 0.7,
  dir: 1.4,
  sky: true,
  turbidity: 6,
  rayleigh: 1.2,
};

const THEMES: Record<string, ThemePreset> = {
  station: {
    ground: "#3a414e",
    background: "#0e131b",
    hemiSky: "#b8c8de",
    hemiGround: "#42474f",
    hemiIntensity: 1.05,
    ambient: 0.85,
    dir: 1.15,
    sky: true,
    turbidity: 9,
    rayleigh: 0.5,
  },
  mars: {
    ground: "#9c5a40",
    background: "#c89a78",
    hemiSky: "#e8b48f",
    hemiGround: "#5a3a2c",
    hemiIntensity: 1.1,
    ambient: 0.8,
    dir: 1.5,
    sky: false,
    turbidity: 6,
    rayleigh: 1.2,
  },
  urban: {
    ground: "#5b5f66",
    background: "#acc6e0",
    hemiSky: "#d4e3f6",
    hemiGround: "#6a6f78",
    hemiIntensity: 1.0,
    ambient: 0.8,
    dir: 1.45,
    sky: true,
    turbidity: 4,
    rayleigh: 1.4,
  },
};

function themeFor(mapId: string): ThemePreset {
  const theme = MAP_CATALOG.find((m) => m.id === mapId)?.theme;
  return (theme && THEMES[theme]) || DEFAULT_THEME;
}

type Catalog = Map<string, PropDefinition>;

/**
 * A solid box for movement collision: Y-rotated by the angle whose cos/sin are
 * precomputed, spanning [yMin, yMax] vertically. Map colliders are axis-aligned
 * (cos 1, sin 0); prop parts carry their instance rotation, so long furniture
 * blocks by its true oriented footprint instead of a bounding circle.
 */
interface ObbCollider {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hx: number;
  hz: number;
  yMin: number;
  yMax: number;
}

function buildColliders(map: MapDefinition, catalog: Catalog): ObbCollider[] {
  const colliders: ObbCollider[] = [];
  for (const collider of map.colliders) {
    colliders.push({
      x: collider.position.x,
      z: collider.position.z,
      cos: 1,
      sin: 0,
      hx: collider.size.x / 2,
      hz: collider.size.z / 2,
      yMin: collider.position.y - collider.size.y / 2,
      yMax: collider.position.y + collider.size.y / 2,
    });
  }
  for (const instance of map.props) {
    const def = catalog.get(instance.type);
    if (!def) continue;
    const cos = Math.cos(instance.rotation);
    const sin = Math.sin(instance.rotation);
    for (const part of def.parts) {
      const hx = part.size.x / 2;
      const hz = part.size.z / 2;
      const reach = Math.hypot(part.position.x, part.position.z) + Math.max(hx, hz);
      if (reach < FURNITURE_MIN_RADIUS) continue;
      colliders.push({
        x: instance.position.x + part.position.x * cos + part.position.z * sin,
        z: instance.position.z - part.position.x * sin + part.position.z * cos,
        cos,
        sin,
        hx,
        hz,
        yMin: instance.position.y + part.position.y - part.size.y / 2,
        yMax: instance.position.y + part.position.y + part.size.y / 2,
      });
    }
  }
  return colliders;
}

/**
 * Highest collider top the player's footprint circle overlaps that is no more
 * than a step above the feet — the surface the player stands on (base ground 0).
 */
function supportHeightAt(x: number, z: number, footY: number, colliders: ObbCollider[]): number {
  let best = 0;
  for (const c of colliders) {
    if (c.yMax <= best || c.yMax > footY + STEP_HEIGHT) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const ox = lx - THREE.MathUtils.clamp(lx, -c.hx, c.hx);
    const oz = lz - THREE.MathUtils.clamp(lz, -c.hz, c.hz);
    if (ox * ox + oz * oz < PLAYER_RADIUS * PLAYER_RADIUS) best = c.yMax;
  }
  return best;
}

/**
 * Lowest collider bottom at or above the player's head over the footprint
 * circle — the ceiling that caps upward motion (Infinity under open sky).
 * Keeps a jump under an elevated deck from entering the deck box, where
 * {@link resolveColliders} would otherwise shove the player sideways.
 */
function ceilingHeightAt(x: number, z: number, footY: number, colliders: ObbCollider[]): number {
  let best = Infinity;
  for (const c of colliders) {
    if (c.yMin >= best || c.yMin < footY + PLAYER_HEIGHT) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const ox = lx - THREE.MathUtils.clamp(lx, -c.hx, c.hx);
    const oz = lz - THREE.MathUtils.clamp(lz, -c.hz, c.hz);
    if (ox * ox + oz * oz < PLAYER_RADIUS * PLAYER_RADIUS) best = c.yMin;
  }
  return best;
}

/**
 * Push the player's footprint circle out of every solid box overlapping its
 * vertical span. Boxes whose top is within a step of the feet are walkable
 * (handled by {@link supportHeightAt}); boxes above the head are ignored.
 */
function resolveColliders(pos: THREE.Vector3, colliders: ObbCollider[]): void {
  for (const c of colliders) {
    if (c.yMax <= pos.y + STEP_HEIGHT || c.yMin >= pos.y + PLAYER_HEIGHT) continue;
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const nx = THREE.MathUtils.clamp(lx, -c.hx, c.hx);
    const nz = THREE.MathUtils.clamp(lz, -c.hz, c.hz);
    const ox = lx - nx;
    const oz = lz - nz;
    const distSq = ox * ox + oz * oz;
    if (distSq >= PLAYER_RADIUS * PLAYER_RADIUS) continue;
    let pushX = 0;
    let pushZ = 0;
    if (distSq > 1e-8) {
      const dist = Math.sqrt(distSq);
      const push = PLAYER_RADIUS - dist;
      pushX = (ox / dist) * push;
      pushZ = (oz / dist) * push;
    } else {
      const toMinX = lx + c.hx;
      const toMaxX = c.hx - lx;
      const toMinZ = lz + c.hz;
      const toMaxZ = c.hz - lz;
      const minPen = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
      if (minPen === toMinX) pushX = -(toMinX + PLAYER_RADIUS);
      else if (minPen === toMaxX) pushX = toMaxX + PLAYER_RADIUS;
      else if (minPen === toMinZ) pushZ = -(toMinZ + PLAYER_RADIUS);
      else pushZ = toMaxZ + PLAYER_RADIUS;
    }
    pos.x += pushX * c.cos + pushZ * c.sin;
    pos.z += -pushX * c.sin + pushZ * c.cos;
  }
}

interface Wall {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Camera-occluding footprints: only wall-like boxes (grounded and tall) count,
 * so elevated decks and stair steps never yank the third-person camera in.
 */
function buildWalls(map: MapDefinition): Wall[] {
  return map.colliders
    .filter((collider) => {
      const yMin = collider.position.y - collider.size.y / 2;
      const yMax = collider.position.y + collider.size.y / 2;
      return yMin <= CAMERA_OCCLUDER_BASE_MAX && yMax >= CAMERA_OCCLUDER_TOP_MIN;
    })
    .map((collider) => ({
      minX: collider.position.x - collider.size.x / 2,
      maxX: collider.position.x + collider.size.x / 2,
      minZ: collider.position.z - collider.size.z / 2,
      maxZ: collider.position.z + collider.size.z / 2,
    }));
}

function nearestWallDistanceXZ(
  fromX: number,
  fromZ: number,
  dirX: number,
  dirZ: number,
  maxDist: number,
  walls: Wall[],
): number {
  let nearest = maxDist;
  for (const wall of walls) {
    let tEnter = 0;
    let tExit = maxDist;
    if (Math.abs(dirX) < CAMERA_SLAB_EPSILON) {
      if (fromX < wall.minX || fromX > wall.maxX) continue;
    } else {
      let t1 = (wall.minX - fromX) / dirX;
      let t2 = (wall.maxX - fromX) / dirX;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tEnter) tEnter = t1;
      if (t2 < tExit) tExit = t2;
    }
    if (Math.abs(dirZ) < CAMERA_SLAB_EPSILON) {
      if (fromZ < wall.minZ || fromZ > wall.maxZ) continue;
    } else {
      let t1 = (wall.minZ - fromZ) / dirZ;
      let t2 = (wall.maxZ - fromZ) / dirZ;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tEnter) tEnter = t1;
      if (t2 < tExit) tExit = t2;
    }
    if (tEnter <= tExit && tEnter < nearest) nearest = tEnter;
  }
  return nearest;
}

interface TracerState {
  ox: number;
  oy: number;
  oz: number;
  ex: number;
  ey: number;
  ez: number;
  ttl: number;
  color: string;
}

type PlayerPosRef = { readonly current: THREE.Vector3 };

interface LocalMotion {
  speed: number;
  sprinting: boolean;
  grounded: boolean;
  yaw: number;
  pitch: number;
  recoil: number;
  landing: number;
}

type LocalMotionRef = { readonly current: LocalMotion };

interface SceneProps {
  room: Room;
  map: MapDefinition;
  localId: string;
  ids: string[];
  playersRef: PlayersRef;
  meta: MetaMap;
  phase: Phase;
  decoys: DecoyView[];
  teleportRef: TeleportRef;
  tauntPulseRef: TauntPulseRef;
  shotsRef: ShotsRef;
  breaksRef: BreaksRef;
  weapon: WeaponId;
  chatOpen: boolean;
  onShoot: () => void;
}

export function Scene({
  room,
  map,
  localId,
  ids,
  playersRef,
  meta,
  phase,
  decoys,
  teleportRef,
  tauntPulseRef,
  shotsRef,
  breaksRef,
  weapon,
  chatOpen,
  onShoot,
}: SceneProps) {
  const catalog = useMemo<Catalog>(
    () => new Map(map.propCatalog.map((def) => [def.id, def])),
    [map],
  );
  const colliders = useMemo(() => buildColliders(map, catalog), [map, catalog]);
  const walls = useMemo(() => buildWalls(map), [map]);
  const theme = useMemo(() => themeFor(map.id), [map.id]);
  const localGroundRef = useRef(new THREE.Vector3());
  const motionRef = useRef<LocalMotion>({
    speed: 0,
    sprinting: false,
    grounded: true,
    yaw: 0,
    pitch: DEFAULT_PITCH,
    recoil: 0,
    landing: 0,
  });
  const localMeta = meta[localId];
  const localRole: Role = localMeta?.role ?? "prop";
  const localAlive = localMeta?.alive ?? true;
  const morphsRef = useRef<MorphFx[]>([]);
  const seenPropTypes = useRef(new Map<string, string>());
  const renderPosesRef = useRef(new Map<string, { x: number; z: number }>());

  useEffect(() => {
    const seen = seenPropTypes.current;
    const live = new Set(ids);
    for (const id of ids) {
      const propType = meta[id]?.propType ?? "";
      const before = seen.get(id);
      seen.set(id, propType);
      if (before === undefined || before === propType || !propType) continue;
      const def = catalog.get(propType);
      if (!def) continue;
      const bounds = computePropBounds(def);
      const local = id === localId;
      const source = local
        ? localGroundRef.current
        : (renderPosesRef.current.get(id) ?? playersRef.current.get(id));
      if (!source) continue;
      morphsRef.current.push({
        x: source.x,
        z: source.z,
        radius: bounds.radius,
        height: bounds.yMax,
      });
      const distance = local
        ? 0
        : Math.hypot(source.x - localGroundRef.current.x, source.z - localGroundRef.current.z);
      playMorph(
        local ? 1 : MORPH_REMOTE_VOLUME * Math.max(0, 1 - distance / MORPH_SOUND_MAX_DISTANCE),
      );
    }
    for (const id of seen.keys()) {
      if (!live.has(id)) {
        seen.delete(id);
        renderPosesRef.current.delete(id);
      }
    }
  }, [meta, ids, localId, catalog, playersRef]);
  const canTransform =
    localRole === "prop" && localAlive && !chatOpen && (phase === "hiding" || phase === "hunting");
  const canShoot = localRole === "hunter" && localAlive && !chatOpen && phase === "hunting";

  return (
    <>
      <color attach="background" args={[theme.background]} />
      {theme.sky && (
        <Sky sunPosition={SUN_POSITION} turbidity={theme.turbidity} rayleigh={theme.rayleigh} />
      )}
      <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
      <ambientLight intensity={theme.ambient} />
      <ShadowRefresh
        playersRef={playersRef}
        localPos={localGroundRef}
        motionRef={motionRef}
        meta={meta}
        ids={ids}
        tauntPulseRef={tauntPulseRef}
      />
      <SunLight intensity={theme.dir} bounds={map.bounds} />
      <MapView map={map} groundColor={theme.ground} />
      <PropActions room={room} enabled={canTransform} />
      <Decoys decoys={decoys} catalog={catalog} />
      <Shooter
        room={room}
        enabled={canShoot}
        weapon={weapon}
        motionRef={motionRef}
        onShoot={onShoot}
      />
      <Tracers shotsRef={shotsRef} />
      <MorphEffects morphsRef={morphsRef} />
      <DecoyBreakEffects breaksRef={breaksRef} catalog={catalog} />
      <HunterViewmodel
        enabled={localRole === "hunter" && localAlive}
        weapon={weapon}
        motionRef={motionRef}
      />
      <LocalPlayer
        room={room}
        map={map}
        catalog={catalog}
        id={localId}
        role={localRole}
        propType={localMeta?.propType ?? ""}
        phase={phase}
        alive={localAlive}
        teleportRef={teleportRef}
        tauntPulseRef={tauntPulseRef}
        chatOpen={chatOpen}
        playersRef={playersRef}
        colliders={colliders}
        walls={walls}
        avatar={localMeta?.avatar ?? ""}
        playerPos={localGroundRef}
        motionRef={motionRef}
      />
      {ids
        .filter((id) => id !== localId && (meta[id]?.alive ?? true))
        .map((id) => (
          <RemotePlayer
            key={id}
            view={playersRef.current.get(id)}
            catalog={catalog}
            role={meta[id]?.role ?? "prop"}
            localRole={localRole}
            propType={meta[id]?.propType ?? ""}
            avatar={meta[id]?.avatar ?? ""}
            tauntPulseRef={tauntPulseRef}
            localPos={localGroundRef}
            renderPoses={renderPosesRef}
          />
        ))}
    </>
  );
}

interface ShadowPose {
  x: number;
  y: number;
  z: number;
  rot: number;
}

function ShadowRefresh({
  playersRef,
  localPos,
  motionRef,
  meta,
  ids,
  tauntPulseRef,
}: {
  playersRef: PlayersRef;
  localPos: PlayerPosRef;
  motionRef: LocalMotionRef;
  meta: MetaMap;
  ids: string[];
  tauntPulseRef: TauntPulseRef;
}) {
  const gl = useThree((state) => state.gl);
  const checkAccum = useRef(0);
  const sinceRender = useRef(0);
  const sinceChange = useRef(0);
  const remotePoses = useRef(new Map<string, ShadowPose>());
  const localPose = useRef<ShadowPose>({
    x: Number.NaN,
    y: Number.NaN,
    z: Number.NaN,
    rot: Number.NaN,
  });

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: meta/ids are triggers, not read in the body — a roster/meta change must reset the shadow-settle timer.
  useEffect(() => {
    sinceChange.current = 0;
  }, [meta, ids]);

  useFrame((_, delta) => {
    checkAccum.current += delta;
    sinceRender.current += delta;
    sinceChange.current += delta;
    if (checkAccum.current < SHADOW_UPDATE_INTERVAL_S) return;
    checkAccum.current = 0;

    const pos = localPos.current;
    const yaw = motionRef.current.yaw;
    const local = localPose.current;
    if (
      !(Math.abs(pos.x - local.x) < INPUT_IDLE_EPSILON) ||
      !(Math.abs(pos.y - local.y) < INPUT_IDLE_EPSILON) ||
      !(Math.abs(pos.z - local.z) < INPUT_IDLE_EPSILON) ||
      !(Math.abs(yaw - local.rot) < INPUT_IDLE_EPSILON)
    ) {
      localPose.current = { x: pos.x, y: pos.y, z: pos.z, rot: yaw };
      sinceChange.current = 0;
    }

    const poses = remotePoses.current;
    for (const [id, view] of playersRef.current) {
      const prev = poses.get(id);
      if (!prev) {
        poses.set(id, { x: view.x, y: view.y, z: view.z, rot: view.rot });
        sinceChange.current = 0;
        continue;
      }
      if (
        Math.abs(view.x - prev.x) > INPUT_IDLE_EPSILON ||
        Math.abs(view.y - prev.y) > INPUT_IDLE_EPSILON ||
        Math.abs(view.z - prev.z) > INPUT_IDLE_EPSILON ||
        Math.abs(view.rot - prev.rot) > INPUT_IDLE_EPSILON
      ) {
        prev.x = view.x;
        prev.y = view.y;
        prev.z = view.z;
        prev.rot = view.rot;
        sinceChange.current = 0;
      }
    }
    for (const id of poses.keys()) {
      if (!playersRef.current.has(id)) {
        poses.delete(id);
        sinceChange.current = 0;
      }
    }

    for (const remaining of tauntPulseRef.current.values()) {
      if (remaining > 0) {
        sinceChange.current = 0;
        break;
      }
    }

    if (sinceChange.current <= SHADOW_SETTLE_S || sinceRender.current >= SHADOW_HEARTBEAT_S) {
      sinceRender.current = 0;
      gl.shadowMap.needsUpdate = true;
    }
  });

  return null;
}

function SunLight({ intensity, bounds }: { intensity: number; bounds: MapBounds }) {
  const frustum = useMemo(() => {
    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cz = (bounds.min.z + bounds.max.z) / 2;
    const radius =
      Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2 + SHADOW_MARGIN;
    const far =
      Math.hypot(SUN_POSITION[0], SUN_POSITION[1], SUN_POSITION[2]) + radius + SHADOW_MARGIN;
    const normalBias = ((2 * radius) / SHADOW_MAP_SIZE) * SHADOW_NORMAL_BIAS_TEXELS;
    return { cx, cz, radius, far, normalBias };
  }, [bounds]);
  const target = useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(frustum.cx, 0, frustum.cz);
    object.updateMatrixWorld();
    return object;
  }, [frustum]);

  return (
    <>
      <directionalLight
        position={[frustum.cx + SUN_POSITION[0], SUN_POSITION[1], frustum.cz + SUN_POSITION[2]]}
        target={target}
        intensity={intensity}
        castShadow
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-camera-near={1}
        shadow-camera-far={frustum.far}
        shadow-camera-left={-frustum.radius}
        shadow-camera-right={frustum.radius}
        shadow-camera-top={frustum.radius}
        shadow-camera-bottom={-frustum.radius}
        shadow-bias={-0.0004}
        shadow-normalBias={frustum.normalBias}
      />
      <primitive object={target} />
    </>
  );
}

function Shooter({
  room,
  enabled,
  weapon,
  motionRef,
  onShoot,
}: {
  room: Room;
  enabled: boolean;
  weapon: WeaponId;
  motionRef: LocalMotionRef;
  onShoot: () => void;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const lastShotAt = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const el = gl.domElement;
    const onClick = () => {
      if (document.pointerLockElement !== el) {
        return;
      }
      const spec = WEAPONS[weapon];
      const now = performance.now();
      if (now - lastShotAt.current < spec.cooldownMs) {
        return;
      }
      lastShotAt.current = now;
      raycaster.setFromCamera(SCREEN_CENTER, camera);
      const o = raycaster.ray.origin;
      const d = raycaster.ray.direction;
      room.send(MSG_SHOOT, {
        origin: { x: o.x, y: o.y, z: o.z },
        dir: { x: d.x, y: d.y, z: d.z },
      });
      playWeaponShot(weapon);
      onShoot();
      motionRef.current.recoil = spec.recoil;
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [enabled, camera, gl, raycaster, room, weapon, motionRef, onShoot]);

  return null;
}

function Tracers({ shotsRef }: { shotsRef: ShotsRef }) {
  const tracersRef = useRef<TracerState[]>([]);
  const pool = useMemo(() => {
    const group = new THREE.Group();
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({ transparent: true });
      const line = new THREE.Line(geometry, material);
      line.visible = false;
      line.frustumCulled = false;
      group.add(line);
    }
    return group;
  }, []);

  useEffect(
    () => () => {
      for (const child of pool.children) {
        const line = child as THREE.Line;
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
    },
    [pool],
  );

  useFrame((_, delta) => {
    const tracers = tracersRef.current;
    for (const shot of shotsRef.current) {
      const color = WEAPONS[shot.weapon].tracerColor;
      for (const end of shot.ends) {
        tracers.push({
          ox: shot.origin.x,
          oy: shot.origin.y,
          oz: shot.origin.z,
          ex: end.x,
          ey: end.y,
          ez: end.z,
          ttl: TRACER_TTL,
          color,
        });
      }
    }
    shotsRef.current.length = 0;
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tracer = tracers[i];
      if (!tracer) continue;
      tracer.ttl -= delta;
      if (tracer.ttl <= 0) tracers.splice(i, 1);
    }
    if (tracers.length > MAX_TRACERS) tracers.splice(0, tracers.length - MAX_TRACERS);
    pool.children.forEach((child, i) => {
      const line = child as THREE.Line;
      const tracer = tracers[i];
      if (!tracer) {
        line.visible = false;
        return;
      }
      const position = (line.geometry as THREE.BufferGeometry).getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      position.setXYZ(0, tracer.ox, tracer.oy, tracer.oz);
      position.setXYZ(1, tracer.ex, tracer.ey, tracer.ez);
      position.needsUpdate = true;
      const material = line.material as THREE.LineBasicMaterial;
      material.color.set(tracer.color);
      material.opacity = tracer.ttl / TRACER_TTL;
      line.visible = true;
    });
  });

  return <primitive object={pool} />;
}

interface MorphFx {
  x: number;
  z: number;
  radius: number;
  height: number;
}

type MorphFxRef = { readonly current: MorphFx[] };

type RenderPosesRef = { readonly current: Map<string, { x: number; z: number }> };

interface MorphBurstState extends MorphFx {
  age: number;
}

function MorphEffects({ morphsRef }: { morphsRef: MorphFxRef }) {
  const burstsRef = useRef<MorphBurstState[]>([]);
  const shardMeshRef = useRef<THREE.InstancedMesh>(null);
  const beams = useMemo(() => {
    const group = new THREE.Group();
    for (let i = 0; i < MORPH_MAX_BURSTS; i++) {
      const geometry = new THREE.CylinderGeometry(1, 1, 1, MORPH_BEAM_SEGMENTS, 1, true);
      const material = new THREE.MeshBasicMaterial({
        color: MORPH_COLOR,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.raycast = noRaycast;
      group.add(mesh);
    }
    return group;
  }, []);
  const seeds = useMemo(
    () =>
      Array.from({ length: MORPH_SHARD_COUNT }, (_, i) => ({
        angle: (i / MORPH_SHARD_COUNT) * Math.PI * 2 + Math.random(),
        yFrac: Math.random(),
        spinX: (Math.random() - 0.5) * MORPH_SHARD_SPIN,
        spinZ: (Math.random() - 0.5) * MORPH_SHARD_SPIN,
      })),
    [],
  );
  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      euler: new THREE.Euler(),
      scale: new THREE.Vector3(),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const child of beams.children) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
    [beams],
  );

  useFrame((_, delta) => {
    const bursts = burstsRef.current;
    for (const fx of morphsRef.current) {
      if (bursts.length >= MORPH_MAX_BURSTS) bursts.shift();
      bursts.push({ ...fx, age: 0 });
    }
    morphsRef.current.length = 0;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const burst = bursts[i];
      if (!burst) continue;
      burst.age += delta;
      if (burst.age >= MORPH_DURATION_S) bursts.splice(i, 1);
    }

    beams.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const burst = bursts[i];
      if (!burst || burst.age >= MORPH_BEAM_DURATION_S) {
        mesh.visible = false;
        return;
      }
      const t = burst.age / MORPH_BEAM_DURATION_S;
      const growth = Math.min(1, t / MORPH_BEAM_GROW_FRACTION);
      const height = Math.max(burst.height, PLAYER_BODY_LENGTH) * MORPH_BEAM_HEIGHT_MULT * growth;
      const radius = burst.radius * MORPH_BEAM_RADIUS_MULT;
      mesh.position.set(burst.x, height / 2, burst.z);
      mesh.scale.set(radius, Math.max(height, MODEL_MIN_SIZE), radius);
      (mesh.material as THREE.MeshBasicMaterial).opacity = MORPH_BEAM_OPACITY * (1 - t);
      mesh.visible = true;
    });

    const shardMesh = shardMeshRef.current;
    if (!shardMesh) return;
    let written = 0;
    for (const burst of bursts) {
      const t = Math.min(1, burst.age / MORPH_DURATION_S);
      const convergence = t * t;
      const radial = (burst.radius + MORPH_SHARD_SPAWN_RADIUS) * (1 - convergence);
      const size = Math.max(MORPH_SHARD_SIZE * (1 - t), MODEL_MIN_SIZE);
      const spawnHeight =
        Math.max(burst.height, PLAYER_BODY_LENGTH) * MORPH_SHARD_SPAWN_HEIGHT_MULT;
      for (const seed of seeds) {
        const y = THREE.MathUtils.lerp(seed.yFrac * spawnHeight, burst.height / 2, convergence);
        scratch.position.set(
          burst.x + Math.cos(seed.angle) * radial,
          y,
          burst.z + Math.sin(seed.angle) * radial,
        );
        scratch.euler.set(seed.spinX * burst.age, 0, seed.spinZ * burst.age);
        scratch.quaternion.setFromEuler(scratch.euler);
        scratch.scale.setScalar(size);
        shardMesh.setMatrixAt(
          written,
          scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale),
        );
        written++;
      }
    }
    shardMesh.count = written;
    shardMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={beams} />
      <instancedMesh
        ref={shardMeshRef}
        args={[undefined, undefined, MORPH_MAX_BURSTS * MORPH_SHARD_COUNT]}
        frustumCulled={false}
        raycast={noRaycast}
      >
        <boxGeometry />
        <meshBasicMaterial
          color={MORPH_COLOR}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </>
  );
}

interface BreakChunkState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinZ: number;
  color: THREE.Color;
}

interface BreakBurstState {
  x: number;
  y: number;
  z: number;
  radius: number;
  age: number;
  chunks: BreakChunkState[];
}

function spawnBreakChunks(
  fx: DecoyBreakFx,
  def: PropDefinition,
  bounds: PropBounds,
): BreakChunkState[] {
  const chunks: BreakChunkState[] = [];
  for (let i = 0; i < BREAK_CHUNK_COUNT; i++) {
    const part = def.parts[Math.floor(Math.random() * def.parts.length)];
    const angle = Math.random() * Math.PI * 2;
    const spawnRadius = bounds.radius * Math.sqrt(Math.random());
    const outSpeed = THREE.MathUtils.lerp(BREAK_OUT_SPEED_MIN, BREAK_OUT_SPEED_MAX, Math.random());
    chunks.push({
      x: fx.x + Math.cos(angle) * spawnRadius,
      y: fx.y + THREE.MathUtils.lerp(bounds.yMin, bounds.yMax, Math.random()),
      z: fx.z + Math.sin(angle) * spawnRadius,
      vx: Math.cos(angle) * outSpeed,
      vy: THREE.MathUtils.lerp(BREAK_UP_SPEED_MIN, BREAK_UP_SPEED_MAX, Math.random()),
      vz: Math.sin(angle) * outSpeed,
      spinX: (Math.random() - 0.5) * BREAK_SPIN,
      spinZ: (Math.random() - 0.5) * BREAK_SPIN,
      color: new THREE.Color(part?.color ?? MORPH_COLOR),
    });
  }
  return chunks;
}

/**
 * Pooled shatter bursts for broken decoys, mirroring the {@link MorphEffects}
 * architecture: one instanced mesh of tumbling chunks tinted from the prop's
 * part colors plus a brief additive flash at the decoy center.
 */
function DecoyBreakEffects({ breaksRef, catalog }: { breaksRef: BreaksRef; catalog: Catalog }) {
  const burstsRef = useRef<BreakBurstState[]>([]);
  const chunkMeshRef = useRef<THREE.InstancedMesh>(null);
  const flashes = useMemo(() => {
    const group = new THREE.Group();
    for (let i = 0; i < BREAK_MAX_BURSTS; i++) {
      const geometry = new THREE.SphereGeometry(1, 12, 12);
      const material = new THREE.MeshBasicMaterial({
        color: BREAK_FLASH_COLOR,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.raycast = noRaycast;
      group.add(mesh);
    }
    return group;
  }, []);
  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      euler: new THREE.Euler(),
      scale: new THREE.Vector3(),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const child of flashes.children) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
    [flashes],
  );

  useFrame((_, delta) => {
    const bursts = burstsRef.current;
    for (const fx of breaksRef.current) {
      const def = catalog.get(fx.propType);
      if (!def) continue;
      if (bursts.length >= BREAK_MAX_BURSTS) bursts.shift();
      const bounds = computePropBounds(def);
      bursts.push({
        x: fx.x,
        y: fx.y + (bounds.yMin + bounds.yMax) / 2,
        z: fx.z,
        radius: Math.max(bounds.radius, MODEL_MIN_SIZE),
        age: 0,
        chunks: spawnBreakChunks(fx, def, bounds),
      });
    }
    breaksRef.current.length = 0;

    for (let i = bursts.length - 1; i >= 0; i--) {
      const burst = bursts[i];
      if (!burst) continue;
      burst.age += delta;
      if (burst.age >= BREAK_DURATION_S) bursts.splice(i, 1);
    }

    flashes.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const burst = bursts[i];
      if (!burst || burst.age >= BREAK_FLASH_DURATION_S) {
        mesh.visible = false;
        return;
      }
      const t = burst.age / BREAK_FLASH_DURATION_S;
      mesh.position.set(burst.x, burst.y, burst.z);
      mesh.scale.setScalar(burst.radius * BREAK_FLASH_RADIUS_MULT);
      (mesh.material as THREE.MeshBasicMaterial).opacity = BREAK_FLASH_OPACITY * (1 - t);
      mesh.visible = true;
    });

    const chunkMesh = chunkMeshRef.current;
    if (!chunkMesh) return;
    let written = 0;
    for (const burst of bursts) {
      const t = burst.age / BREAK_DURATION_S;
      const size = Math.max(BREAK_CHUNK_SIZE * (1 - t), MODEL_MIN_SIZE);
      for (const chunk of burst.chunks) {
        chunk.vy -= BREAK_GRAVITY * delta;
        chunk.x += chunk.vx * delta;
        chunk.y += chunk.vy * delta;
        chunk.z += chunk.vz * delta;
        scratch.position.set(chunk.x, chunk.y, chunk.z);
        scratch.euler.set(chunk.spinX * burst.age, 0, chunk.spinZ * burst.age);
        scratch.quaternion.setFromEuler(scratch.euler);
        scratch.scale.setScalar(size);
        chunkMesh.setMatrixAt(
          written,
          scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale),
        );
        chunkMesh.setColorAt(written, chunk.color);
        written++;
      }
    }
    chunkMesh.count = written;
    chunkMesh.instanceMatrix.needsUpdate = true;
    if (chunkMesh.instanceColor) chunkMesh.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <primitive object={flashes} />
      <instancedMesh
        ref={chunkMeshRef}
        args={[undefined, undefined, BREAK_MAX_BURSTS * BREAK_CHUNK_COUNT]}
        frustumCulled={false}
        raycast={noRaycast}
      >
        <boxGeometry />
        <meshStandardMaterial />
      </instancedMesh>
    </>
  );
}

function easeOutBack(progress: number): number {
  const q = progress - 1;
  return 1 + (EASE_BACK_OVERSHOOT + 1) * q * q * q + EASE_BACK_OVERSHOOT * q * q;
}

function PropPopIn({ popKey, children }: { popKey: string; children: ReactElement }) {
  const groupRef = useRef<THREE.Group>(null);
  const age = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: popKey is a trigger, not read in the body — a new prop type must restart the pop-in animation.
  useEffect(() => {
    age.current = 0;
  }, [popKey]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    age.current = Math.min(age.current + delta, MORPH_POP_DURATION_S);
    const progress = age.current / MORPH_POP_DURATION_S;
    group.scale.setScalar(progress >= 1 ? 1 : Math.max(easeOutBack(progress), 0));
  });

  return <group ref={groupRef}>{children}</group>;
}

function geometryFor(part: PrimitiveSpec): ReactElement {
  switch (part.kind) {
    case "box":
      return <boxGeometry args={[part.size.x, part.size.y, part.size.z]} />;
    case "cylinder": {
      const radius = part.size.x / 2;
      return <cylinderGeometry args={[radius, radius, part.size.y, 16]} />;
    }
    case "cone": {
      const radius = part.size.x / 2;
      return <coneGeometry args={[radius, part.size.y, 16]} />;
    }
  }
}

function PrimitiveParts({ parts }: { parts: PrimitiveSpec[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: static geometry parts of a prop, never reordered
          key={index}
          position={[part.position.x, part.position.y, part.position.z]}
          castShadow
          receiveShadow
        >
          {geometryFor(part)}
          <meshStandardMaterial color={part.color} />
        </mesh>
      ))}
    </>
  );
}

function enableShadows(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.isMeshStandardMaterial) standard.metalness = 0;
    }
  });
}

function FittedModel({
  url,
  width,
  height,
  baseY,
  scaleMul = 1,
}: {
  url: string;
  width: number;
  height: number;
  baseY: number;
  scaleMul?: number;
}) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => {
    const clone = scene.clone(true);
    enableShadows(clone);
    return clone;
  }, [scene]);
  const { scale, offset } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const fit =
      Math.min(
        width / Math.max(size.x, MODEL_MIN_SIZE),
        height / Math.max(size.y, MODEL_MIN_SIZE),
        width / Math.max(size.z, MODEL_MIN_SIZE),
      ) * scaleMul;
    return {
      scale: fit,
      offset: [-center.x * fit, baseY - box.min.y * fit, -center.z * fit] as const,
    };
  }, [object, width, height, baseY, scaleMul]);
  return (
    <group position={[offset[0], offset[1], offset[2]]} scale={scale}>
      <primitive object={object} />
    </group>
  );
}

function firstMesh(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) found = child as THREE.Mesh;
  });
  if (!found) {
    throw new Error(`tile GLB has no mesh: ${root.name || "?"}`);
  }
  return found;
}

function InstancedTiles({ url, tiles }: { url: string; tiles: TileInstance[] }) {
  const { scene } = useGLTF(url);
  const { geometry, material } = useMemo(() => {
    const mesh = firstMesh(scene);
    return { geometry: mesh.geometry, material: mesh.material };
  }, [scene]);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    tiles.forEach((tile, i) => {
      quat.setFromAxisAngle(UP, tile.rotationY);
      pos.set(tile.position.x, tile.position.y, tile.position.z);
      const s = tile.scale ?? 1;
      scale.set(s, tile.scaleY ?? s, s);
      mesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [tiles]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, tiles.length]}
      castShadow
      receiveShadow
      frustumCulled={false}
      dispose={null}
    />
  );
}

function SceneryModel({ inst }: { inst: SceneryInstance }) {
  const { scene } = useGLTF(inst.model);
  const object = useMemo(() => {
    const clone = scene.clone(true);
    enableShadows(clone);
    return clone;
  }, [scene]);
  return (
    <group
      position={[inst.position.x, inst.position.y, inst.position.z]}
      rotation-y={inst.rotationY}
      scale={inst.scale}
    >
      <primitive object={object} />
    </group>
  );
}

function PropMesh({ def }: { def: PropDefinition }) {
  const bounds = useMemo(() => computePropBounds(def), [def]);
  if (def.model) {
    return (
      <Suspense fallback={<PrimitiveParts parts={def.parts} />}>
        <FittedModel
          url={def.model}
          width={2 * bounds.radius}
          height={bounds.yMax - bounds.yMin}
          baseY={bounds.yMin}
          scaleMul={def.modelScale ?? 1}
        />
      </Suspense>
    );
  }
  return <PrimitiveParts parts={def.parts} />;
}

function WeaponModel({ url, scale }: { url: string; scale: number }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.raycast = () => {};
      }
    });
    return clone;
  }, [scene]);
  return <primitive object={object} scale={scale} />;
}

function HunterViewmodel({
  enabled,
  weapon,
  motionRef,
}: {
  enabled: boolean;
  weapon: WeaponId;
  motionRef: LocalMotionRef;
}) {
  const camera = useThree((state) => state.camera);
  const groupRef = useRef<THREE.Group>(null);
  const bobPhase = useRef(0);
  const sway = useRef({ x: 0, y: 0, prevYaw: 0, prevPitch: 0 });

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const motion = motionRef.current;
    if (motion.grounded) bobPhase.current += motion.speed * delta * WEAPON_BOB_FREQ;
    const bobAmount = Math.min(motion.speed / (MOVE_SPEED * RUN_MULTIPLIER_HUNTER), 1);
    const s = sway.current;
    const dYaw = motion.yaw - s.prevYaw;
    const dPitch = motion.pitch - s.prevPitch;
    s.prevYaw = motion.yaw;
    s.prevPitch = motion.pitch;
    const settle = WEAPON_SWAY_DAMP ** delta;
    s.x = THREE.MathUtils.clamp(
      (s.x + dYaw * WEAPON_SWAY) * settle,
      -WEAPON_SWAY_MAX,
      WEAPON_SWAY_MAX,
    );
    s.y = THREE.MathUtils.clamp(
      (s.y - dPitch * WEAPON_SWAY) * settle,
      -WEAPON_SWAY_MAX,
      WEAPON_SWAY_MAX,
    );
    group.position.set(
      WEAPON_OFFSET[0] + Math.sin(bobPhase.current) * WEAPON_BOB_X * bobAmount + s.x,
      WEAPON_OFFSET[1] + Math.sin(bobPhase.current * 2) * WEAPON_BOB_Y * bobAmount + s.y,
      WEAPON_OFFSET[2] + motion.recoil * WEAPON_KICK_Z,
    );
    group.rotation.x = motion.recoil * WEAPON_KICK_ROT;
  });

  if (!enabled) {
    return null;
  }
  return (
    <primitive object={camera}>
      <group ref={groupRef} position={WEAPON_OFFSET} rotation={WEAPON_ROTATION}>
        <Suspense fallback={null}>
          <WeaponModel url={WEAPONS[weapon].model} scale={WEAPON_SCALE} />
        </Suspense>
      </group>
    </primitive>
  );
}

const MapView = memo(function MapView({
  map,
  groundColor,
}: {
  map: MapDefinition;
  groundColor: string;
}) {
  const catalog = useMemo<Catalog>(
    () => new Map(map.propCatalog.map((def) => [def.id, def])),
    [map],
  );
  const tileGroups = useMemo(() => {
    const groups = new Map<string, TileInstance[]>();
    for (const tile of map.tiles) {
      const group = groups.get(tile.model);
      if (group) group.push(tile);
      else groups.set(tile.model, [tile]);
    }
    return [...groups.entries()];
  }, [map]);
  const floorSize = useMemo(() => {
    let maxX = map.bounds.max.x;
    let maxZ = map.bounds.max.z;
    for (const tile of map.tiles) {
      maxX = Math.max(maxX, Math.abs(tile.position.x));
      maxZ = Math.max(maxZ, Math.abs(tile.position.z));
    }
    for (const inst of map.scenery) {
      maxX = Math.max(maxX, Math.abs(inst.position.x));
      maxZ = Math.max(maxZ, Math.abs(inst.position.z));
    }
    return { width: maxX * 2 + BASE_PLANE_MARGIN, depth: maxZ * 2 + BASE_PLANE_MARGIN };
  }, [map]);

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, BASE_PLANE_Y, 0]} receiveShadow>
        <planeGeometry args={[floorSize.width, floorSize.depth]} />
        <meshStandardMaterial color={groundColor} />
      </mesh>

      <Suspense fallback={null}>
        {tileGroups.map(([url, group]) => (
          <InstancedTiles key={url} url={url} tiles={group} />
        ))}
      </Suspense>

      <Suspense fallback={null}>
        {map.scenery.map((inst, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static per-map scenery, never reordered
          <SceneryModel key={`scn-${index}`} inst={inst} />
        ))}
      </Suspense>

      {map.props.map((instance, index) => {
        const def = catalog.get(instance.type);
        if (!def) {
          return null;
        }
        return (
          <group
            // biome-ignore lint/suspicious/noArrayIndexKey: static per-map props, never reordered
            key={`prop-${index}`}
            position={[instance.position.x, instance.position.y, instance.position.z]}
            rotation-y={instance.rotation}
            userData={{ propType: instance.type }}
          >
            <PropMesh def={def} />
          </group>
        );
      })}
    </>
  );
});

function Avatar({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, PLAYER_BODY_Y, 0]} castShadow>
        <capsuleGeometry args={[PLAYER_RADIUS, PLAYER_BODY_LENGTH, 4, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, PLAYER_HEAD_Y, 0]} castShadow>
        <sphereGeometry args={[PLAYER_RADIUS * 0.55, 16, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </>
  );
}

function AnimalAvatar({ id, role }: { id: string; role: Role }) {
  const fallbackColor = role === "hunter" ? HUNTER_COLOR : PROP_COLOR;
  if (!id) {
    return <Avatar color={fallbackColor} />;
  }
  return (
    <Suspense fallback={<Avatar color={fallbackColor} />}>
      <FittedModel
        url={animalModel(id)}
        width={PLAYER_RADIUS * 2}
        height={PLAYER_HEAD_Y}
        baseY={0}
      />
    </Suspense>
  );
}

function PlayerModel({
  role,
  propType,
  avatar,
  catalog,
}: {
  role: Role;
  propType: string;
  avatar: string;
  catalog: Catalog;
}) {
  if (role === "prop" && propType) {
    const def = catalog.get(propType);
    if (def) {
      return (
        <PropPopIn popKey={propType}>
          <PropMesh def={def} />
        </PropPopIn>
      );
    }
  }
  return <AnimalAvatar id={avatar} role={role} />;
}

function Decoys({ decoys, catalog }: { decoys: DecoyView[]; catalog: Catalog }) {
  return (
    <>
      {decoys.map((d) => {
        const def = catalog.get(d.propType);
        if (!def) return null;
        return (
          <group key={d.id} position={[d.x, d.y, d.z]} rotation={[0, d.rot, 0]}>
            <PropMesh def={def} />
          </group>
        );
      })}
    </>
  );
}

function PropActions({ room, enabled }: { room: Room; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "KeyR") room.send(MSG_REROLL);
      else if (event.code === "KeyC") room.send(MSG_DECOY);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, room]);

  return null;
}

function useMouseLook() {
  const look = useRef({ yaw: 0, pitch: DEFAULT_PITCH });
  const { gl } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    const requestLock = () => {
      if (document.pointerLockElement !== el) {
        void el.requestPointerLock();
      }
    };
    const onMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== el) {
        return;
      }
      look.current.yaw -= event.movementX * LOOK_SENSITIVITY;
      look.current.pitch = THREE.MathUtils.clamp(
        look.current.pitch + event.movementY * LOOK_SENSITIVITY,
        PITCH_MIN,
        PITCH_MAX,
      );
    };
    el.addEventListener("click", requestLock);
    window.addEventListener("mousemove", onMove);
    return () => {
      el.removeEventListener("click", requestLock);
      window.removeEventListener("mousemove", onMove);
    };
  }, [gl]);

  return look;
}

interface LocalPlayerProps {
  room: Room;
  map: MapDefinition;
  catalog: Catalog;
  id: string;
  role: Role;
  propType: string;
  phase: Phase;
  alive: boolean;
  teleportRef: TeleportRef;
  tauntPulseRef: TauntPulseRef;
  chatOpen: boolean;
  playersRef: PlayersRef;
  colliders: ObbCollider[];
  walls: Wall[];
  avatar: string;
  playerPos: PlayerPosRef;
  motionRef: LocalMotionRef;
}

function LocalPlayer({
  room,
  map,
  catalog,
  id,
  role,
  propType,
  phase,
  alive,
  teleportRef,
  tauntPulseRef,
  chatOpen,
  playersRef,
  colliders,
  walls,
  avatar,
  playerPos,
  motionRef,
}: LocalPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const keys = useControls(!chatOpen);
  const look = useMouseLook();
  const { camera } = useThree();

  const spawn = map.spawnPoints.props[0] ?? map.bounds.min;
  const pos = useMemo(
    () => new THREE.Vector3(spawn.x, spawn.y, spawn.z),
    [spawn.x, spawn.y, spawn.z],
  );
  const spawnApplied = useRef(false);
  const heading = useRef(0);
  const sendAccumMs = useRef(0);
  const lastSentInput = useRef({
    x: Number.NaN,
    y: Number.NaN,
    z: Number.NaN,
    rot: Number.NaN,
    aim: Number.NaN,
    propRot: Number.NaN,
  });
  const stepAccum = useRef(0);
  const velocity = useMemo(() => new THREE.Vector3(), []);
  const velocityY = useRef(0);
  const jumpHeld = useRef(false);
  const jumpBufferMs = useRef(0);
  const forwardVec = useMemo(() => new THREE.Vector3(), []);
  const rightVec = useMemo(() => new THREE.Vector3(), []);
  const moveVec = useMemo(() => new THREE.Vector3(), []);
  const camDistRef = useRef(CAMERA_DISTANCE);
  const propRot = useRef(0);
  const turnHeldMs = useRef(0);
  const lastTurnDir = useRef(0);
  const prevPropType = useRef("");

  const frozen = !alive || (role === "hunter" && phase === "hiding");

  useFrame((_, delta) => {
    if (!spawnApplied.current) {
      const self = playersRef.current.get(id);
      if (self) {
        pos.set(self.x, self.y, self.z);
        heading.current = self.rot;
        spawnApplied.current = true;
      }
    }

    const teleport = teleportRef.current;
    if (teleport) {
      pos.x = teleport.x;
      pos.y = 0;
      pos.z = teleport.z;
      velocityY.current = 0;
      teleportRef.current = null;
    }

    const { yaw, pitch } = look.current;
    forwardVec.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    rightVec.crossVectors(forwardVec, UP);

    let support = supportHeightAt(pos.x, pos.z, pos.y, colliders);
    let horizSpeed = 0;
    let sprinting = false;

    if (!frozen) {
      const k = keys.current;
      const forwardInput = (k.forward ? 1 : 0) - (k.back ? 1 : 0);
      const strafeInput = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      moveVec
        .set(0, 0, 0)
        .addScaledVector(forwardVec, forwardInput)
        .addScaledVector(rightVec, strafeInput);
      const hasInput = moveVec.lengthSq() > 0;
      if (hasInput) moveVec.normalize();

      const runMultiplier = role === "hunter" ? RUN_MULTIPLIER_HUNTER : RUN_MULTIPLIER_PROP;
      const speed = k.run ? MOVE_SPEED * runMultiplier : MOVE_SPEED;
      const grounded = pos.y <= support + GROUND_EPSILON;
      const rate = (hasInput ? MOVE_ACCEL : MOVE_DECEL) * (grounded ? 1 : AIR_CONTROL) * delta;
      const dvx = moveVec.x * speed - velocity.x;
      const dvz = moveVec.z * speed - velocity.z;
      const dvLen = Math.hypot(dvx, dvz);
      const blend = dvLen > rate ? rate / dvLen : 1;
      velocity.x += dvx * blend;
      velocity.z += dvz * blend;
      pos.x += velocity.x * delta;
      pos.z += velocity.z * delta;

      horizSpeed = Math.hypot(velocity.x, velocity.z);
      sprinting = k.run && horizSpeed > MOVE_SPEED;
      if (horizSpeed > HEADING_MIN_SPEED) {
        const target = Math.atan2(velocity.x, velocity.z);
        const turn = ((target - heading.current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        heading.current += turn * (1 - HEADING_DAMP ** delta);
        if (grounded) {
          stepAccum.current += horizSpeed * delta;
          if (stepAccum.current >= STEP_DISTANCE) {
            stepAccum.current = 0;
            playStep();
          }
        }
      }

      if (k.jump && !jumpHeld.current) jumpBufferMs.current = JUMP_BUFFER_MS;
      if (jumpBufferMs.current > 0 && grounded && velocityY.current <= 0) {
        jumpBufferMs.current = 0;
        velocityY.current = JUMP_SPEED;
        playJump();
      } else {
        jumpBufferMs.current = Math.max(0, jumpBufferMs.current - delta * 1000);
      }
      let gravity = GRAVITY;
      if (velocityY.current > 0 && !k.jump) gravity *= JUMP_RELEASE_GRAVITY_MULT;
      else if (velocityY.current < 0) gravity *= FALL_GRAVITY_MULT;
      velocityY.current -= gravity * delta;
      support = supportHeightAt(pos.x, pos.z, pos.y, colliders);
      const airborne = pos.y > support + GROUND_EPSILON;
      const ceiling = ceilingHeightAt(pos.x, pos.z, pos.y, colliders);
      pos.y += velocityY.current * delta;
      if (pos.y + PLAYER_HEIGHT > ceiling) {
        pos.y = ceiling - PLAYER_HEIGHT - GROUND_EPSILON;
        velocityY.current = Math.min(velocityY.current, 0);
      }
      if (velocityY.current <= 0 && pos.y <= support) {
        if (airborne) {
          const impact = Math.min(1, -velocityY.current / (JUMP_SPEED * 2));
          motionRef.current.landing = Math.max(motionRef.current.landing, impact);
          playLand(impact);
        }
        pos.y = support;
        velocityY.current = 0;
      }
      jumpHeld.current = k.jump;

      const { min, max } = map.bounds;
      pos.x = THREE.MathUtils.clamp(pos.x, min.x + PLAYER_RADIUS, max.x - PLAYER_RADIUS);
      pos.z = THREE.MathUtils.clamp(pos.z, min.z + PLAYER_RADIUS, max.z - PLAYER_RADIUS);
    } else {
      velocity.set(0, 0, 0);
    }

    if (propType && propType !== prevPropType.current) {
      propRot.current = heading.current;
    }
    prevPropType.current = propType;
    if (role === "prop") {
      const turnDir = (keys.current.turnRight ? 1 : 0) - (keys.current.turnLeft ? 1 : 0);
      if (turnDir !== 0) {
        propRot.current += turnDir * PROP_TURN_SPEED * delta;
        turnHeldMs.current += delta * 1000;
        lastTurnDir.current = turnDir;
      } else if (lastTurnDir.current !== 0) {
        if (turnHeldMs.current < PROP_TURN_TAP_MS) {
          propRot.current =
            lastTurnDir.current > 0
              ? Math.ceil(propRot.current / PROP_TURN_SNAP) * PROP_TURN_SNAP
              : Math.floor(propRot.current / PROP_TURN_SNAP) * PROP_TURN_SNAP;
        }
        turnHeldMs.current = 0;
        lastTurnDir.current = 0;
      }
      propRot.current = Math.atan2(Math.sin(propRot.current), Math.cos(propRot.current));
    }

    if (alive) {
      for (const [otherId, other] of playersRef.current) {
        if (otherId === id || !other.alive) continue;
        if (Math.abs(pos.y - other.y) >= PLAYER_HEIGHT) continue;
        const dx = pos.x - other.x;
        const dz = pos.z - other.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > 1e-8 && distSq < PLAYER_SEPARATION * PLAYER_SEPARATION) {
          const dist = Math.sqrt(distSq);
          const push = PLAYER_SEPARATION - dist;
          pos.x += (dx / dist) * push;
          pos.z += (dz / dist) * push;
        }
      }
      resolveColliders(pos, colliders);
      const { min, max } = map.bounds;
      pos.x = THREE.MathUtils.clamp(pos.x, min.x + PLAYER_RADIUS, max.x - PLAYER_RADIUS);
      pos.z = THREE.MathUtils.clamp(pos.z, min.z + PLAYER_RADIUS, max.z - PLAYER_RADIUS);
    }

    playerPos.current.set(pos.x, pos.y, pos.z);
    const group = groupRef.current;
    if (group) {
      group.position.set(pos.x, pos.y, pos.z);
      group.rotation.y = role === "prop" && propType ? propRot.current : heading.current;
      applyTauntPulse(group, tauntPulseRef, id, delta);
    }

    const motion = motionRef.current;
    motion.recoil *= RECOIL_DAMP ** delta;
    motion.landing *= LAND_DAMP ** delta;
    motion.speed = horizSpeed;
    motion.sprinting = sprinting;
    motion.grounded = pos.y <= support + GROUND_EPSILON;
    motion.yaw = yaw;
    motion.pitch = pitch;

    const perspective = camera as THREE.PerspectiveCamera;
    const targetFov = GAME_FOV + (sprinting ? SPRINT_FOV_ADD : 0);
    if (Math.abs(perspective.fov - targetFov) > FOV_EPSILON) {
      perspective.fov += (targetFov - perspective.fov) * (1 - FOV_DAMP ** delta);
      perspective.updateProjectionMatrix();
    }

    if (role === "hunter") {
      const aimPitch = pitch - motion.recoil * RECOIL_MAX_PITCH;
      const cosPitch = Math.cos(aimPitch);
      const eyeY = pos.y + EYE_HEIGHT - motion.landing * LAND_DIP_Y;
      camera.position.set(pos.x, eyeY, pos.z);
      camera.lookAt(
        pos.x - Math.sin(yaw) * cosPitch,
        eyeY - Math.sin(aimPitch),
        pos.z - Math.cos(yaw) * cosPitch,
      );
    } else {
      const localPitch = THREE.MathUtils.clamp(pitch, TP_PITCH_MIN, TP_PITCH_MAX);
      const cosPitch = Math.cos(localPitch);
      const dirX = Math.sin(yaw) * cosPitch;
      const dirY = Math.sin(localPitch);
      const dirZ = Math.cos(yaw) * cosPitch;

      let desired = CAMERA_DISTANCE;
      const hitXZ = nearestWallDistanceXZ(
        pos.x,
        pos.z,
        Math.sin(yaw),
        Math.cos(yaw),
        CAMERA_DISTANCE * cosPitch,
        walls,
      );
      const wallDistance = hitXZ / cosPitch;
      if (wallDistance < desired) {
        desired = Math.max(wallDistance - CAMERA_WALL_MARGIN, CAMERA_MIN_DISTANCE);
      }

      const current = camDistRef.current;
      camDistRef.current =
        desired < current ? desired : current + (desired - current) * (1 - CAMERA_DAMP ** delta);
      const d = camDistRef.current;

      const pivotY = pos.y + CAMERA_TARGET_Y;
      camera.position.set(pos.x + dirX * d, pivotY + dirY * d, pos.z + dirZ * d);
      camera.lookAt(pos.x, pivotY, pos.z);
    }

    sendAccumMs.current += delta * 1000;
    if (sendAccumMs.current >= INPUT_SEND_RATE_MS) {
      sendAccumMs.current = 0;
      const aim = Math.atan2(forwardVec.x, forwardVec.z);
      const last = lastSentInput.current;
      const moved =
        !(Math.abs(pos.x - last.x) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(pos.y - last.y) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(pos.z - last.z) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(heading.current - last.rot) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(aim - last.aim) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(propRot.current - last.propRot) < INPUT_IDLE_EPSILON);
      if (moved) {
        const payload = {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          rot: heading.current,
          aim,
          propRot: propRot.current,
        };
        lastSentInput.current = payload;
        room.send(MSG_INPUT, payload);
      }
    }
  });

  return (
    <group ref={groupRef} userData={{ [LOCAL_AVATAR_KEY]: true }}>
      {alive && role !== "hunter" && (
        <PlayerModel role={role} propType={propType} avatar={avatar} catalog={catalog} />
      )}
    </group>
  );
}

function AllyNameplate({ name, y }: { name: string; y: number }) {
  return (
    <Billboard position={[0, y, 0]}>
      <Text
        fontSize={NAMEPLATE_FONT_SIZE}
        color={NAMEPLATE_COLOR}
        outlineWidth={NAMEPLATE_OUTLINE_WIDTH}
        outlineColor={NAMEPLATE_OUTLINE_COLOR}
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </Billboard>
  );
}

interface RemotePlayerProps {
  view: RemotePlayerView | undefined;
  catalog: Catalog;
  role: Role;
  localRole: Role;
  propType: string;
  avatar: string;
  tauntPulseRef: TauntPulseRef;
  localPos: PlayerPosRef;
  renderPoses: RenderPosesRef;
}

function RemotePlayer({
  view,
  catalog,
  role,
  localRole,
  propType,
  avatar,
  tauntPulseRef,
  localPos,
  renderPoses,
}: RemotePlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const stepAccum = useRef(0);
  const lastStepPos = useRef<{ x: number; z: number } | null>(null);

  const nameplateY = useMemo(() => {
    if (role === "prop" && propType) {
      const def = catalog.get(propType);
      if (def) {
        return computePropBounds(def).yMax + NAMEPLATE_GAP;
      }
    }
    return PLAYER_HEAD_Y + NAMEPLATE_GAP;
  }, [role, propType, catalog]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || !view) {
      return;
    }
    const t = 1 - REMOTE_DAMP ** delta;
    group.position.x += (view.x - group.position.x) * t;
    group.position.y += (view.y - group.position.y) * t;
    group.position.z += (view.z - group.position.z) * t;
    group.rotation.y = role === "prop" && propType ? view.propRot : view.rot;
    applyTauntPulse(group, tauntPulseRef, view.id, delta);

    const pose = renderPoses.current.get(view.id);
    if (pose) {
      pose.x = group.position.x;
      pose.z = group.position.z;
    } else {
      renderPoses.current.set(view.id, { x: group.position.x, z: group.position.z });
    }

    if (role === "hunter") {
      const last = lastStepPos.current;
      if (last) {
        const moved = Math.hypot(group.position.x - last.x, group.position.z - last.z);
        if (moved < REMOTE_STEP_TELEPORT_SKIP) {
          stepAccum.current += moved;
          if (stepAccum.current >= STEP_DISTANCE) {
            stepAccum.current = 0;
            const dist = Math.hypot(
              group.position.x - localPos.current.x,
              group.position.z - localPos.current.z,
            );
            playStep(REMOTE_STEP_VOLUME * Math.max(0, 1 - dist / REMOTE_STEP_MAX_DISTANCE));
          }
        }
        last.x = group.position.x;
        last.z = group.position.z;
      } else {
        lastStepPos.current = { x: group.position.x, z: group.position.z };
      }
    }
  });

  if (!view) {
    return null;
  }
  const showName = localRole === role && view.name.length > 0;
  return (
    <group ref={groupRef}>
      <PlayerModel role={role} propType={propType} avatar={avatar} catalog={catalog} />
      {showName ? <AllyNameplate name={view.name} y={nameplateY} /> : null}
    </group>
  );
}
