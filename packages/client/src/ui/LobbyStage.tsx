import type { AvatarId, MapId } from "@morphy/shared";
import { Billboard, Html, Sky, Stars, Text, useAnimations, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { playUiHover } from "../game/audio";
import { enableShadows } from "../game/modelShading";
import { useSharedGLTF } from "../game/sharedTextures";
import { MAP_THEME_BASE, MORPH_COLOR } from "../theme";
import { avatarNeighbors, mapNeighbors } from "./carousel";
import {
  beginTransition,
  DIORAMA_TRANSITION_S,
  type DioramaTransition,
  isVeiled,
  liveMaps,
  pieceScale,
  ready,
  retarget,
  sameStageRender,
  stageMap,
  tick,
  veilOpacity,
} from "./dioramaTransition";
import { LOBBY_DIORAMAS, type SetPiece } from "./lobbyDioramas";
import { type PickerId, STAGE_MAX_ACTORS, type StageActor } from "./stageActors";

const avatarModel = (id: AvatarId): string => `/models/pets/animal-${id}.glb`;

const AVATAR_HEIGHT = 1.5;
const AVATAR_X = -1.35;
const AVATAR_YAW = 0.35;
const MODEL_MIN_SIZE = 0.001;
const CLIP_FADE_SECONDS = 0.3;

const STAGE_FRONT_X = -0.7;
const STAGE_FRONT_Z = 0.35;
const STAGE_STEP_X = 1.2;
const STAGE_STEP_Z = 0.8;
const STAGE_YAW = 0.15;

const NAMEPLATE_Y = AVATAR_HEIGHT + 0.42;
const NAMEPLATE_FONT_SIZE = 0.14;
const NAMEPLATE_COLOR = "#eef4ff";
const NAMEPLATE_OUTLINE_COLOR = "#11161f";
const NAMEPLATE_OUTLINE_WIDTH = 0.015;

const CHIP_Y = AVATAR_HEIGHT + 0.12;
const CHIP_Z_INDEX = 2;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const MORPH_CAMERA_Y = 1.2;
const MORPH_CAMERA_Z = 3.3;
const MORPH_LOOK_Y = 0.92;
const MORPH_DOLLY_DAMP = 4.2;

const WORLD_CAMERA: [number, number, number] = [0, 5, 13];
const WORLD_LOOK_AT: [number, number, number] = [0, 1.4, -7];
const WORLD_BURST_SLOT: StageSlot = { x: 0, z: -6, yaw: 0 };
const WORLD_BURST_SCALE = 6;
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
 * The one budget the world swap is spent from. The stage runs at `STAGE_BOOST_FPS` and keeps its
 * shadow map live for exactly as long as a cross takes, so both are derived from the fold that
 * owns the timeline rather than tuned next to it, where they used to drift.
 */
const DIORAMA_SETTLE_MS = DIORAMA_TRANSITION_S * 1000;
const UNSCALED = 1;

const VEIL_RADIUS = 80;
const VEIL_SEGMENTS_W = 24;
const VEIL_SEGMENTS_H = 16;
const VEIL_RENDER_ORDER = 1;

/**
 * True for `STAGE_BOOST_MS` after every change of `beat`. The stage idles at 30 fps, which is
 * plenty for a parallax drift but coarse for the morph dolly and the pop that follows a step,
 * so those get `STAGE_BOOST_FPS` for as long as they are actually running and no longer.
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

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_MOTION_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
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
const CAMERA_BASE: [number, number, number] = [0, 1.5, 6];
const STAGE_MAX_FPS = 30;
const STAGE_BOOST_FPS = 60;
const STAGE_BOOST_MS = DIORAMA_SETTLE_MS;
const STAGE_DPR: [number, number] = [1, 1.25];
const CAMERA_LOOK_AT = new THREE.Vector3(0, 1.05, 0);
const PARALLAX_X = 0.55;
const PARALLAX_Y = 0.25;
const PARALLAX_DAMP = 3.2;

const ATMOSPHERE_LERP = 2.4;
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
  sky: "stars" | "day";
}

const STAGE_THEMES: Record<MapId, StageTheme> = {
  station: {
    background: "#05080f",
    fog: "#0a101c",
    fogNear: 14,
    fogFar: 46,
    ground: "#39404d",
    hemiSky: MAP_THEME_BASE.station.hemiSky,
    hemiGround: MAP_THEME_BASE.station.hemiGround,
    hemiIntensity: 0.9,
    ambient: 0.55,
    dir: MAP_THEME_BASE.station.directional,
    sky: "stars",
  },
  urban: {
    background: MAP_THEME_BASE.urban.background,
    fog: "#b9cede",
    fogNear: 16,
    fogFar: 60,
    ground: "#6b7078",
    hemiSky: MAP_THEME_BASE.urban.hemiSky,
    hemiGround: MAP_THEME_BASE.urban.hemiGround,
    hemiIntensity: 1.0,
    ambient: 0.7,
    dir: MAP_THEME_BASE.urban.directional,
    sky: "day",
  },
};

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
 * stage slot, replayed whenever `signal` changes. Deliberately not the scene's pooled
 * MorphEffects: only one thing ever morphs here at a time, and this has to keep playing
 * outside the model's suspense boundary so a cold GLB loads under cover of the beam.
 *
 * `scale` sizes the whole effect: the avatar carousel bursts around one pet, the world
 * carousel around a whole diorama, off the same geometry.
 */
function MorphBurst({
  signal,
  slot,
  scale = UNSCALED,
}: {
  signal: string;
  slot: StageSlot;
  scale?: number;
}) {
  const beam = useRef<THREE.Mesh>(null);
  const shards = useRef<THREE.InstancedMesh>(null);
  const age = useRef(POP_SETTLED);
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
      const height = AVATAR_HEIGHT * MORPH_BEAM_HEIGHT_MULT * growth * scale;
      const radius = MORPH_BEAM_RADIUS * scale;
      beamMesh.position.set(slot.x, height / 2, slot.z);
      beamMesh.scale.set(radius, Math.max(height, MODEL_MIN_SIZE), radius);
      (beamMesh.material as THREE.MeshBasicMaterial).opacity = MORPH_BEAM_OPACITY * (1 - beamT);
      beamMesh.visible = true;
    } else {
      beamMesh.visible = false;
    }

    const t = Math.min(1, elapsed / MORPH_DURATION_S);
    const convergence = t * t;
    const radial = MORPH_SHARD_SPAWN_RADIUS * scale * (1 - convergence);
    const size = Math.max(MORPH_SHARD_SIZE * scale * (1 - t), MODEL_MIN_SIZE);
    const spawnHeight = AVATAR_HEIGHT * MORPH_SHARD_SPAWN_HEIGHT_MULT * scale;
    seeds.forEach((seed, i) => {
      scratch.position.set(
        slot.x + Math.cos(seed.angle) * radial,
        THREE.MathUtils.lerp(seed.yFrac * spawnHeight, (AVATAR_HEIGHT * scale) / 2, convergence),
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
 * One diorama set piece. Its scale is not its own business: the transition fold answers where
 * every piece of both the leaving and the arriving world is on its ramp this instant, which is
 * what lets one sweep dissolve while the other forms instead of the two taking turns.
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
  map,
  index,
  count,
  transition,
}: {
  piece: SetPiece;
  map: MapId;
  index: number;
  count: number;
  transition: RefObject<DioramaTransition>;
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
    const node = pop.current;
    if (node === null) return;
    node.scale.setScalar(pieceScale(transition.current, map, index, count));
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
 * The arriving world's own report that it is loaded. A Suspense boundary commits all of its
 * children at once, so an effect on a sibling of the set pieces fires exactly when the last of
 * their models has resolved: no polling, no second loader, nothing added to the `useGLTF` cache.
 */
function DioramaReady({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

/**
 * One whole world, mounted inside its own boundary so an uncached map suspends alone. The world
 * already on stage is in a boundary of its own and keeps rendering throughout, which is what
 * closed the hole a cold map used to leave.
 */
function Diorama({
  map,
  arriving,
  transition,
  onReady,
}: {
  map: MapId;
  arriving: boolean;
  transition: RefObject<DioramaTransition>;
  onReady: () => void;
}) {
  const pieces = LOBBY_DIORAMAS[map];
  return (
    <Suspense fallback={null}>
      {pieces.map((piece, index) => (
        <SetPieceModel
          key={`${piece.url}:${piece.position.join(",")}`}
          piece={piece}
          map={map}
          index={index}
          count={pieces.length}
          transition={transition}
        />
      ))}
      {arriving && <DioramaReady onReady={onReady} />}
    </Suspense>
  );
}

/**
 * Advances the transition clock. Mounted ahead of the dioramas so the pieces read a clock that
 * has already moved this frame, and the only `useFrame` allowed to write the fold.
 */
function DioramaDriver({
  transition,
  onAdvance,
}: {
  transition: RefObject<DioramaTransition>;
  onAdvance: (state: DioramaTransition) => void;
}) {
  useFrame((_, delta) => {
    onAdvance(tick(transition.current, delta));
  });
  return null;
}

/**
 * An inward-facing shell between the ground disc and the stars, which closes over the sky while
 * the theme swaps underneath it and opens again. It sits past every theme's fog far plane, so it
 * draws in pure fog colour, and that is the colour `Atmosphere` is already lerping between
 * themes: opacity is the only value left to animate. It renders after the stars, which blend
 * additively and would otherwise shine straight through it.
 */
function SkyVeil({ transition }: { transition: RefObject<DioramaTransition> }) {
  const material = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const node = material.current;
    if (node === null) return;
    node.opacity = veilOpacity(transition.current);
  });

  return (
    <mesh renderOrder={VEIL_RENDER_ORDER}>
      <sphereGeometry args={[VEIL_RADIUS, VEIL_SEGMENTS_W, VEIL_SEGMENTS_H]} />
      <meshBasicMaterial
        ref={material}
        side={THREE.BackSide}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
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
 * grow-in still has every set piece at ~0 scale, and nothing ever kicks it again, so a map you
 * switched to kept the shadows of nothing. Shadows stay live until `settleMs` after `signal`
 * changes, then freeze with one final bake at full size.
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
  const [background] = useState(() => new THREE.Color(theme.background));
  const [fog] = useState(() => new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar));
  const [target] = useState(() => ({
    background: new THREE.Color(theme.background),
    fog: new THREE.Color(theme.fog),
  }));

  useEffect(() => {
    scene.background = background;
    scene.fog = fog;
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, background, fog]);

  useEffect(() => {
    target.background.set(theme.background);
    target.fog.set(theme.fog);
    fog.near = theme.fogNear;
    fog.far = theme.fogFar;
  }, [theme, target, fog]);

  useFrame((_, delta) => {
    const k = 1 - Math.exp(-ATMOSPHERE_LERP * delta);
    background.lerp(target.background, k);
    fog.color.lerp(target.fog, k);
  });

  return null;
}

/**
 * Drives the stage camera: pointer parallax in the menu, a dolly onto `focus` for the avatar
 * picker, and a pull back and up for the world picker, which frames the diorama the player is
 * choosing rather than the pet standing in front of it.
 *
 * The aim point is damped alongside the position rather than set outright: snapping it the
 * frame a picker opens swings the camera ~13° in one step, which reads as a cut however
 * smoothly the position travels.
 */
function ParallaxRig({ picker, focus }: { picker: PickerId | null; focus: StageSlot }) {
  const camera = useThree((state) => state.camera);
  const reduced = useReducedMotion();
  const scratch = useMemo(() => ({ target: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  const aim = useMemo(() => CAMERA_LOOK_AT.clone(), []);

  useFrame((state, delta) => {
    if (picker === "avatar") {
      scratch.target.set(focus.x, MORPH_CAMERA_Y, focus.z + MORPH_CAMERA_Z);
      scratch.look.set(focus.x, MORPH_LOOK_Y, focus.z);
    } else if (picker === "world") {
      scratch.target.set(...WORLD_CAMERA);
      scratch.look.set(...WORLD_LOOK_AT);
    } else {
      scratch.target.set(
        CAMERA_BASE[0] + state.pointer.x * PARALLAX_X,
        CAMERA_BASE[1] + state.pointer.y * PARALLAX_Y,
        CAMERA_BASE[2],
      );
      scratch.look.copy(CAMERA_LOOK_AT);
    }
    const damp = picker === null ? PARALLAX_DAMP : MORPH_DOLLY_DAMP;
    const k = reduced ? 1 : 1 - Math.exp(-damp * delta);
    camera.position.lerp(scratch.target, k);
    aim.lerp(scratch.look, k);
    camera.lookAt(aim);
  });
  return null;
}

function Ground({ theme }: { theme: StageTheme }) {
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const [target] = useState(() => new THREE.Color(theme.ground));
  useEffect(() => {
    target.set(theme.ground);
  }, [theme, target]);
  useFrame((_, delta) => {
    const k = 1 - Math.exp(-ATMOSPHERE_LERP * delta);
    material.current?.color.lerp(target, k);
  });
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <circleGeometry args={[GROUND_RADIUS, 48]} />
      <meshStandardMaterial ref={material} color={theme.ground} />
    </mesh>
  );
}

export function LobbyStage({
  map,
  actors,
  inParty,
  picker,
  chipHost,
  onCustomize,
}: {
  map: MapId;
  actors: StageActor[];
  inParty: boolean;
  picker: PickerId | null;
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
  const [stage, setStage] = useState<DioramaTransition>(() => beginTransition(map));
  const transition = useRef(stage);
  const theme = STAGE_THEMES[stageMap(stage)];
  const slots = computeStageSlots(actors.length, inParty);
  const selfSlot = slots[0] ?? SOLO_SLOT;
  const self = actors[0];
  const neighbors = self ? avatarNeighbors(self.avatar) : null;
  const inWorldPicker = picker === "world";
  const animateMorph = picker === "avatar" && !reduced;
  const animateWorld = inWorldPicker && !reduced;
  const stageSignature = `${map}:${inParty}:${actors.map((a) => `${a.id}:${a.avatar}`).join("|")}`;
  const boosted = useMotionBoost(`${picker}:${stageSignature}:${stage.bake}`);

  const apply = useCallback((next: DioramaTransition) => {
    const previous = transition.current;
    if (next === previous) return;
    transition.current = next;
    if (!sameStageRender(previous, next)) setStage(next);
  }, []);
  const handleReady = useCallback(
    () => apply(ready(transition.current, reduced)),
    [apply, reduced],
  );

  useEffect(() => {
    apply(retarget(transition.current, map));
  }, [apply, map]);

  useEffect(() => {
    if (!inWorldPicker) return;
    const { prev, next } = mapNeighbors(map);
    for (const id of [prev, next]) {
      for (const piece of LOBBY_DIORAMAS[id]) useGLTF.preload(piece.url);
    }
  }, [inWorldPicker, map]);
  return (
    <div className="menu-canvas" aria-hidden="true">
      <Canvas
        shadows={SHADOW_TYPE}
        frameloop="demand"
        dpr={STAGE_DPR}
        camera={{ fov: CAMERA_FOV, position: CAMERA_BASE }}
      >
        <FrameLimiter fps={boosted ? STAGE_BOOST_FPS : STAGE_MAX_FPS} />
        <Atmosphere theme={theme} />
        <ParallaxRig picker={picker} focus={selfSlot} />
        {theme.sky === "stars" && (
          <Stars radius={90} depth={40} count={1600} factor={3} fade speed={0.4} />
        )}
        {theme.sky === "day" && <Sky sunPosition={SUN_POSITION} turbidity={4} rayleigh={1.4} />}
        <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
        <ambientLight intensity={theme.ambient} />
        <directionalLight
          position={SUN_POSITION}
          intensity={theme.dir}
          castShadow
          shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
          shadow-camera-left={-SHADOW_EXTENT}
          shadow-camera-right={SHADOW_EXTENT}
          shadow-camera-top={SHADOW_EXTENT}
          shadow-camera-bottom={-SHADOW_EXTENT}
          shadow-normalBias={SHADOW_NORMAL_BIAS}
        />
        <Ground theme={theme} />
        <ShadowStage signal={`${stageSignature}:${stage.bake}`} settleMs={DIORAMA_SETTLE_MS} />
        <DioramaDriver transition={transition} onAdvance={apply} />
        {liveMaps(stage).map((id) => (
          <Diorama
            key={`diorama:${id}`}
            map={id}
            arriving={id === stage.next}
            transition={transition}
            onReady={handleReady}
          />
        ))}
        {isVeiled(stage) && <SkyVeil transition={transition} />}
        <Suspense fallback={null}>
          {actors.map((actor, index) => (
            <AvatarActor
              key={`${actor.id}:${actor.avatar}`}
              avatar={actor.avatar}
              slot={slots[index] ?? SOLO_SLOT}
              onSelect={index === 0 && picker === null ? onCustomize : undefined}
              materialize={index === 0 && animateMorph}
            />
          ))}
        </Suspense>
        {picker === "avatar" && neighbors !== null && (
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
        {animateMorph && self && <MorphBurst signal={self.avatar} slot={selfSlot} />}
        {animateWorld && (
          <MorphBurst
            signal={`world:${stage.bake}`}
            slot={WORLD_BURST_SLOT}
            scale={WORLD_BURST_SCALE}
          />
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
        {picker === null && chipPortal !== null && (
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
                {actors[0]?.isHost ? "★ " : ""}
                {actors[0]?.name ?? ""}
              </span>
              <span className="stage-chip-pencil" aria-hidden="true">
                ✎
              </span>
            </button>
          </Html>
        )}
      </Canvas>
    </div>
  );
}
