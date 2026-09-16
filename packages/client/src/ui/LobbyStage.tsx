import type { AvatarId, MapId } from "@morphy/shared";
import { Billboard, Html, Sky, Stars, Text, useAnimations, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { playUiHover } from "../game/audio";
import { MAP_THEME_BASE } from "../theme";
import { LOBBY_DIORAMAS, type SetPiece } from "./lobbyDioramas";
import { STAGE_MAX_ACTORS, type StageActor } from "./stageActors";

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
const STAGE_DPR: [number, number] = [1, 1.25];
const CAMERA_LOOK_AT = new THREE.Vector3(0, 1.05, 0);
const PARALLAX_X = 0.55;
const PARALLAX_Y = 0.25;
const PARALLAX_DAMP = 3.2;

const ATMOSPHERE_LERP = 2.4;
const GROUND_RADIUS = 70;
const SUN_POSITION: [number, number, number] = [14, 26, 10];
const SHADOW_MAP_SIZE = 1024;
const SHADOW_EXTENT = 18;

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
  sky: "stars" | "day" | "haze";
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
  mars: {
    background: MAP_THEME_BASE.mars.background,
    fog: "#c2906c",
    fogNear: 10,
    fogFar: 42,
    ground: MAP_THEME_BASE.mars.ground,
    hemiSky: MAP_THEME_BASE.mars.hemiSky,
    hemiGround: MAP_THEME_BASE.mars.hemiGround,
    hemiIntensity: 1.25,
    ambient: 0.95,
    dir: MAP_THEME_BASE.mars.directional,
    sky: "haze",
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

function AvatarActor({
  avatar,
  slot,
  onSelect,
}: {
  avatar: AvatarId;
  slot: StageSlot;
  onSelect?: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(avatarModel(avatar));
  const object = useMemo(() => scene.clone(true), [scene]);
  const { actions, mixer } = useAnimations(animations, group);

  useEffect(() => {
    if (!onSelect) return;
    return () => {
      document.body.style.cursor = "";
    };
  }, [onSelect]);

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = AVATAR_HEIGHT / Math.max(size.y, MODEL_MIN_SIZE);
    return {
      scale,
      offset: [-center.x * scale, -box.min.y * scale, -center.z * scale] as const,
    };
  }, [object]);

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
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f scene-graph node, not a DOM element — keyboard path is the Identity tab
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
      <group ref={group} position={[fit.offset[0], fit.offset[1], fit.offset[2]]} scale={fit.scale}>
        <primitive object={object} />
      </group>
    </group>
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

function SetPieceModel({ piece }: { piece: SetPiece }) {
  const { scene } = useGLTF(piece.url);
  const object = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);
  return (
    <group position={piece.position} rotation-y={piece.rotationY ?? 0} scale={piece.scale ?? 1}>
      <primitive object={object} />
    </group>
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

function StaticShadows() {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);

  return null;
}

/** Re-renders the frozen shadow map when the suspense boundary it sits in resolves with new content. */
function ShadowKick({ signal }: { signal: string }) {
  const gl = useThree((state) => state.gl);

  // biome-ignore lint/correctness/useExhaustiveDependencies: signal is a trigger, not read in the body — new suspense content must repaint the frozen shadow map.
  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, signal]);

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

function ParallaxRig() {
  const camera = useThree((state) => state.camera);
  useFrame((state, delta) => {
    const k = 1 - Math.exp(-PARALLAX_DAMP * delta);
    camera.position.x += (CAMERA_BASE[0] + state.pointer.x * PARALLAX_X - camera.position.x) * k;
    camera.position.y += (CAMERA_BASE[1] + state.pointer.y * PARALLAX_Y - camera.position.y) * k;
    camera.lookAt(CAMERA_LOOK_AT);
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
  onCustomize,
}: {
  map: MapId;
  actors: StageActor[];
  inParty: boolean;
  onCustomize: () => void;
}) {
  const theme = STAGE_THEMES[map];
  const slots = computeStageSlots(actors.length, inParty);
  const selfSlot = slots[0] ?? SOLO_SLOT;
  return (
    <div className="menu-canvas" aria-hidden="true">
      <Canvas
        shadows
        frameloop="demand"
        dpr={STAGE_DPR}
        camera={{ fov: CAMERA_FOV, position: CAMERA_BASE }}
      >
        <FrameLimiter fps={STAGE_MAX_FPS} />
        <Atmosphere theme={theme} />
        <ParallaxRig />
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
        />
        <Ground theme={theme} />
        <StaticShadows />
        <Suspense fallback={null}>
          {LOBBY_DIORAMAS[map].map((piece) => (
            <SetPieceModel key={`${piece.url}:${piece.position.join(",")}`} piece={piece} />
          ))}
          <ShadowKick signal={`diorama:${map}`} />
        </Suspense>
        <Suspense fallback={null}>
          {actors.map((actor, index) => (
            <AvatarActor
              key={`${actor.id}:${actor.avatar}`}
              avatar={actor.avatar}
              slot={slots[index] ?? SOLO_SLOT}
              onSelect={index === 0 ? onCustomize : undefined}
            />
          ))}
          <ShadowKick
            signal={`actors:${map}:${inParty}:${actors.map((a) => `${a.id}:${a.avatar}`).join("|")}`}
          />
        </Suspense>
        {actors.map((actor, index) =>
          index > 0 ? (
            <ActorNameplate
              key={actor.id}
              label={`${actor.isHost ? "★ " : ""}${actor.name}`}
              slot={slots[index] ?? SOLO_SLOT}
            />
          ) : null,
        )}
        <Html
          position={[selfSlot.x, CHIP_Y, selfSlot.z]}
          center
          zIndexRange={[CHIP_Z_INDEX, CHIP_Z_INDEX]}
          wrapperClass="stage-chip"
        >
          <button type="button" tabIndex={-1} onClick={onCustomize} onPointerEnter={playUiHover}>
            <span className="stage-chip-name">
              {actors[0]?.isHost ? "★ " : ""}
              {actors[0]?.name ?? ""}
            </span>
            <span className="stage-chip-pencil" aria-hidden="true">
              ✎
            </span>
          </button>
        </Html>
      </Canvas>
    </div>
  );
}
