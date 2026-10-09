import type { Room } from "@colyseus/sdk";
import { deckLightsFor } from "@morphy/level";
import {
  type CeilingPanel,
  computePropBounds,
  INPUT_IDLE_EPSILON,
  INPUT_SEND_RATE_MS,
  type MapDefinition,
  MOVE_SPEED,
  MSG_DECOY,
  MSG_INPUT,
  MSG_REROLL,
  MSG_SHOOT,
  type Phase,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  type PrimitiveSpec,
  type PropBounds,
  type PropDefinition,
  type Role,
  RUN_MULTIPLIER_HUNTER,
  RUN_MULTIPLIER_PROP,
  type TileInstance,
  WEAPONS,
  type WeaponId,
} from "@morphy/shared";
import { Billboard, Sky, Stars, Text } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { memo, type ReactElement, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { MORPH_COLOR } from "../theme";
import { wheelDeltaPx } from "../ui/carouselWheel";
import { playJump, playLand, playMorph, playStep, playWeaponShot } from "./audio";
import { CeilingView } from "./CeilingView";
import { capUnderCeiling, ceilingBetween, ceilingHeightAt } from "./ceiling";
import { GroundView } from "./GroundView";
import type { ShadowSettings } from "./graphicsTier";
import { useGuardedFrame } from "./guardedFrame";
import {
  type Appearance,
  appearanceOf,
  beginSample,
  createEyeOut,
  createPoseOut,
  decoyStandsAt,
  hunterEyeAt,
  type KillCamLog,
  type KillReplay,
  pushPose,
  sampleDue,
  samplePose,
  sourceTimeAt,
} from "./killCam";
import { fitModel, MODEL_MIN_SIZE } from "./modelFit";
import { enableShadows } from "./modelShading";
import {
  advanceMovement,
  cappedFrameSeconds,
  clampToBounds,
  createDecoyGhosts,
  GROUND_EPSILON,
  type MovementBody,
  type ObbCollider,
  PLAYER_RADIUS,
  PLAYER_SEPARATION,
  resolveColliders,
  STEP_DISTANCE,
  supportHeightAt,
  updateDecoyGhosts,
} from "./movement";
import { lockPointer } from "./pointerLock";
import { FIELD_OF_VIEW_DEFAULT, fieldOfView, lookSensitivity } from "./prefs";
import {
  cappedVerticalFov,
  PROP_ZOOM_DEFAULT,
  propCameraDistance,
  propCameraTargetY,
  zoomByWheel,
} from "./propCamera";
import {
  advancePropTurn,
  idlePropTurn,
  type PropTurnPress,
  type PropTurnStep,
  resetPropTurn,
} from "./propTurn";
import { type PropView, propEyeHeight, propView, setPropView } from "./propView";
import { SkyGlow, StreetLamps } from "./StreetLamps";
import { useSharedGLTF } from "./sharedTextures";
import { StaticModels } from "./staticModels";
import { snapToTexels, sunBasis } from "./sunShadow";
import { type DeckLightPreset, themeFor } from "./themes";
import type {
  BreaksRef,
  CatchMomentRef,
  CaughtCam,
  DecoyBreakFx,
  DecoyView,
  LookRef,
  PlayersRef,
  RemotePlayerView,
  SceneMetaMap,
  ShotsRef,
  TauntPulseRef,
  TeleportRef,
} from "./types";
import { useControls } from "./useControls";

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function sinceCatch(moment: CatchMomentRef): number {
  const current = moment.current;
  return current ? performance.now() - current.at : Number.POSITIVE_INFINITY;
}

/** Whether the frame is inside the local hunter's hitstop, optionally only for `victimId`. */
function inHitstop(moment: CatchMomentRef, victimId?: string): boolean {
  if (victimId !== undefined && moment.current?.victimId !== victimId) return false;
  return sinceCatch(moment) < CATCH_HITSTOP_MS;
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function applyTauntPulse(group: THREE.Group, pulses: TauntPulseRef, id: string): void {
  const startedAt = pulses.current.get(id);
  if (startedAt === undefined) {
    group.scale.setScalar(1);
    return;
  }
  const progress = (performance.now() - startedAt) / TAUNT_PULSE_MS;
  if (progress >= 1) {
    pulses.current.delete(id);
    group.scale.setScalar(1);
    return;
  }
  group.scale.setScalar(1 + TAUNT_AMPLITUDE * Math.sin(progress * Math.PI));
}

const FURNITURE_MIN_RADIUS = 0.3;
const PLAYER_BODY_LENGTH = 0.9;
const PLAYER_BODY_Y = PLAYER_BODY_LENGTH / 2 + PLAYER_RADIUS;
const PLAYER_HEAD_Y = PLAYER_BODY_LENGTH + PLAYER_RADIUS * 1.6;
const HUNTER_COLOR = "#e8564a";
const PROP_COLOR = "#5bd75b";
const BASE_PLANE_MARGIN = 8;
const FLAT_TILE_MAX_HEIGHT = 0.1;
const BASE_PLANE_Y = -0.02;
const animalModel = (id: string): string => `/models/pets/animal-${id}.glb`;
const WEAPON_SCALE = 0.32;
const WEAPON_OFFSET: [number, number, number] = [0.2, -0.22, -0.6];
const NAMEPLATE_GAP = 0.45;
const NAMEPLATE_FONT_SIZE = 0.34;
const NAMEPLATE_COLOR = "#eef4ff";
const NAMEPLATE_OUTLINE_COLOR = "#11161f";
const NAMEPLATE_OUTLINE_WIDTH = 0.03;
const NAMEPLATE_MIN_DISTANCE = 4;

const CAMERA_TARGET_Y = 1.2;
const CAMERA_DAMP = 0.0008;
const PROP_ZOOM_DAMP = 1e-4;
const CAMERA_WALL_MARGIN = 0.35;
const CAMERA_CEILING_MARGIN = 0.35;
const CAMERA_FLOOR_MARGIN = 0.25;
const NO_CEILING: readonly CeilingPanel[] = [];
const CAMERA_MIN_DISTANCE = 0.2;
const CAMERA_SLAB_EPSILON = 1e-4;
const CAMERA_OCCLUDER_BASE_MAX = 0.5;
const CAMERA_OCCLUDER_TOP_MIN = 2.5;
const REMOTE_DAMP = 0.0009;
const TAUNT_PULSE_MS = 500;
const TAUNT_AMPLITUDE = 0.18;
const TRACER_TTL = 0.12;
const MAX_TRACERS = 16;
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
const REMOTE_STEP_MAX_DISTANCE = 24;
const REMOTE_STEP_VOLUME = 0.8;
const REMOTE_STEP_TELEPORT_SKIP = 2;
const LOOK_SENSITIVITY = 0.0025;
const PITCH_MIN = -1.4;
const PITCH_MAX = 1.4;
const TP_PITCH_MIN = -0.15;
const TP_PITCH_MAX = 0.87;
const TP_DEFAULT_PITCH = 0.26;
export const DEFAULT_PITCH = 0.5;
export const SUN_POSITION: [number, number, number] = [14, 26, 10];
const STARS_RADIUS = 120;
const STARS_DEPTH = 40;
const SHADOW_MARGIN = 4;
const SHADOW_LEAD = 10;
const SHADOW_LIGHT_DISTANCE = 60;
const UNSHADOWED_SNAP = 1;
const SUN_BASIS = sunBasis({ x: SUN_POSITION[0], y: SUN_POSITION[1], z: SUN_POSITION[2] });
const SUN_OFFSET = new THREE.Vector3(...SUN_POSITION).setLength(SHADOW_LIGHT_DISTANCE);
const SHADOW_NORMAL_BIAS_TEXELS = 2;
const SHADOW_SETTLE_S = 0.4;
const SHADOW_HEARTBEAT_S = 2;
const UP = new THREE.Vector3(0, 1, 0);
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const noRaycast = () => {};

export const GAME_FOV = FIELD_OF_VIEW_DEFAULT;
const SPRINT_FOV_ADD = 3;
const FOV_DAMP = 0.02;
const FOV_EPSILON = 0.05;
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
const CATCH_HITSTOP_MS = 90;
const CATCH_SHAKE_MS = 320;
const CATCH_SHAKE_RAD = 0.035;
const CATCH_SHAKE_FREQ_X = 57;
const CATCH_SHAKE_FREQ_Y = 43;
/** How long a caught prop's camera pulls back to show the hunter who got it. */
export const CAUGHT_CAM_MS = 1_200;
const CAUGHT_CAM_START_DISTANCE = 1.2;
const CAUGHT_CAM_END_DISTANCE = 4.8;
const CAUGHT_CAM_START_RISE = 0.3;
const CAUGHT_CAM_END_RISE = 1.6;
const CAUGHT_CAM_LOOK_AHEAD_RATIO = 0.6;
const DIRECTION_EPSILON = 1e-3;
const KILL_CAM_SHOT_SOUND_RANGE = 60;

type Catalog = Map<string, PropDefinition>;

function pushPropPartColliders(
  colliders: ObbCollider[],
  def: PropDefinition,
  position: { x: number; y: number; z: number },
  rotation: number,
): void {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (const part of def.parts) {
    const hx = part.size.x / 2;
    const hz = part.size.z / 2;
    const reach = Math.hypot(part.position.x, part.position.z) + Math.max(hx, hz);
    if (reach < FURNITURE_MIN_RADIUS) continue;
    colliders.push({
      x: position.x + part.position.x * cos + part.position.z * sin,
      z: position.z - part.position.x * sin + part.position.z * cos,
      cos,
      sin,
      hx,
      hz,
      yMin: position.y + part.position.y - part.size.y / 2,
      yMax: position.y + part.position.y + part.size.y / 2,
    });
  }
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
    pushPropPartColliders(colliders, def, instance.position, instance.rotation);
  }
  return colliders;
}

function buildDecoyColliders(decoys: DecoyView[], catalog: Catalog): Map<string, ObbCollider[]> {
  const byDecoy = new Map<string, ObbCollider[]>();
  for (const decoy of decoys) {
    const def = catalog.get(decoy.propType);
    if (!def) continue;
    const colliders: ObbCollider[] = [];
    pushPropPartColliders(colliders, def, decoy, decoy.rot);
    byDecoy.set(decoy.id, colliders);
  }
  return byDecoy;
}

function solidColliders(
  statics: ObbCollider[],
  decoys: ReadonlyMap<string, ObbCollider[]>,
  ghosts: ReadonlySet<string>,
): ObbCollider[] {
  if (decoys.size === 0) return statics;
  const solid = [...statics];
  for (const [id, colliders] of decoys) {
    if (!ghosts.has(id)) solid.push(...colliders);
  }
  return solid;
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
  meta: SceneMetaMap;
  phase: Phase;
  decoys: DecoyView[];
  teleportRef: TeleportRef;
  lookRef: LookRef;
  tauntPulseRef: TauntPulseRef;
  shotsRef: ShotsRef;
  breaksRef: BreaksRef;
  weapon: WeaponId;
  inputBlocked: boolean;
  onShoot: () => void;
  shadows: ShadowSettings | null;
  catchRef: CatchMomentRef;
  caughtCam: CaughtCam | null;
  killCam: KillCamPlayback | null;
  killCamLog: KillCamLog;
  localBreakDeferred: boolean;
  night: boolean;
  turnStep: PropTurnStep;
}

/** A kill cam replay and the `performance.now()` it started playing at. */
export interface KillCamPlayback {
  replay: KillReplay;
  startedAt: number;
}

export const Scene = memo(function Scene({
  room,
  map,
  localId,
  ids,
  playersRef,
  meta,
  phase,
  decoys,
  teleportRef,
  lookRef,
  tauntPulseRef,
  shotsRef,
  breaksRef,
  weapon,
  inputBlocked,
  onShoot,
  shadows,
  catchRef,
  caughtCam,
  killCam,
  killCamLog,
  localBreakDeferred,
  night,
  turnStep,
}: SceneProps) {
  const catalog = useMemo<Catalog>(
    () => new Map(map.propCatalog.map((def) => [def.id, def])),
    [map],
  );
  const staticColliders = useMemo(() => buildColliders(map, catalog), [map, catalog]);
  const decoyColliders = useMemo(() => buildDecoyColliders(decoys, catalog), [decoys, catalog]);
  const walls = useMemo(() => buildWalls(map), [map]);
  const theme = useMemo(() => themeFor(map.id, night), [map.id, night]);
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
  const renderPosesRef = useRef(new Map<string, { x: number; y: number; z: number }>());

  useEffect(() => {
    const seen = seenPropTypes.current;
    const live = new Set(ids);
    for (const id of ids) {
      const propType = meta[id]?.propType ?? "";
      const before = seen.get(id);
      seen.set(id, propType);
      if (before && !propType && meta[id]?.role === "hunter") {
        if (id === localId && localBreakDeferred) continue;
        const pose =
          id === localId
            ? localGroundRef.current
            : (renderPosesRef.current.get(id) ?? playersRef.current.get(id));
        if (pose) breaksRef.current.push({ x: pose.x, y: pose.y, z: pose.z, propType: before });
        continue;
      }
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
        y: source.y,
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
  }, [meta, ids, localId, catalog, playersRef, breaksRef, localBreakDeferred]);
  const canTransform =
    localRole === "prop" &&
    localAlive &&
    !inputBlocked &&
    (phase === "hiding" || phase === "hunting");
  const canShoot =
    localRole === "hunter" && localAlive && !inputBlocked && phase === "hunting" && !caughtCam;
  const recordingKillCam =
    localRole === "prop" && localAlive && phase === "hunting" && caughtCam === null;

  return (
    <>
      <color attach="background" args={[theme.background]} />
      {theme.fog && <fog attach="fog" args={[theme.fog.color, theme.fog.near, theme.fog.far]} />}
      {theme.sky === "day" ? (
        <Sky sunPosition={SUN_POSITION} turbidity={theme.turbidity} rayleigh={theme.rayleigh} />
      ) : (
        <Stars
          radius={STARS_RADIUS}
          depth={STARS_DEPTH}
          count={theme.stars.count}
          factor={theme.stars.factor}
          fade
          speed={0}
        />
      )}
      {theme.skyGlow && <SkyGlow preset={theme.skyGlow} />}
      {theme.streetLamps && (
        <StreetLamps map={map} preset={theme.streetLamps} focus={localGroundRef} />
      )}
      <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
      <ambientLight intensity={theme.ambient} />
      {theme.deckLights && <DeckLights map={map} preset={theme.deckLights} />}
      {shadows && (
        <ShadowRefresh
          playersRef={playersRef}
          localPos={localGroundRef}
          motionRef={motionRef}
          meta={meta}
          ids={ids}
          tauntPulseRef={tauntPulseRef}
          forced={killCam !== null}
        />
      )}
      <SunLight
        intensity={theme.dir}
        color={theme.dirColor}
        playerPos={localGroundRef}
        motionRef={motionRef}
        shadows={shadows}
      />
      <MapView map={map} groundColor={theme.ground} />
      {map.ceiling && <CeilingView panels={map.ceiling} />}
      <PropActions room={room} enabled={canTransform} motionRef={motionRef} />
      {killCam === null && <Decoys decoys={decoys} catalog={catalog} />}
      <KillCamRecorder
        enabled={recordingKillCam}
        log={killCamLog}
        localId={localId}
        playersRef={playersRef}
        localPos={localGroundRef}
        renderPoses={renderPosesRef}
      />
      {killCam && (
        <KillCamView
          playback={killCam}
          catalog={catalog}
          meta={meta}
          shotsRef={shotsRef}
          breaksRef={breaksRef}
          catchRef={catchRef}
        />
      )}
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
        enabled={localRole === "hunter" && localAlive && !caughtCam}
        weapon={weapon}
        motionRef={motionRef}
        catchRef={catchRef}
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
        lookRef={lookRef}
        tauntPulseRef={tauntPulseRef}
        inputBlocked={inputBlocked}
        playersRef={playersRef}
        colliders={staticColliders}
        decoyColliders={decoyColliders}
        walls={walls}
        avatar={localMeta?.avatar ?? ""}
        playerPos={localGroundRef}
        motionRef={motionRef}
        catchRef={catchRef}
        caughtCam={caughtCam}
        replaying={killCam !== null}
        turnStep={turnStep}
      />
      {ids
        .filter((id) => killCam === null && id !== localId && (meta[id]?.alive ?? true))
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
            catchRef={catchRef}
          />
        ))}
    </>
  );
});

interface ShadowPose {
  x: number;
  y: number;
  z: number;
  rot: number;
}

/**
 * Asks for a shadow pass on every frame until {@link SHADOW_SETTLE_S} after the last
 * change to a caster (the local pose, a remote pose, the roster or a player's meta, a
 * taunt pulse, a kill cam replaying), then only on a heartbeat while the scene is still. Never at a lower
 * rate while something moves: a body drawn at this frame's pose over a depth map from
 * an earlier one leaves its shadow behind and falls into it, which reads as flicker.
 */
function ShadowRefresh({
  playersRef,
  localPos,
  motionRef,
  meta,
  ids,
  tauntPulseRef,
  forced,
}: {
  playersRef: PlayersRef;
  localPos: PlayerPosRef;
  motionRef: LocalMotionRef;
  meta: SceneMetaMap;
  ids: string[];
  tauntPulseRef: TauntPulseRef;
  forced: boolean;
}) {
  const gl = useThree((state) => state.gl);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: meta/ids are triggers, not read in the body; a roster/meta change must reset the shadow-settle timer.
  useEffect(() => {
    sinceChange.current = 0;
  }, [meta, ids]);

  useGuardedFrame((_, delta) => {
    sinceRender.current += delta;
    sinceChange.current = forced ? 0 : sinceChange.current + delta;

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

    const now = performance.now();
    for (const [id, startedAt] of tauntPulseRef.current) {
      if (now - startedAt >= TAUNT_PULSE_MS) tauntPulseRef.current.delete(id);
      else sinceChange.current = 0;
    }

    if (sinceChange.current <= SHADOW_SETTLE_S || sinceRender.current >= SHADOW_HEARTBEAT_S) {
      sinceRender.current = 0;
      gl.shadowMap.needsUpdate = true;
    }
  });

  return null;
}

/**
 * Unshadowed point lights over a night deck: warm pools in the rooms, cool ones down the
 * spine, as {@link deckLightsFor} says.
 */
export function DeckLights({ map, preset }: { map: MapDefinition; preset: DeckLightPreset }) {
  const lights = useMemo(() => deckLightsFor(map, preset.roomCount), [map, preset.roomCount]);
  return (
    <>
      {lights.map((light) => (
        <pointLight
          key={light.id}
          position={[light.x, preset.height, light.z]}
          color={light.kind === "room" ? preset.roomColor : preset.corridorColor}
          intensity={light.kind === "room" ? preset.roomIntensity : preset.corridorIntensity}
          distance={preset.distance}
        />
      ))}
    </>
  );
}

/**
 * The shadowed sun, with its shadow camera kept on the local player rather than
 * stretched over the whole map: three culls casters against that camera, so most
 * of the map drops out of the shadow pass. The centre leads the view direction,
 * where the player is looking, and snaps to the texel grid so edges do not shimmer.
 * The light sits {@link SHADOW_LIGHT_DISTANCE} back along the sun so the near plane
 * never slices the top off a tower standing sunward of the player: a clipped roof
 * takes that tower's shadow with it.
 */
function SunLight({
  intensity,
  color,
  playerPos,
  motionRef,
  shadows,
}: {
  intensity: number;
  color: string;
  playerPos: PlayerPosRef;
  motionRef: LocalMotionRef;
  shadows: ShadowSettings | null;
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const centre = useRef({ x: Number.NaN, y: 0, z: Number.NaN });
  const radius = shadows?.radius ?? 0;
  const mapSize = shadows?.mapSize ?? 0;
  const texel = shadows ? (2 * radius) / mapSize : UNSHADOWED_SNAP;

  useGuardedFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    const pos = playerPos.current;
    const yaw = motionRef.current.yaw;
    const next = snapToTexels(
      { x: pos.x - Math.sin(yaw) * SHADOW_LEAD, y: 0, z: pos.z - Math.cos(yaw) * SHADOW_LEAD },
      SUN_BASIS,
      texel,
    );
    const prev = centre.current;
    if (next.x === prev.x && next.y === prev.y && next.z === prev.z) return;
    centre.current = next;
    target.position.set(next.x, next.y, next.z);
    target.updateMatrixWorld();
    light.position.set(next.x + SUN_OFFSET.x, next.y + SUN_OFFSET.y, next.z + SUN_OFFSET.z);
  });

  return (
    <>
      <directionalLight
        ref={lightRef}
        target={target}
        intensity={intensity}
        color={color}
        castShadow={shadows !== null}
        shadow-mapSize={[mapSize, mapSize]}
        shadow-camera-near={1}
        shadow-camera-far={SHADOW_LIGHT_DISTANCE + radius + SHADOW_MARGIN}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        shadow-bias={-0.0004}
        shadow-normalBias={texel * SHADOW_NORMAL_BIAS_TEXELS}
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
  const nextShotAt = useRef(0);

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
      if (now < nextShotAt.current) {
        return;
      }
      nextShotAt.current = now + spec.cooldownMs;
      raycaster.setFromCamera(SCREEN_CENTER, camera);
      const d = raycaster.ray.direction;
      room.send(MSG_SHOOT, {
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

  useGuardedFrame((_, delta) => {
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
  y: number;
  z: number;
  radius: number;
  height: number;
}

type MorphFxRef = { readonly current: MorphFx[] };

type RenderPosesRef = { readonly current: Map<string, { x: number; y: number; z: number }> };

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

  useGuardedFrame((_, delta) => {
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
      mesh.position.set(burst.x, burst.y + height / 2, burst.z);
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
        const y =
          burst.y + THREE.MathUtils.lerp(seed.yFrac * spawnHeight, burst.height / 2, convergence);
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

  useGuardedFrame((_, delta) => {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: popKey is a trigger, not read in the body; a new prop type must restart the pop-in animation.
  useEffect(() => {
    age.current = 0;
  }, [popKey]);

  useGuardedFrame((_, delta) => {
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
  const { scene } = useSharedGLTF(url);
  const object = useMemo(() => {
    const clone = scene.clone(true);
    enableShadows(clone);
    return clone;
  }, [scene]);
  const { scale, offset } = useMemo(
    () => fitModel(new THREE.Box3().setFromObject(object), width, height, baseY, scaleMul),
    [object, width, height, baseY, scaleMul],
  );
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

/**
 * Tallest rendered height of a tile group, in world units. Floor and road
 * tiles come out near zero: those must not cast, because a flat double-sided
 * tile that casts shadows its own surface and darkens the whole floor.
 */
function tileHeight(geometry: THREE.BufferGeometry, tiles: TileInstance[]): number {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const local = box ? box.max.y - box.min.y : 0;
  let height = 0;
  for (const tile of tiles) {
    height = Math.max(height, local * (tile.scaleY ?? tile.scale ?? 1));
  }
  return height;
}

function InstancedTiles({ url, tiles }: { url: string; tiles: TileInstance[] }) {
  const { scene } = useSharedGLTF(url);
  const { geometry, material } = useMemo(() => {
    const mesh = firstMesh(scene);
    return { geometry: mesh.geometry, material: mesh.material };
  }, [scene]);
  const castShadow = useMemo(
    () => tileHeight(geometry, tiles) > FLAT_TILE_MAX_HEIGHT,
    [geometry, tiles],
  );
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
  }, [tiles]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, tiles.length]}
      castShadow={castShadow}
      receiveShadow
      frustumCulled={false}
      dispose={null}
    />
  );
}

/** One catalog prop, as its fitted GLB or, without a model, its primitive parts. */
export function PropMesh({ def }: { def: PropDefinition }) {
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
  const { scene } = useSharedGLTF(url);
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

/**
 * The hunter's first-person weapon, parented to the camera so it rides the view.
 *
 * No yaw correction: every blaster in the Kenney kit is authored with its muzzle
 * along -Z, which is already the direction a three.js camera looks, so the model
 * needs no rotation to point downrange. It used to carry a 180° yaw, which aimed
 * the muzzle back at the player.
 */
function HunterViewmodel({
  enabled,
  weapon,
  motionRef,
  catchRef,
}: {
  enabled: boolean;
  weapon: WeaponId;
  motionRef: LocalMotionRef;
  catchRef: CatchMomentRef;
}) {
  const camera = useThree((state) => state.camera);
  const groupRef = useRef<THREE.Group>(null);
  const bobPhase = useRef(0);
  const sway = useRef({ x: 0, y: 0, prevYaw: 0, prevPitch: 0 });

  useGuardedFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || inHitstop(catchRef)) return;
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
      <group ref={groupRef} position={WEAPON_OFFSET}>
        <Suspense fallback={null}>
          <WeaponModel url={WEAPONS[weapon].model} scale={WEAPON_SCALE} />
        </Suspense>
      </group>
    </primitive>
  );
}

/** The static map: base plane, instanced tiles, fitted props and scenery. */
export const MapView = memo(function MapView({
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
      {map.ground !== undefined && <GroundView ground={map.ground} />}

      <Suspense fallback={null}>
        {tileGroups.map(([url, group]) => (
          <InstancedTiles key={url} url={url} tiles={group} />
        ))}
      </Suspense>

      <StaticModels map={map} catalog={catalog} />

      {map.props.map((instance, index) => {
        const def = catalog.get(instance.type);
        if (!def || def.model) {
          return null;
        }
        return (
          <group
            // biome-ignore lint/suspicious/noArrayIndexKey: static per-map props, never reordered
            key={`prop-${index}`}
            position={[instance.position.x, instance.position.y, instance.position.z]}
            rotation-y={instance.rotation}
          >
            <PrimitiveParts parts={def.parts} />
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

function PropActions({
  room,
  enabled,
  motionRef,
}: {
  room: Room;
  enabled: boolean;
  motionRef: LocalMotionRef;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "KeyR") room.send(MSG_REROLL);
      else if (event.code === "KeyC" && motionRef.current.grounded) room.send(MSG_DECOY);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, room, motionRef]);

  return null;
}

/** Turns `look` by the locked pointer's movement while `enabled`, and locks the pointer on a canvas click. */
function useMouseLook(look: LookRef, enabled: boolean): LookRef {
  const { gl } = useThree();
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const el = gl.domElement;
    const requestLock = () => {
      if (document.pointerLockElement !== el) {
        lockPointer(el);
      }
    };
    const onMove = (event: MouseEvent) => {
      if (!enabledRef.current || document.pointerLockElement !== el) {
        return;
      }
      const sensitivity = LOOK_SENSITIVITY * lookSensitivity();
      look.current.yaw -= event.movementX * sensitivity;
      look.current.pitch = THREE.MathUtils.clamp(
        look.current.pitch + event.movementY * sensitivity,
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
  }, [gl, look]);

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
  lookRef: LookRef;
  tauntPulseRef: TauntPulseRef;
  inputBlocked: boolean;
  playersRef: PlayersRef;
  colliders: ObbCollider[];
  decoyColliders: Map<string, ObbCollider[]>;
  walls: Wall[];
  avatar: string;
  playerPos: PlayerPosRef;
  motionRef: LocalMotionRef;
  catchRef: CatchMomentRef;
  caughtCam: CaughtCam | null;
  replaying: boolean;
  turnStep: PropTurnStep;
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
  lookRef,
  tauntPulseRef,
  inputBlocked,
  playersRef,
  colliders,
  decoyColliders,
  walls,
  avatar,
  playerPos,
  motionRef,
  catchRef,
  caughtCam,
  replaying,
  turnStep,
}: LocalPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const keys = useControls(!inputBlocked);
  const look = useMouseLook(lookRef, !inputBlocked);
  const { camera, gl } = useThree();

  const spawn = map.spawnPoints.props[0] ?? map.bounds.min;
  const body = useMemo<MovementBody>(
    () => ({
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      vx: 0,
      vy: 0,
      vz: 0,
      heading: 0,
      jumpBufferMs: 0,
      jumpHeld: false,
      stepDistance: 0,
    }),
    [spawn.x, spawn.y, spawn.z],
  );
  const spawnApplied = useRef(false);
  const sendAccumMs = useRef(0);
  const lastSentInput = useRef({
    x: Number.NaN,
    y: Number.NaN,
    z: Number.NaN,
    rot: Number.NaN,
    aim: Number.NaN,
    propRot: Number.NaN,
  });
  const camDistRef = useRef(propCameraDistance(null));
  const zoomRef = useRef(PROP_ZOOM_DEFAULT);
  const zoomTargetRef = useRef(PROP_ZOOM_DEFAULT);
  const ceiling = map.ceiling ?? NO_CEILING;
  const propRot = useRef(0);
  const turnPress = useRef<PropTurnPress>(idlePropTurn());
  const prevPropType = useRef("");

  const frozen = !alive || (role === "hunter" && phase === "hiding") || caughtCam !== null;
  const [view, setView] = useState<PropView>(propView);
  const firstPerson = role === "prop" && view === "first";
  const disguiseHeight = useMemo(() => {
    const def = propType ? catalog.get(propType) : undefined;
    return def ? computePropBounds(def).yMax : null;
  }, [catalog, propType]);
  const eyeHeight = disguiseHeight === null ? PLAYER_EYE_HEIGHT : propEyeHeight(disguiseHeight);
  const thirdPersonProp = role === "prop" && !firstPerson;

  const canSwitchView = role === "prop" && alive && caughtCam === null && !inputBlocked;
  useEffect(() => {
    if (!canSwitchView) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyV" || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      setView((current) => (current === "first" ? "third" : "first"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSwitchView]);

  useEffect(() => {
    setPropView(view);
  }, [view]);

  useEffect(() => {
    if (firstPerson) lookRef.current.pitch = 0;
    else if (thirdPersonProp) lookRef.current.pitch = TP_DEFAULT_PITCH;
  }, [firstPerson, thirdPersonProp, lookRef]);

  const dealing = phase === "hiding";
  const wasDealing = useRef(false);

  const canZoom = thirdPersonProp && alive && caughtCam === null && !inputBlocked;
  useEffect(() => {
    if (!canZoom) return;
    const el = gl.domElement;
    const onWheel = (event: WheelEvent) => {
      if (document.pointerLockElement !== el || event.ctrlKey) return;
      zoomTargetRef.current = zoomByWheel(zoomTargetRef.current, wheelDeltaPx(event).y);
    };
    window.addEventListener("wheel", onWheel);
    return () => window.removeEventListener("wheel", onWheel);
  }, [canZoom, gl]);

  useEffect(() => {
    if (!caughtCam) return;
    const hunter = playersRef.current.get(caughtCam.byId);
    if (!hunter) return;
    const dx = hunter.x - body.x;
    const dz = hunter.z - body.z;
    if (Math.hypot(dx, dz) < DIRECTION_EPSILON) return;
    body.heading = Math.atan2(dx, dz);
    lookRef.current.yaw = Math.atan2(-dx, -dz);
    lookRef.current.pitch = 0;
  }, [caughtCam, playersRef, body, lookRef]);
  const runMultiplier = role === "hunter" ? RUN_MULTIPLIER_HUNTER : RUN_MULTIPLIER_PROP;
  const decoyGhosts = useRef(createDecoyGhosts());

  useGuardedFrame((_, rawDelta) => {
    const delta = cappedFrameSeconds(rawDelta);
    if (!spawnApplied.current) {
      const self = playersRef.current.get(id);
      if (self) {
        body.x = self.x;
        body.y = self.y;
        body.z = self.z;
        body.heading = self.rot;
        spawnApplied.current = true;
      }
    }

    const teleport = teleportRef.current;
    if (teleport) {
      body.x = teleport.x;
      body.y = 0;
      body.z = teleport.z;
      body.vy = 0;
      teleportRef.current = null;
    }

    const { yaw, pitch } = look.current;

    const cameFrom = { x: body.x, z: body.z };

    const solid = solidColliders(
      colliders,
      decoyColliders,
      updateDecoyGhosts(decoyGhosts.current, body, decoyColliders),
    );
    const world = { colliders: solid, bounds: map.bounds, runMultiplier };

    let support: number;
    let horizSpeed = 0;
    let sprinting = false;

    if (frozen) {
      body.vx = 0;
      body.vz = 0;
      support = supportHeightAt(body.x, body.z, body.y, solid);
    } else {
      const k = keys.current;
      const moved = advanceMovement(
        body,
        {
          forward: (k.forward ? 1 : 0) - (k.back ? 1 : 0),
          strafe: (k.right ? 1 : 0) - (k.left ? 1 : 0),
          yaw,
          run: k.run,
          jump: k.jump,
        },
        world,
        delta,
      );
      support = moved.support;
      horizSpeed = moved.speed;
      sprinting = k.run && horizSpeed > MOVE_SPEED;
      if (moved.footstep) playStep();
      if (moved.jumped) playJump();
      if (moved.landingImpact > 0) {
        motionRef.current.landing = Math.max(motionRef.current.landing, moved.landingImpact);
        playLand(moved.landingImpact);
      }
    }

    if (propType && propType !== prevPropType.current) {
      propRot.current = body.heading;
      resetPropTurn(turnPress.current);
      zoomTargetRef.current = PROP_ZOOM_DEFAULT;
    }
    prevPropType.current = propType;
    if (dealing && !wasDealing.current) {
      zoomTargetRef.current = PROP_ZOOM_DEFAULT;
      if (thirdPersonProp) look.current.pitch = TP_DEFAULT_PITCH;
    }
    wasDealing.current = dealing;
    if (role === "prop") {
      const k = keys.current;
      propRot.current = advancePropTurn(
        turnPress.current,
        propRot.current,
        k.turnRight === k.turnLeft ? 0 : k.turnRight ? 1 : -1,
        turnStep,
        delta,
      );
    } else {
      resetPropTurn(turnPress.current);
    }

    if (alive) {
      for (const [otherId, other] of playersRef.current) {
        if (otherId === id || !other.alive) continue;
        if (Math.abs(body.y - other.y) >= PLAYER_HEIGHT) continue;
        const dx = body.x - other.x;
        const dz = body.z - other.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > 1e-8 && distSq < PLAYER_SEPARATION * PLAYER_SEPARATION) {
          const dist = Math.sqrt(distSq);
          const push = PLAYER_SEPARATION - dist;
          body.x += (dx / dist) * push;
          body.z += (dz / dist) * push;
        }
      }
      resolveColliders(body, solid, cameFrom);
      clampToBounds(body, map.bounds);
    }

    playerPos.current.set(body.x, body.y, body.z);
    const group = groupRef.current;
    if (group) {
      group.position.set(body.x, body.y, body.z);
      group.rotation.y = role === "prop" && propType ? propRot.current : body.heading;
      applyTauntPulse(group, tauntPulseRef, id);
    }

    const motion = motionRef.current;
    if (!inHitstop(catchRef)) motion.recoil *= RECOIL_DAMP ** delta;
    motion.landing *= LAND_DAMP ** delta;
    motion.speed = horizSpeed;
    motion.sprinting = sprinting;
    motion.grounded = body.y <= support + GROUND_EPSILON;
    motion.yaw = yaw;
    motion.pitch = pitch;

    const perspective = camera as THREE.PerspectiveCamera;
    const targetFov =
      cappedVerticalFov(fieldOfView(), perspective.aspect) + (sprinting ? SPRINT_FOV_ADD : 0);
    if (Math.abs(perspective.fov - targetFov) > FOV_EPSILON) {
      perspective.fov += (targetFov - perspective.fov) * (1 - FOV_DAMP ** delta);
      perspective.updateProjectionMatrix();
    }

    if (caughtCam) {
      if (!replaying) {
        placeCaughtCamera(
          camera,
          body,
          playersRef.current.get(caughtCam.byId),
          (performance.now() - caughtCam.at) / CAUGHT_CAM_MS,
          walls,
        );
      }
    } else if (role === "hunter") {
      const aimPitch = pitch - motion.recoil * RECOIL_MAX_PITCH;
      const cosPitch = Math.cos(aimPitch);
      const eyeY = body.y + PLAYER_EYE_HEIGHT - motion.landing * LAND_DIP_Y;
      camera.position.set(body.x, eyeY, body.z);
      camera.lookAt(
        body.x - Math.sin(yaw) * cosPitch,
        eyeY - Math.sin(aimPitch),
        body.z - Math.cos(yaw) * cosPitch,
      );
      const shakeAge = sinceCatch(catchRef);
      if (shakeAge < CATCH_SHAKE_MS) {
        const amplitude = CATCH_SHAKE_RAD * (1 - shakeAge / CATCH_SHAKE_MS) ** 2;
        const seconds = shakeAge / 1000;
        camera.rotateX(amplitude * Math.sin(seconds * CATCH_SHAKE_FREQ_X));
        camera.rotateY(amplitude * Math.cos(seconds * CATCH_SHAKE_FREQ_Y));
      }
    } else if (firstPerson) {
      const cosPitch = Math.cos(pitch);
      const eyeY =
        body.y +
        capUnderCeiling(
          eyeHeight,
          body.y,
          1,
          ceilingHeightAt(ceiling, body.x, body.z),
          CAMERA_CEILING_MARGIN,
          CAMERA_MIN_DISTANCE,
        );
      camera.position.set(body.x, eyeY, body.z);
      camera.lookAt(
        body.x - Math.sin(yaw) * cosPitch,
        eyeY - Math.sin(pitch),
        body.z - Math.cos(yaw) * cosPitch,
      );
      camDistRef.current = CAMERA_MIN_DISTANCE;
    } else {
      const localPitch = THREE.MathUtils.clamp(pitch, TP_PITCH_MIN, TP_PITCH_MAX);
      look.current.pitch = localPitch;
      const cosPitch = Math.cos(localPitch);
      const dirX = Math.sin(yaw) * cosPitch;
      const dirY = Math.sin(localPitch);
      const dirZ = Math.cos(yaw) * cosPitch;

      zoomRef.current += (zoomTargetRef.current - zoomRef.current) * (1 - PROP_ZOOM_DAMP ** delta);
      const reach = propCameraDistance(disguiseHeight) * zoomRef.current;
      let desired = reach;
      const hitXZ = nearestWallDistanceXZ(
        body.x,
        body.z,
        Math.sin(yaw),
        Math.cos(yaw),
        reach * cosPitch,
        walls,
      );
      const wallDistance = hitXZ / cosPitch;
      if (wallDistance < desired) {
        desired = Math.max(wallDistance - CAMERA_WALL_MARGIN, CAMERA_MIN_DISTANCE);
      }
      const pivotY = body.y + propCameraTargetY(disguiseHeight);
      desired = capUnderCeiling(
        desired,
        pivotY,
        dirY,
        ceilingBetween(ceiling, body.x, body.z, body.x + dirX * desired, body.z + dirZ * desired),
        CAMERA_CEILING_MARGIN,
        CAMERA_MIN_DISTANCE,
      );

      const current = camDistRef.current;
      camDistRef.current =
        desired < current ? desired : current + (desired - current) * (1 - CAMERA_DAMP ** delta);
      const d = camDistRef.current;

      camera.position.set(
        body.x + dirX * d,
        Math.max(pivotY + dirY * d, body.y + CAMERA_FLOOR_MARGIN),
        body.z + dirZ * d,
      );
      camera.lookAt(body.x, pivotY, body.z);
    }

    sendAccumMs.current += delta * 1000;
    if (sendAccumMs.current >= INPUT_SEND_RATE_MS) {
      sendAccumMs.current = Math.min(sendAccumMs.current - INPUT_SEND_RATE_MS, INPUT_SEND_RATE_MS);
      const aim = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
      const last = lastSentInput.current;
      const moved =
        !(Math.abs(body.x - last.x) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(body.y - last.y) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(body.z - last.z) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(body.heading - last.rot) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(aim - last.aim) < INPUT_IDLE_EPSILON) ||
        !(Math.abs(wrapAngle(propRot.current - last.propRot)) < INPUT_IDLE_EPSILON);
      if (moved) {
        const payload = {
          x: body.x,
          y: body.y,
          z: body.z,
          rot: body.heading,
          aim,
          propRot: propRot.current,
        };
        lastSentInput.current = payload;
        room.send(MSG_INPUT, payload);
      }
    }
  });

  return (
    <group ref={groupRef} visible={!replaying}>
      {alive && role !== "hunter" && (
        <group visible={!firstPerson || caughtCam !== null}>
          <PlayerModel role={role} propType={propType} avatar={avatar} catalog={catalog} />
        </group>
      )}
      {caughtCam && role === "hunter" && <AnimalAvatar id={avatar} role={role} />}
    </group>
  );
}

/**
 * The caught prop's camera: it starts at the prop and eases back and up, away from the
 * hunter who got it and looking past the prop toward them, so the shatter sits in the lower
 * frame and the catcher above it. It pulls in short of a wall rather than through one, and
 * aims nearer the prop when it does, so the prop stays in frame.
 */
function placeCaughtCamera(
  camera: THREE.Camera,
  body: MovementBody,
  hunter: RemotePlayerView | undefined,
  progress: number,
  walls: Wall[],
): void {
  const hx = hunter?.x ?? body.x - Math.sin(body.heading);
  const hz = hunter?.z ?? body.z - Math.cos(body.heading);
  let dirX = body.x - hx;
  let dirZ = body.z - hz;
  const length = Math.hypot(dirX, dirZ);
  if (length < DIRECTION_EPSILON) {
    dirX = Math.sin(body.heading);
    dirZ = Math.cos(body.heading);
  } else {
    dirX /= length;
    dirZ /= length;
  }
  const ease = easeOutCubic(THREE.MathUtils.clamp(progress, 0, 1));
  let distance = THREE.MathUtils.lerp(CAUGHT_CAM_START_DISTANCE, CAUGHT_CAM_END_DISTANCE, ease);
  const wall = nearestWallDistanceXZ(body.x, body.z, dirX, dirZ, distance, walls);
  if (wall < distance) distance = Math.max(wall - CAMERA_WALL_MARGIN, CAMERA_MIN_DISTANCE);
  const pivotY = body.y + CAMERA_TARGET_Y;
  const rise = THREE.MathUtils.lerp(CAUGHT_CAM_START_RISE, CAUGHT_CAM_END_RISE, ease);
  camera.position.set(body.x + dirX * distance, pivotY + rise, body.z + dirZ * distance);
  const ahead = Math.min(length, distance * CAUGHT_CAM_LOOK_AHEAD_RATIO);
  camera.lookAt(body.x - dirX * ahead, pivotY, body.z - dirZ * ahead);
}

/**
 * Samples every player in play into the kill cam's pose ring while the local player is a
 * prop in the hunt: remote players at the smoothed pose they are drawn at, the local player
 * at its own body. The ring is preallocated and the per-player callback is built once, so a
 * sample writes numbers and string references and allocates nothing.
 */
function KillCamRecorder({
  enabled,
  log,
  localId,
  playersRef,
  localPos,
  renderPoses,
}: {
  enabled: boolean;
  log: KillCamLog;
  localId: string;
  playersRef: PlayersRef;
  localPos: PlayerPosRef;
  renderPoses: RenderPosesRef;
}) {
  const record = useMemo(() => {
    const ring = log.ring;
    return (view: RemotePlayerView, id: string) => {
      if (!view.alive) return;
      const at = id === localId ? localPos.current : (renderPoses.current.get(id) ?? view);
      pushPose(
        ring,
        id,
        view.role === "hunter",
        view.propType,
        at.x,
        at.y,
        at.z,
        view.rot,
        view.aim,
        view.propRot,
      );
    };
  }, [log, localId, localPos, renderPoses]);

  useGuardedFrame(() => {
    if (!enabled) return;
    const now = performance.now();
    if (!sampleDue(log.ring, now)) return;
    beginSample(log.ring, now);
    playersRef.current.forEach(record);
  });

  return null;
}

/**
 * The kill cam: the last moments before the local prop was caught, replayed through the
 * hunter's eyes at its synced pose, with every other player drawn as they looked, the shots
 * fired again as tracers and the victim's disguise shattering on the killing shot. It only
 * moves the camera and its own copies of the players; the live ones are hidden meanwhile.
 */
function KillCamView({
  playback,
  catalog,
  meta,
  shotsRef,
  breaksRef,
  catchRef,
}: {
  playback: KillCamPlayback;
  catalog: Catalog;
  meta: SceneMetaMap;
  shotsRef: ShotsRef;
  breaksRef: BreaksRef;
  catchRef: CatchMomentRef;
}) {
  const { replay, startedAt } = playback;
  const camera = useThree((state) => state.camera);
  const hunterTrack = useMemo(
    () => replay.tracks.find((track) => track.id === replay.hunterId),
    [replay],
  );
  const victimTrack = useMemo(
    () => replay.tracks.find((track) => track.id === replay.victimId),
    [replay],
  );
  const cast = useMemo(
    () =>
      replay.tracks
        .filter((track) => track.id !== replay.hunterId)
        .map((track) => ({ track, look: appearanceOf(track, replay.victimId) })),
    [replay],
  );
  const actorRefs = useRef(new Map<string, THREE.Group>());
  const decoyRefs = useRef<(THREE.Group | null)[]>([]);
  const pose = useMemo(createPoseOut, []);
  const eye = useMemo(createEyeOut, []);
  const shotCursor = useRef(0);
  const broke = useRef(false);
  const lastEye = useRef({ x: Number.NaN, z: Number.NaN, t: 0 });
  const lastShotAt = useRef(Number.NEGATIVE_INFINITY);
  const motionRef = useRef<LocalMotion>({
    speed: 0,
    sprinting: false,
    grounded: true,
    yaw: 0,
    pitch: 0,
    recoil: 0,
    landing: 0,
  });

  useGuardedFrame(() => {
    const t = sourceTimeAt(replay, performance.now() - startedAt);

    while (shotCursor.current < replay.shots.length) {
      const shot = replay.shots[shotCursor.current];
      if (!shot || shot.at > t) break;
      shotCursor.current++;
      shotsRef.current.push({ weapon: shot.weapon, origin: shot.origin, ends: shot.ends });
      const heard = hunterTrack !== undefined && samplePose(hunterTrack, shot.at, pose);
      const distance = heard ? Math.hypot(pose.x - shot.origin.x, pose.z - shot.origin.z) : 0;
      playWeaponShot(shot.weapon, Math.max(0, 1 - distance / KILL_CAM_SHOT_SOUND_RANGE));
      if (shot.shooterId === replay.hunterId) lastShotAt.current = shot.at;
    }

    if (!broke.current && t >= replay.shotAt) {
      broke.current = true;
      const look = victimTrack ? appearanceOf(victimTrack, replay.victimId) : null;
      if (victimTrack && look?.propType && samplePose(victimTrack, replay.shotAt, pose)) {
        breaksRef.current.push({ x: pose.x, y: pose.y, z: pose.z, propType: look.propType });
      }
    }

    for (const { track, look } of cast) {
      const group = actorRefs.current.get(track.id);
      if (!group) continue;
      const shown = !(track.id === replay.victimId && broke.current) && samplePose(track, t, pose);
      group.visible = shown;
      if (!shown) continue;
      group.position.set(pose.x, pose.y, pose.z);
      group.rotation.y = !look.hunter && look.propType ? pose.propRot : pose.rot;
    }

    replay.decoys.forEach((decoy, i) => {
      const group = decoyRefs.current[i];
      if (group) group.visible = decoyStandsAt(decoy, t);
    });

    if (!hunterTrack || !hunterEyeAt(replay, hunterTrack, t, PLAYER_EYE_HEIGHT, pose, eye)) return;
    const cosPitch = Math.cos(eye.pitch);
    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(
      eye.x + Math.sin(eye.yaw) * cosPitch,
      eye.y + Math.sin(eye.pitch),
      eye.z + Math.cos(eye.yaw) * cosPitch,
    );

    const motion = motionRef.current;
    const prev = lastEye.current;
    const dt = (t - prev.t) / 1000;
    motion.speed =
      dt > 0 && Number.isFinite(prev.x) ? Math.hypot(eye.x - prev.x, eye.z - prev.z) / dt : 0;
    prev.x = eye.x;
    prev.z = eye.z;
    prev.t = t;
    motion.yaw = eye.yaw;
    motion.pitch = -eye.pitch;
    const sinceShot = (t - lastShotAt.current) / 1000;
    motion.recoil = sinceShot >= 0 ? RECOIL_DAMP ** sinceShot : 0;
  });

  return (
    <>
      {cast.map(({ track, look }) => (
        <group
          key={track.id}
          visible={false}
          ref={(group) => {
            if (group) actorRefs.current.set(track.id, group);
            else actorRefs.current.delete(track.id);
          }}
        >
          <ReplayActor look={look} avatar={meta[track.id]?.avatar ?? ""} catalog={catalog} />
        </group>
      ))}
      {replay.decoys.map((decoy, i) => {
        const def = catalog.get(decoy.propType);
        if (!def) return null;
        return (
          <group
            key={`${decoy.id}:${decoy.from}`}
            visible={false}
            position={[decoy.x, decoy.y, decoy.z]}
            rotation={[0, decoy.rot, 0]}
            ref={(group) => {
              decoyRefs.current[i] = group;
            }}
          >
            <PropMesh def={def} />
          </group>
        );
      })}
      <HunterViewmodel enabled weapon={replay.weapon} motionRef={motionRef} catchRef={catchRef} />
    </>
  );
}

/** A replayed player, drawn without the pop-in a live disguise change plays. */
function ReplayActor({
  look,
  avatar,
  catalog,
}: {
  look: Appearance;
  avatar: string;
  catalog: Catalog;
}) {
  const def = !look.hunter && look.propType ? catalog.get(look.propType) : undefined;
  if (def) return <PropMesh def={def} />;
  return <AnimalAvatar id={avatar} role={look.hunter ? "hunter" : "prop"} />;
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
  catchRef: CatchMomentRef;
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
  catchRef,
}: RemotePlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const nameplateRef = useRef<THREE.Group>(null);
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

  useGuardedFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || !view || inHitstop(catchRef, view.id)) {
      return;
    }
    const t = 1 - REMOTE_DAMP ** delta;
    group.position.x += (view.x - group.position.x) * t;
    group.position.y += (view.y - group.position.y) * t;
    group.position.z += (view.z - group.position.z) * t;
    group.rotation.y = role === "prop" && propType ? view.propRot : view.rot;
    applyTauntPulse(group, tauntPulseRef, view.id);
    if (nameplateRef.current) {
      nameplateRef.current.visible =
        Math.hypot(group.position.x - localPos.current.x, group.position.z - localPos.current.z) >
        NAMEPLATE_MIN_DISTANCE;
    }

    const pose = renderPoses.current.get(view.id);
    if (pose) {
      pose.x = group.position.x;
      pose.y = group.position.y;
      pose.z = group.position.z;
    } else {
      renderPoses.current.set(view.id, {
        x: group.position.x,
        y: group.position.y,
        z: group.position.z,
      });
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
      {showName ? (
        <group ref={nameplateRef}>
          <AllyNameplate name={view.name} y={nameplateY} />
        </group>
      ) : null}
    </group>
  );
}
