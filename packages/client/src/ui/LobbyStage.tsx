import { type AvatarId, MAP_CATALOG, type MapId } from "@morphy/shared";
import { Billboard, Html, Sky, Stars, Text, useAnimations } from "@react-three/drei";
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import {
  lazy,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { playUiHover } from "../game/audio";
import { CeilingView } from "../game/CeilingView";
import type { PostLook } from "../game/graphicsTier";
import { enableShadows } from "../game/modelShading";
import type { PostComposer } from "../game/postFx";
import {
  SkyGlow,
  type SkyGlowPreset,
  type StreetLampPreset,
  StreetLamps,
} from "../game/StreetLamps";
import { useSharedGLTF } from "../game/sharedTextures";
import { themeFor } from "../game/themes";
import { MAP_THEME_BASE, MORPH_COLOR } from "../theme";
import { avatarNeighbors } from "./carousel";
import { DIORAMA_FORM_S, pieceScale } from "./dioramaForm";
import { advanceFlicker, beginFlicker, type FlickerState } from "./flicker";
import { LOBBY_DIORAMAS, LOBBY_DRESSING, type SetPiece, type StageLight } from "./lobbyDioramas";
import { STAGE_MAX_ACTORS, type StageActor } from "./stageActors";
import { useReducedMotion } from "./useReducedMotion";
import {
  frameShift,
  layoutAt,
  type Point,
  sliceShape,
  WORLD_IDS,
  type WorldsLayout,
  type WorldsMotion,
} from "./worldSlices";

const StagePost = lazy(() =>
  import("./StagePost").then((module) => ({ default: module.StagePost })),
);

const avatarModel = (id: AvatarId): string => `/models/pets/animal-${id}.glb`;

const AVATAR_HEIGHT = 1.5;
/**
 * The avatar stands right of centre, facing back across it, so the open slice's name and Play
 * have the left of the frame to themselves.
 */
const AVATAR_X = 1.35;
const AVATAR_YAW = -0.35;
const MODEL_MIN_SIZE = 0.001;
const CLIP_FADE_SECONDS = 0.3;

const STAGE_FRONT_X = 0.7;
const STAGE_FRONT_Z = 0.35;
const STAGE_STEP_X = -1.2;
const STAGE_STEP_Z = 0.8;
const STAGE_YAW = -0.15;

const NAMEPLATE_Y = AVATAR_HEIGHT + 0.42;
const NAMEPLATE_FONT_SIZE = 0.14;
const NAMEPLATE_COLOR = "#eef4ff";
const NAMEPLATE_OUTLINE_COLOR = "#11161f";
const NAMEPLATE_OUTLINE_WIDTH = 0.015;

const CHIP_Y = AVATAR_HEIGHT + 0.12;
const CHIP_Z_INDEX = 2;

const MORPH_CAMERA_Y = 1.2;
const MORPH_CAMERA_Z = 3.3;
const MORPH_LOOK_Y = 0.92;
const MORPH_DOLLY_DAMP = 4.2;

const GHOST_OFFSET_X = 1.5;
const GHOST_OFFSET_Z = -1.2;
const GHOST_HEIGHT = AVATAR_HEIGHT * 0.74;
const GHOST_OPACITY = 0.28;
const GHOST_FADE_S = 0.28;

const MORPH_DURATION_S = 0.5;
const MORPH_POP_DURATION_S = 0.35;
const MORPH_BEAM_DURATION_S = 0.3;
const MORPH_BEAM_GROW_FRACTION = 0.35;
const MORPH_BEAM_OPACITY = 0.55;
const MORPH_BEAM_SEGMENTS = 12;
const MORPH_BEAM_RADIUS = 0.62;
const MORPH_BEAM_HEIGHT_MULT = 1.6;
const MORPH_SHARD_COUNT = 24;
const MORPH_SHARD_SIZE = 0.13;
const MORPH_SHARD_SPAWN_RADIUS = 1.25;
const MORPH_SHARD_SPAWN_HEIGHT_MULT = 1.5;
const MORPH_SHARD_SPIN = 9;
const POP_SETTLED = Number.POSITIVE_INFINITY;

/*
 * The one budget a world's arrival is spent from. The stage runs at `STAGE_BOOST_FPS` and keeps
 * its shadow map live for exactly as long as a world takes to form, so both are derived from the
 * fold that owns the timeline rather than tuned next to it, where they used to drift.
 */
const DIORAMA_SETTLE_MS = DIORAMA_FORM_S * 1000;

const LAMP_GLOW = 1.6;
const LAMP_OFF = "#000000";
const LAMP_PANEL_OFFSET_Y = 0.35;
const LAMP_PANEL_SIZE: [number, number, number] = [1.1, 0.1, 0.45];

/**
 * True for `STAGE_BOOST_MS` after every change of `beat`. The stage idles at 30 fps, which is
 * plenty for a parallax drift but coarse for the morph dolly, a slice opening and the pop that
 * follows a step, so those get `STAGE_BOOST_FPS` for as long as they are actually running.
 */
function useMotionBoost(beat: string): boolean {
  const [boosted, setBoosted] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: beat is a trigger, not read in the body; each change restarts the boost window.
  useEffect(() => {
    setBoosted(true);
    const id = setTimeout(() => setBoosted(false), STAGE_BOOST_MS);
    return () => clearTimeout(id);
  }, [beat]);

  return boosted;
}

interface ModelFit {
  scale: number;
  offset: readonly [number, number, number];
}

function fitToHeight(object: THREE.Object3D, height: number): ModelFit {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = height / Math.max(size.y, MODEL_MIN_SIZE);
  return {
    scale,
    offset: [-center.x * scale, -box.min.y * scale, -center.z * scale] as const,
  };
}

interface StageSlot {
  x: number;
  z: number;
  yaw: number;
}

const SOLO_SLOT: StageSlot = { x: AVATAR_X, z: 0, yaw: AVATAR_YAW };

function computeStageSlots(count: number, inParty: boolean): StageSlot[] {
  if (!inParty) return [SOLO_SLOT];
  const n = Math.min(Math.max(count, 1), STAGE_MAX_ACTORS);
  const slots: StageSlot[] = [];
  for (let i = 0; i < n; i++) {
    slots.push({
      x: STAGE_FRONT_X + i * STAGE_STEP_X,
      z: STAGE_FRONT_Z - i * STAGE_STEP_Z,
      yaw: STAGE_YAW,
    });
  }
  return slots;
}

const CAMERA_FOV = 38;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const CAMERA_BASE: [number, number, number] = [0, 1.5, 6];
const STAGE_MAX_FPS = 30;
const STAGE_BOOST_FPS = 60;
const STAGE_BOOST_MS = DIORAMA_SETTLE_MS;
const STAGE_DPR: [number, number] = [1, 1.25];
const CAMERA_LOOK_AT = new THREE.Vector3(0, 1.05, 0);
const PARALLAX_X = 0.55;
const PARALLAX_Y = 0.25;
const PARALLAX_DAMP = 3.2;

const GROUND_RADIUS = 70;
const SUN_POSITION: [number, number, number] = [14, 26, 10];
const SHADOW_MAP_SIZE = 2048;
const SHADOW_EXTENT = 28;
/*
 * Named rather than left to the Canvas default, which asks for PCFSoft, deprecated in three
 * 0.184 and silently downgraded to this same PCF, with a console warning on every bake. So this
 * is what the stage was already rendering, minus the noise.
 */
const SHADOW_TYPE = "percentage" as const;
const SHADOW_NORMAL_BIAS = 0.02;
const STARS_RADIUS = 90;
const STARS_DEPTH = 40;
const STARS_SPEED = 0.4;
/** Where the night stage's lamps are ranked from: the street, so every lamp of it is lit. */
const LAMP_FOCUS = { current: new THREE.Vector3(0, 0, -4) };

/** Rounding of a closed slice's framing before it counts as changed, in CSS pixels. */
const FRAMING_STEP_PX = 0.5;

const BLIT_VERTEX = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BLIT_FRAGMENT = `
uniform sampler2D map;
uniform vec2 resolution;
void main() {
  gl_FragColor = texture2D(map, gl_FragCoord.xy / resolution);
}
`;

interface StageTheme {
  background: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  ground: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambient: number;
  dir: number;
  dirColor: string;
  /** Penumbra of the key light's shadows, in shadow-map texels; 1 is a hard edge. */
  shadowRadius: number;
  sky: "stars" | "day";
  turbidity: number;
  rayleigh: number;
  stars: { count: number; factor: number };
  skyGlow: SkyGlowPreset | null;
  streetLamps: StreetLampPreset | null;
  post: PostLook;
}

/**
 * Each map's stage by day. North District's is a late afternoon: a warm key and a cool sky
 * fill, so shadows read blue against sunlit faces, a soft penumbra, haze closing the far end
 * of the street and a soft bloom on the sky behind it.
 */
const STAGE_THEMES: Record<MapId, StageTheme> = {
  station: {
    background: "#05080f",
    fog: "#0a101c",
    fogNear: 14,
    fogFar: 46,
    ground: "#39404d",
    hemiSky: MAP_THEME_BASE.station.hemiSky,
    hemiGround: MAP_THEME_BASE.station.hemiGround,
    hemiIntensity: 0.45,
    ambient: 0.22,
    dir: 0.7,
    dirColor: "#ffffff",
    shadowRadius: 1,
    sky: "stars",
    turbidity: 4,
    rayleigh: 1.4,
    stars: { count: 1600, factor: 3 },
    skyGlow: null,
    streetLamps: null,
    post: {
      bloom: { intensity: 7, radius: 0.75, threshold: 0.85 },
      grade: { lift: [0, 0.01, 0.03], gain: [1.02, 1, 0.97], contrast: 1, saturation: 1.05 },
    },
  },
  urban: {
    background: MAP_THEME_BASE.urban.background,
    fog: "#d6d3cc",
    fogNear: 12,
    fogFar: 58,
    ground: "#6b7078",
    hemiSky: "#a9c6ec",
    hemiGround: "#8a7562",
    hemiIntensity: 1.1,
    ambient: 0.45,
    dir: 1.7,
    dirColor: "#ffe2bd",
    shadowRadius: 2.5,
    sky: "day",
    turbidity: 5,
    rayleigh: 2.6,
    stars: { count: 0, factor: 0 },
    skyGlow: null,
    streetLamps: null,
    post: {
      bloom: { intensity: 0.35, radius: 0.8, threshold: 1 },
      grade: {
        lift: [0, 0.008, 0.025],
        gain: [1.05, 1.01, 0.94],
        contrast: 1.05,
        saturation: 1.12,
      },
    },
  },
};

/**
 * A day/night map's stage by night: the match's own night theme (sky, globals, street lamps,
 * post), but the day stage's fog range, which frames the diorama the same either way.
 */
function nightStage(map: MapId): StageTheme {
  const day = STAGE_THEMES[map];
  const night = themeFor(map, true);
  return {
    ...day,
    background: night.background,
    fog: night.fog?.color ?? day.fog,
    fogNear: day.fogNear,
    fogFar: day.fogFar,
    ground: night.ground,
    hemiSky: night.hemiSky,
    hemiGround: night.hemiGround,
    hemiIntensity: night.hemiIntensity,
    ambient: night.ambient,
    dir: night.dir,
    dirColor: night.dirColor,
    sky: night.sky,
    stars: night.stars,
    skyGlow: night.skyGlow,
    streetLamps: night.streetLamps,
    post: { bloom: night.bloom, grade: night.grade },
  };
}

const NIGHT_STAGE_THEMES: Partial<Record<MapId, StageTheme>> = Object.fromEntries(
  MAP_CATALOG.filter((info) => info.dayNight).map((info) => [info.id, nightStage(info.id)]),
);

function stageTheme(map: MapId, night: boolean): StageTheme {
  return (night && NIGHT_STAGE_THEMES[map]) || STAGE_THEMES[map];
}

/**
 * One map's world: its own scene, drawn through its own camera into its slice. The camera is
 * the stage's to frame, never the renderer's to resize, hence `manual`. `age` is how long ago
 * the world's models finished loading, null until they have, and is what the set pieces form by.
 */
interface WorldView {
  map: MapId;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  age: { current: number | null };
}

function createWorldView(map: MapId): WorldView {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  Object.assign(camera, { manual: true });
  camera.position.set(...CAMERA_BASE);
  camera.lookAt(CAMERA_LOOK_AT);
  return { map, scene: new THREE.Scene(), camera, age: { current: null } };
}

/**
 * One avatar on the stage. `materialize` is read **at mount only**: the caller keys this
 * component by avatar id, so mounting while morph mode is on *is* the signal that a step
 * produced this shape, and it pops in from nothing. Feeding the live prop to the scale
 * instead would blank the avatar already standing there the moment the picker opens, since
 * the pop clock has long since settled and would never grow it back.
 */
function AvatarActor({
  avatar,
  slot,
  onSelect,
  materialize = false,
}: {
  avatar: AvatarId;
  slot: StageSlot;
  onSelect?: () => void;
  materialize?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const pop = useRef<THREE.Group>(null);
  const popIn = useRef(materialize).current;
  const popAge = useRef(popIn ? 0 : POP_SETTLED);
  const { scene, animations } = useSharedGLTF(avatarModel(avatar));
  const object = useMemo(() => scene.clone(true), [scene]);
  const { actions, mixer } = useAnimations(animations, group);

  useEffect(() => {
    if (!onSelect) return;
    return () => {
      document.body.style.cursor = "";
    };
  }, [onSelect]);

  const fit = useMemo(() => fitToHeight(object, AVATAR_HEIGHT), [object]);

  useFrame((_, delta) => {
    const node = pop.current;
    if (node === null || popAge.current >= MORPH_POP_DURATION_S) return;
    popAge.current += delta;
    node.scale.setScalar(Math.min(1, popAge.current / MORPH_POP_DURATION_S));
  });

  useEffect(() => {
    const idle = actions.idle;
    const wave = actions["gesture-positive"];
    if (!idle) {
      return;
    }
    if (wave) {
      wave.setLoop(THREE.LoopOnce, 1);
      wave.reset().play();
      const onFinished = (event: { action: THREE.AnimationAction }) => {
        if (event.action !== wave) {
          return;
        }
        idle.reset().fadeIn(CLIP_FADE_SECONDS).play();
      };
      mixer.addEventListener("finished", onFinished);
      return () => {
        mixer.removeEventListener("finished", onFinished);
        mixer.stopAllAction();
      };
    }
    idle.reset().play();
    return () => {
      mixer.stopAllAction();
    };
  }, [actions, mixer]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f scene-graph node, not a DOM element; keyboard path is the stage chip
    <group
      position={[slot.x, 0, slot.z]}
      rotation-y={slot.yaw}
      onClick={
        onSelect &&
        ((e) => {
          e.stopPropagation();
          onSelect();
        })
      }
      onPointerOver={
        onSelect &&
        ((e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
          playUiHover();
        })
      }
      onPointerOut={
        onSelect &&
        (() => {
          document.body.style.cursor = "";
        })
      }
    >
      <group ref={pop} scale={popIn ? 0 : 1}>
        <group
          ref={group}
          position={[fit.offset[0], fit.offset[1], fit.offset[2]]}
          scale={fit.scale}
        >
          <primitive object={object} />
        </group>
      </group>
    </group>
  );
}

/**
 * A carousel neighbour: the real GLB under an additive cyan override, so it reads as matter
 * that has not formed yet. Rendering it is also what warms the cache for the next morph.
 *
 * The fade is clocked from mount, not from the material, and the opacity is rewritten every
 * frame: stepping swaps in a new GLB (and so a new material) mid-carousel, and restarting the
 * fade there would blink both neighbours out on every step.
 */
function AvatarGhost({ avatar, slot }: { avatar: AvatarId; slot: StageSlot }) {
  const { scene } = useSharedGLTF(avatarModel(avatar));
  const ghost = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({
      color: MORPH_COLOR,
      transparent: true,
      opacity: GHOST_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const object = scene.clone(true);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.material = material;
    });
    return { object, material, fit: fitToHeight(object, GHOST_HEIGHT) };
  }, [scene]);

  const fadeAge = useRef(0);

  useEffect(() => () => ghost.material.dispose(), [ghost]);

  useFrame((_, delta) => {
    fadeAge.current = Math.min(GHOST_FADE_S, fadeAge.current + delta);
    ghost.material.opacity = GHOST_OPACITY * (fadeAge.current / GHOST_FADE_S);
  });

  return (
    <group position={[slot.x, 0, slot.z]} rotation-y={slot.yaw}>
      <group
        position={[ghost.fit.offset[0], ghost.fit.offset[1], ghost.fit.offset[2]]}
        scale={ghost.fit.scale}
      >
        <primitive object={ghost.object} />
      </group>
    </group>
  );
}

/**
 * The lobby's materialize burst: a rising beam and one ring of shards that converge on the
 * stage slot, replayed whenever `signal` changes, and on mount when `burstOnMount` says the
 * avatar has just walked into this world. Deliberately not the scene's pooled MorphEffects: only
 * one thing ever morphs here at a time, and this has to keep playing outside the model's
 * suspense boundary so a cold GLB loads under cover of the beam.
 */
function MorphBurst({
  signal,
  slot,
  burstOnMount,
}: {
  signal: string;
  slot: StageSlot;
  burstOnMount: boolean;
}) {
  const beam = useRef<THREE.Mesh>(null);
  const shards = useRef<THREE.InstancedMesh>(null);
  const age = useRef(burstOnMount ? 0 : POP_SETTLED);
  const previous = useRef(signal);

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

  useEffect(() => {
    if (previous.current === signal) return;
    previous.current = signal;
    age.current = 0;
  }, [signal]);

  useFrame((_, delta) => {
    const beamMesh = beam.current;
    const shardMesh = shards.current;
    if (beamMesh === null || shardMesh === null) return;

    const elapsed = age.current;
    if (elapsed >= MORPH_DURATION_S) {
      beamMesh.visible = false;
      shardMesh.count = 0;
      return;
    }
    age.current = elapsed + delta;

    const beamT = elapsed / MORPH_BEAM_DURATION_S;
    if (beamT < 1) {
      const growth = Math.min(1, beamT / MORPH_BEAM_GROW_FRACTION);
      const height = AVATAR_HEIGHT * MORPH_BEAM_HEIGHT_MULT * growth;
      beamMesh.position.set(slot.x, height / 2, slot.z);
      beamMesh.scale.set(MORPH_BEAM_RADIUS, Math.max(height, MODEL_MIN_SIZE), MORPH_BEAM_RADIUS);
      (beamMesh.material as THREE.MeshBasicMaterial).opacity = MORPH_BEAM_OPACITY * (1 - beamT);
      beamMesh.visible = true;
    } else {
      beamMesh.visible = false;
    }

    const t = Math.min(1, elapsed / MORPH_DURATION_S);
    const convergence = t * t;
    const radial = MORPH_SHARD_SPAWN_RADIUS * (1 - convergence);
    const size = Math.max(MORPH_SHARD_SIZE * (1 - t), MODEL_MIN_SIZE);
    const spawnHeight = AVATAR_HEIGHT * MORPH_SHARD_SPAWN_HEIGHT_MULT;
    seeds.forEach((seed, i) => {
      scratch.position.set(
        slot.x + Math.cos(seed.angle) * radial,
        THREE.MathUtils.lerp(seed.yFrac * spawnHeight, AVATAR_HEIGHT / 2, convergence),
        slot.z + Math.sin(seed.angle) * radial,
      );
      scratch.euler.set(seed.spinX * elapsed, 0, seed.spinZ * elapsed);
      scratch.quaternion.setFromEuler(scratch.euler);
      scratch.scale.setScalar(size);
      shardMesh.setMatrixAt(
        i,
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale),
      );
    });
    shardMesh.count = seeds.length;
    shardMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <mesh ref={beam} visible={false} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, MORPH_BEAM_SEGMENTS, 1, true]} />
        <meshBasicMaterial
          color={MORPH_COLOR}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <instancedMesh
        ref={shards}
        args={[undefined, undefined, MORPH_SHARD_COUNT]}
        count={0}
        frustumCulled={false}
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

function ActorNameplate({ label, slot }: { label: string; slot: StageSlot }) {
  return (
    <Billboard position={[slot.x, NAMEPLATE_Y, slot.z]}>
      <Text
        fontSize={NAMEPLATE_FONT_SIZE}
        color={NAMEPLATE_COLOR}
        outlineWidth={NAMEPLATE_OUTLINE_WIDTH}
        outlineColor={NAMEPLATE_OUTLINE_COLOR}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </Billboard>
  );
}

/**
 * One diorama set piece, scaled by how far its world has formed.
 *
 * A piece is anchored by its own footprint, not by the origin its GLB happens to carry. Every
 * `space/exterior` model centres its geometry 2 units right and 1.5 forward of that origin, so
 * anchoring on the origin displaced each such piece by `(2, 1.5) * scale`: a per-piece offset,
 * since scales differ per piece, which is what pulled hand-placed neighbours into each other.
 * Re-centring makes `position` mean where the piece stands, the same promise `FittedModel` keeps
 * in a match, so a layout can be authored by reading the numbers. Height is left alone: these
 * models already sit on y=0, and the rocket stacks on its own parts.
 */
function SetPieceModel({
  piece,
  index,
  count,
  age,
}: {
  piece: SetPiece;
  index: number;
  count: number;
  age: WorldView["age"];
}) {
  const { scene } = useSharedGLTF(piece.url);
  const pop = useRef<THREE.Group>(null);
  const object = useMemo(() => {
    const clone = scene.clone(true);
    enableShadows(clone);
    return clone;
  }, [scene]);
  const anchor = useMemo(() => {
    const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    return [-center.x, 0, -center.z] as const;
  }, [object]);

  useFrame(() => {
    pop.current?.scale.setScalar(pieceScale(age.current, index, count));
  });

  return (
    <group position={piece.position} rotation-y={piece.rotationY ?? 0} scale={piece.scale ?? 1}>
      <group ref={pop} scale={0}>
        <group position={[anchor[0], anchor[1], anchor[2]]}>
          <primitive object={object} />
        </group>
      </group>
    </group>
  );
}

/**
 * A world's own report that it is loaded. A Suspense boundary commits all of its children at
 * once, so an effect on a sibling of the set pieces fires exactly when the last of their models
 * has resolved: no polling, no second loader, nothing added to the `useGLTF` cache.
 */
function DioramaReady({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

/** A world's set pieces, inside their own boundary so an uncached world suspends alone. */
function Diorama({
  map,
  age,
  onReady,
}: {
  map: MapId;
  age: WorldView["age"];
  onReady: () => void;
}) {
  const pieces = LOBBY_DIORAMAS[map];
  return (
    <Suspense fallback={null}>
      {pieces.map((piece, index) => (
        <SetPieceModel
          key={`${piece.url}:${piece.position.join(",")}`}
          piece={piece}
          index={index}
          count={pieces.length}
          age={age}
        />
      ))}
      <DioramaReady onReady={onReady} />
    </Suspense>
  );
}

/** Advances a world's formation clock until it has formed, then leaves it alone. */
function FormClock({ age }: { age: WorldView["age"] }) {
  useFrame((_, delta) => {
    const current = age.current;
    if (current === null || current >= DIORAMA_FORM_S) return;
    age.current = current + delta;
  });
  return null;
}

/**
 * A deck lamp: the point light and the panel it hangs from, whose glow follows the light so a
 * failing lamp reads as a fault in the fixture rather than a pulse from nowhere. The panel is
 * unlit: a lit one took its own light from 0.3 m below and bloomed far past its glow. A failing
 * lamp only fails while its world is `live`: a closed slice keeps the frame it was drawn in, and
 * a lamp caught mid-flicker would stay dark in it.
 */
function StageLamp({
  light,
  age,
  live,
}: {
  light: StageLight;
  age: WorldView["age"];
  live: boolean;
}) {
  const lightRef = useRef<THREE.PointLight>(null);
  const panel = useRef<THREE.MeshBasicMaterial>(null);
  const glow = useMemo(() => new THREE.Color(light.color), [light.color]);
  const flicker = useRef<FlickerState | null>(light.flicker ? beginFlicker(Math.random) : null);

  useFrame((_, delta) => {
    const fade = pieceScale(age.current, 0, 1);
    if (flicker.current) flicker.current = advanceFlicker(flicker.current, delta, Math.random);
    const level = fade * (live ? (flicker.current?.level ?? 1) : 1);
    if (lightRef.current) lightRef.current.intensity = light.intensity * level;
    panel.current?.color.copy(glow).multiplyScalar(LAMP_GLOW * level);
  });

  return (
    <group position={light.position}>
      <pointLight ref={lightRef} color={light.color} intensity={0} distance={light.distance} />
      {!light.bare && (
        <mesh position-y={LAMP_PANEL_OFFSET_Y}>
          <boxGeometry args={LAMP_PANEL_SIZE} />
          <meshBasicMaterial ref={panel} color={LAMP_OFF} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/** The lamps and ceiling a world hangs over its set pieces, forming with them. */
function Dressing({
  map,
  night,
  age,
  live,
}: {
  map: MapId;
  night: boolean;
  age: WorldView["age"];
  live: boolean;
}) {
  const { lights, nightLights, ceiling } = LOBBY_DRESSING[map];
  const roof = useRef<THREE.Group>(null);
  useFrame(() => {
    roof.current?.scale.setScalar(pieceScale(age.current, 0, 1));
  });
  return (
    <>
      {(night && nightLights ? nightLights : lights).map((light) => (
        <StageLamp key={light.position.join(",")} light={light} age={age} live={live} />
      ))}
      {ceiling.length > 0 && (
        <group ref={roof} scale={0}>
          <CeilingView panels={ceiling} />
        </group>
      )}
    </>
  );
}

function FrameLimiter({ fps }: { fps: number }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const intervalMs = 1000 / fps;
    let handle = 0;
    let last = 0;
    const tick = (now: number) => {
      handle = requestAnimationFrame(tick);
      if (now - last < intervalMs) return;
      last = now - ((now - last) % intervalMs);
      invalidate();
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [fps, invalidate]);

  return null;
}

/**
 * The only owner of `shadowMap.autoUpdate`, and the reason it is one component: the stage wants
 * a frozen shadow map, but freezing it the frame new content mounts bakes the diorama while the
 * grow-in still has every set piece at ~0 scale, and nothing ever kicks it again, so a world
 * kept the shadows of nothing. Shadows stay live until `settleMs` after `signal` changes, then
 * freeze with one final bake at full size. Mounted in the open world only: a closed slice is
 * drawn so rarely that the stage bakes its shadows each time it draws it.
 */
function ShadowStage({ signal, settleMs }: { signal: string; settleMs: number }) {
  const gl = useThree((state) => state.gl);

  // biome-ignore lint/correctness/useExhaustiveDependencies: signal is a trigger, not read in the body; new content restarts the settle window.
  useEffect(() => {
    gl.shadowMap.autoUpdate = true;
    const id = setTimeout(() => {
      gl.shadowMap.autoUpdate = false;
      gl.shadowMap.needsUpdate = true;
    }, settleMs);
    return () => {
      clearTimeout(id);
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, signal, settleMs]);

  return null;
}

function Atmosphere({ theme }: { theme: StageTheme }) {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    scene.background = new THREE.Color(theme.background);
    scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, theme]);

  return null;
}

/**
 * Drives the open world's camera: pointer parallax in the menu, and a dolly onto `focus` for the
 * avatar picker. `pointer` is the canvas's own, not the world's: a world is a portal with a
 * pointer of its own that only moves over something in it that listens.
 *
 * The aim point is damped alongside the position rather than set outright: snapping it the
 * frame the picker opens swings the camera in one step, which reads as a cut however smoothly
 * the position travels. A world that closes hands its camera back at rest, so it stands still.
 */
function ParallaxRig({
  picking,
  focus,
  pointer,
}: {
  picking: boolean;
  focus: StageSlot;
  pointer: THREE.Vector2;
}) {
  const camera = useThree((state) => state.camera);
  const reduced = useReducedMotion();
  const scratch = useMemo(() => ({ target: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  const aim = useMemo(() => CAMERA_LOOK_AT.clone(), []);

  useEffect(
    () => () => {
      camera.position.set(...CAMERA_BASE);
      camera.lookAt(CAMERA_LOOK_AT);
    },
    [camera],
  );

  useFrame((_, delta) => {
    if (picking) {
      scratch.target.set(focus.x, MORPH_CAMERA_Y, focus.z + MORPH_CAMERA_Z);
      scratch.look.set(focus.x, MORPH_LOOK_Y, focus.z);
    } else {
      scratch.target.set(
        CAMERA_BASE[0] + pointer.x * PARALLAX_X,
        CAMERA_BASE[1] + pointer.y * PARALLAX_Y,
        CAMERA_BASE[2],
      );
      scratch.look.copy(CAMERA_LOOK_AT);
    }
    const damp = picking ? MORPH_DOLLY_DAMP : PARALLAX_DAMP;
    const k = reduced ? 1 : 1 - Math.exp(-damp * delta);
    camera.position.lerp(scratch.target, k);
    aim.lerp(scratch.look, k);
    camera.lookAt(aim);
  });
  return null;
}

function Ground({ color }: { color: string }) {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <circleGeometry args={[GROUND_RADIUS, 48]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

interface CastProps {
  actors: StageActor[];
  slots: StageSlot[];
  picking: boolean;
  entering: boolean;
  reduced: boolean;
  chipPortal: RefObject<HTMLElement> | null;
  onCustomize: () => void;
}

/** Who stands in the open world: the player and their party, and the picker's ghosts. */
function Cast({ actors, slots, picking, entering, reduced, chipPortal, onCustomize }: CastProps) {
  const selfSlot = slots[0] ?? SOLO_SLOT;
  const self = actors[0];
  const neighbors = self ? avatarNeighbors(self.avatar) : null;
  const morphs = !reduced && (picking || entering);
  return (
    <>
      <Suspense fallback={null}>
        {actors.map((actor, index) => (
          <AvatarActor
            key={`${actor.id}:${actor.avatar}`}
            avatar={actor.avatar}
            slot={slots[index] ?? SOLO_SLOT}
            onSelect={index === 0 && !picking ? onCustomize : undefined}
            materialize={index === 0 && morphs}
          />
        ))}
      </Suspense>
      {picking && neighbors !== null && (
        <>
          <Suspense fallback={null}>
            <AvatarGhost
              avatar={neighbors.prev}
              slot={{
                x: selfSlot.x - GHOST_OFFSET_X,
                z: selfSlot.z + GHOST_OFFSET_Z,
                yaw: selfSlot.yaw,
              }}
            />
          </Suspense>
          <Suspense fallback={null}>
            <AvatarGhost
              avatar={neighbors.next}
              slot={{
                x: selfSlot.x + GHOST_OFFSET_X,
                z: selfSlot.z + GHOST_OFFSET_Z,
                yaw: selfSlot.yaw,
              }}
            />
          </Suspense>
        </>
      )}
      {!reduced && self && (
        <MorphBurst signal={self.avatar} slot={selfSlot} burstOnMount={entering} />
      )}
      {actors.map((actor, index) =>
        index > 0 ? (
          <ActorNameplate
            key={actor.id}
            label={`${actor.isHost ? "★ " : ""}${actor.name}`}
            slot={slots[index] ?? SOLO_SLOT}
          />
        ) : null,
      )}
      {!picking && chipPortal !== null && (
        <Html
          portal={chipPortal}
          position={[selfSlot.x, CHIP_Y, selfSlot.z]}
          center
          zIndexRange={[CHIP_Z_INDEX, CHIP_Z_INDEX]}
          wrapperClass="stage-chip"
        >
          <button
            type="button"
            onClick={onCustomize}
            onPointerEnter={playUiHover}
            aria-label={`${self?.name ?? ""}: change your callsign and avatar`}
          >
            <span className="stage-chip-name">
              {self?.isHost ? "★ " : ""}
              {self?.name ?? ""}
            </span>
            <span className="stage-chip-pencil" aria-hidden="true">
              ✎
            </span>
          </button>
        </Html>
      )}
    </>
  );
}

interface WorldProps extends Omit<CastProps, "reduced"> {
  view: WorldView;
  open: boolean;
  night: boolean;
  reduced: boolean;
  pointer: THREE.Vector2;
  post: RefObject<PostComposer | null>;
  signature: string;
}

/**
 * One map's world, mounted into its own scene. Every world stays mounted so a closed slice can
 * be drawn whenever its framing changes; only the open one holds the cast, the camera rig and
 * the post chain.
 */
function World({ view, open, night, reduced, pointer, post, signature, ...cast }: WorldProps) {
  const theme = stageTheme(view.map, night);
  const street = LOBBY_DRESSING[view.map].street;
  const [loaded, setLoaded] = useState(false);
  const handleReady = useCallback(() => {
    view.age.current = reduced ? DIORAMA_FORM_S : 0;
    setLoaded(true);
  }, [view, reduced]);

  return createPortal(
    <>
      <Atmosphere theme={theme} />
      <FormClock age={view.age} />
      {theme.sky === "stars" && (
        <Stars
          radius={STARS_RADIUS}
          depth={STARS_DEPTH}
          count={theme.stars.count}
          factor={theme.stars.factor}
          fade
          speed={STARS_SPEED}
        />
      )}
      {theme.sky === "day" && (
        <Sky sunPosition={SUN_POSITION} turbidity={theme.turbidity} rayleigh={theme.rayleigh} />
      )}
      {theme.skyGlow && <SkyGlow preset={theme.skyGlow} />}
      {theme.streetLamps && street && (
        <StreetLamps map={street} preset={theme.streetLamps} focus={LAMP_FOCUS} />
      )}
      <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
      <ambientLight intensity={theme.ambient} />
      <directionalLight
        position={SUN_POSITION}
        intensity={theme.dir}
        color={theme.dirColor}
        castShadow
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
        shadow-normalBias={SHADOW_NORMAL_BIAS * theme.shadowRadius}
        shadow-radius={theme.shadowRadius}
      />
      <Ground color={theme.ground} />
      <Diorama map={view.map} age={view.age} onReady={handleReady} />
      <Dressing map={view.map} night={night} age={view.age} live={open} />
      {open && (
        <>
          <ParallaxRig
            picking={cast.picking}
            focus={cast.slots[0] ?? SOLO_SLOT}
            pointer={pointer}
          />
          <ShadowStage signal={`${loaded}:${signature}`} settleMs={DIORAMA_SETTLE_MS} />
          <Suspense fallback={null}>
            <StagePost look={theme.post} target={post} />
          </Suspense>
          <Cast {...cast} reduced={reduced} />
        </>
      )}
    </>,
    view.scene,
    { camera: view.camera },
  );
}

interface SliceBlit {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  uniforms: { map: { value: THREE.Texture | null }; resolution: { value: THREE.Vector2 } };
  texture: THREE.FramebufferTexture | null;
  /** What the copy was drawn at: framing and formation. */
  key: string;
  /** How far formed the world was when its shadows were last baked. */
  baked: string;
}

function createBlit(): SliceBlit {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const uniforms: SliceBlit["uniforms"] = {
    map: { value: null },
    resolution: { value: new THREE.Vector2() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BLIT_VERTEX,
    fragmentShader: BLIT_FRAGMENT,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, uniforms, texture: null, key: "", baked: "" };
}

function placeBlit(blit: SliceBlit, polygon: readonly Point[]): void {
  const position = blit.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  polygon.forEach(([x, y], index) => {
    position.setXYZ(index, x, y, 0);
  });
  position.needsUpdate = true;
}

function snap(value: number): number {
  return Math.round(value / FRAMING_STEP_PX) * FRAMING_STEP_PX;
}

function formKey(age: number | null): string {
  if (age === null) return "loading";
  return age >= DIORAMA_FORM_S ? "formed" : age.toFixed(3);
}

/**
 * Where the open world's focus sits across today's full frame, 0 left to 1 right: the middle of
 * whoever stands on the stage, seen from the camera at rest.
 */
function focusOf(slots: readonly StageSlot[], aspect: number, camera: THREE.PerspectiveCamera) {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const point = new THREE.Vector3();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const slot of slots) {
    const x = point.set(slot.x, AVATAR_HEIGHT / 2, slot.z).project(camera).x;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  return ((min + max) / 2 + 1) / 2;
}

/**
 * Draws the worlds into their slices, on one canvas. Each world renders through its own camera,
 * slid by `frameShift` so the slice shows its part of today's frame, and clipped by scissor to
 * the slice's box. The open world is drawn live every frame, through the post chain when there
 * is one. A closed world is drawn only when its framing or its formation changes, and copied to
 * a texture there; every frame then lays each closed slice back down from its copy as its
 * slanted shape, which also restores the corners the open world's box drew over. So a still
 * menu costs one live world and a few quads, however many maps it shows.
 */
function Compositor({
  views,
  open,
  motion,
  slots,
  post,
}: {
  views: readonly WorldView[];
  open: number;
  motion: RefObject<WorldsMotion>;
  slots: readonly StageSlot[];
  post: RefObject<PostComposer | null>;
}) {
  const gl = useThree((state) => state.gl);
  const overlay = useMemo(() => {
    const scene = new THREE.Scene();
    const blits = views.map(() => createBlit());
    for (const blit of blits) scene.add(blit.mesh);
    return { scene, blits, camera: new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1) };
  }, [views]);
  const focusCamera = useMemo(() => {
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(...CAMERA_BASE);
    camera.lookAt(CAMERA_LOOK_AT);
    return camera;
  }, []);
  const frame = useRef<WorldsLayout | null>(null);
  const buffer = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    return () => {
      gl.autoClear = autoClear;
      gl.setScissorTest(false);
    };
  }, [gl]);

  useEffect(
    () => () => {
      for (const blit of overlay.blits) {
        blit.texture?.dispose();
        blit.mesh.geometry.dispose();
        blit.mesh.material.dispose();
      }
    },
    [overlay],
  );

  useFrame(({ size }) => {
    const { width, height } = size;
    const layout = layoutAt(motion.current, performance.now());
    const focus = focusOf(slots, width / height, focusCamera);
    views.forEach((view, index) => {
      const shift = frameShift(layout, index, width, height, focus);
      view.camera.aspect = width / height;
      view.camera.setViewOffset(width, height, -shift, 0, width, height);
    });
    frame.current = layout;
  }, -1);

  useFrame(({ size }) => {
    const layout = frame.current;
    if (layout === null) return;
    const { width, height } = size;
    gl.getDrawingBufferSize(buffer);
    const pendingBake = gl.shadowMap.needsUpdate;
    gl.setRenderTarget(null);
    gl.setScissorTest(true);

    views.forEach((view, index) => {
      const blit = overlay.blits[index];
      if (blit === undefined) return;
      const shape = sliceShape(layout, index, width, height);
      blit.mesh.visible = index !== open && shape.right > shape.left;
      if (!blit.mesh.visible) return;
      if (
        blit.texture === null ||
        blit.texture.image.width !== buffer.x ||
        blit.texture.image.height !== buffer.y
      ) {
        blit.texture?.dispose();
        blit.texture = new THREE.FramebufferTexture(buffer.x, buffer.y);
        blit.uniforms.map.value = blit.texture;
        blit.key = "";
      }
      blit.uniforms.resolution.value.copy(buffer);
      placeBlit(blit, shape.polygon);
      const form = formKey(view.age.current);
      const key = [
        buffer.x,
        buffer.y,
        snap(shape.left),
        snap(shape.right),
        snap(view.camera.view?.offsetX ?? 0),
        form,
      ].join(":");
      if (key === blit.key) return;
      gl.setScissor(shape.left, 0, shape.right - shape.left, height);
      gl.shadowMap.needsUpdate = form !== blit.baked;
      gl.clear();
      gl.render(view.scene, view.camera);
      gl.copyFramebufferToTexture(blit.texture);
      blit.key = key;
      blit.baked = form;
    });
    gl.shadowMap.needsUpdate = pendingBake;

    const live = views[open];
    if (live !== undefined) {
      const shape = sliceShape(layout, open, width, height);
      gl.setScissor(shape.left, 0, shape.right - shape.left, height);
      const composer = post.current;
      if (composer) {
        composer.render();
      } else {
        gl.clear();
        gl.render(live.scene, live.camera);
      }
    }

    gl.setScissorTest(false);
    const camera = overlay.camera;
    if (camera.right !== width || camera.bottom !== height) {
      camera.right = width;
      camera.bottom = height;
      camera.updateProjectionMatrix();
    }
    gl.render(overlay.scene, camera);
  }, 1);

  return null;
}

/** Everything inside the canvas, where the canvas's own pointer can be read. */
function Worlds({
  views,
  openIndex,
  motion,
  post,
  ...world
}: Omit<WorldProps, "view" | "open" | "pointer"> & {
  views: readonly WorldView[];
  openIndex: number;
  motion: RefObject<WorldsMotion>;
}) {
  const pointer = useThree((state) => state.pointer);
  return (
    <>
      <Compositor views={views} open={openIndex} motion={motion} slots={world.slots} post={post} />
      {views.map((view, index) => (
        <World
          key={view.map}
          view={view}
          open={index === openIndex}
          pointer={pointer}
          post={post}
          {...world}
        />
      ))}
    </>
  );
}

export function LobbyStage({
  open,
  motion,
  night,
  actors,
  inParty,
  picking,
  chipHost,
  onCustomize,
}: {
  open: MapId;
  motion: RefObject<WorldsMotion>;
  night: boolean;
  actors: StageActor[];
  inParty: boolean;
  picking: boolean;
  chipHost: HTMLElement | null;
  onCustomize: () => void;
}) {
  const reduced = useReducedMotion();
  /**
   * The chip is the only part of the stage a player operates, so it is portalled into a host
   * outside the canvas: everything under `.menu-canvas` is `aria-hidden`, and a focusable button
   * buried in a hidden subtree is reachable by Tab but invisible to a screen reader.
   */
  const chipPortal = useMemo(() => (chipHost === null ? null : { current: chipHost }), [chipHost]);
  const views = useMemo(() => WORLD_IDS.map(createWorldView), []);
  const post = useRef<PostComposer | null>(null);
  const openIndex = Math.max(0, WORLD_IDS.indexOf(open));
  const slots = computeStageSlots(actors.length, inParty);
  const signature = `${inParty}:${actors.map((a) => `${a.id}:${a.avatar}`).join("|")}`;
  const boosted = useMotionBoost(`${picking}:${open}:${signature}`);
  /**
   * Whether the avatar has walked into the open world from another, rather than stood in it since
   * the menu loaded. Set in the render that changes `open`, so the cast mounting in the new world
   * that render reads it, and kept from then on: every later arrival morphs in as well.
   */
  const [arrival, setArrival] = useState({ open, entering: false });
  if (arrival.open !== open) setArrival({ open, entering: true });
  const entering = arrival.entering || arrival.open !== open;

  return (
    <div className="menu-canvas" aria-hidden="true">
      <Canvas shadows={SHADOW_TYPE} frameloop="demand" dpr={STAGE_DPR}>
        <FrameLimiter fps={boosted ? STAGE_BOOST_FPS : STAGE_MAX_FPS} />
        <Worlds
          views={views}
          openIndex={openIndex}
          motion={motion}
          post={post}
          night={night}
          reduced={reduced}
          signature={signature}
          actors={actors}
          slots={slots}
          picking={picking}
          entering={entering}
          chipPortal={chipPortal}
          onCustomize={onCustomize}
        />
      </Canvas>
    </div>
  );
}
