import { Billboard, Sky, Stars, Text, useAnimations, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { AvatarId, MapId } from "@webhunt/shared";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const avatarModel = (id: AvatarId): string => `/models/pets/animal-${id}.glb`;

const AVATAR_HEIGHT = 1.5;
const AVATAR_X = -1.35;
const AVATAR_YAW = 0.35;
const MODEL_MIN_SIZE = 0.001;
const CLIP_FADE_SECONDS = 0.3;

const SQUAD_MAX = 3;
const STAGE_FRONT_X = -0.7;
const STAGE_FRONT_Z = 0.35;
const STAGE_STEP_X = 1.2;
const STAGE_STEP_Z = 0.8;
const STAGE_YAW = 0.15;

export const STAGE_MAX_ACTORS = 1 + SQUAD_MAX;

const NAMEPLATE_Y = AVATAR_HEIGHT + 0.42;
const NAMEPLATE_FONT_SIZE = 0.14;
const NAMEPLATE_COLOR = "#eef4ff";
const NAMEPLATE_OUTLINE_COLOR = "#11161f";
const NAMEPLATE_OUTLINE_WIDTH = 0.015;

export interface StageActor {
  id: string;
  name: string;
  avatar: AvatarId;
  isHost: boolean;
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
    hemiSky: "#b8c8de",
    hemiGround: "#42474f",
    hemiIntensity: 0.9,
    ambient: 0.55,
    dir: 1.15,
    sky: "stars",
  },
  mars: {
    background: "#c89a78",
    fog: "#c2906c",
    fogNear: 10,
    fogFar: 42,
    ground: "#9c5a40",
    hemiSky: "#e8b48f",
    hemiGround: "#5a3a2c",
    hemiIntensity: 1.25,
    ambient: 0.95,
    dir: 1.5,
    sky: "haze",
  },
  urban: {
    background: "#acc6e0",
    fog: "#b9cede",
    fogNear: 16,
    fogFar: 60,
    ground: "#6b7078",
    hemiSky: "#d4e3f6",
    hemiGround: "#6a6f78",
    hemiIntensity: 1.0,
    ambient: 0.7,
    dir: 1.45,
    sky: "day",
  },
};

interface SetPiece {
  url: string;
  position: [number, number, number];
  rotationY?: number;
  scale?: number;
}

const mod = (name: string): string => `/models/space/modular/${name}.glb`;
const sta = (name: string): string => `/models/space/station/${name}.glb`;
const ext = (name: string): string => `/models/space/exterior/${name}.glb`;
const urb = (name: string): string => `/models/urban/${name}.glb`;

const DIORAMAS: Record<MapId, SetPiece[]> = {
  station: [
    { url: mod("gate-door-window"), position: [0, 0, -11] },
    { url: mod("template-wall"), position: [-4, 0, -11] },
    { url: mod("template-wall"), position: [4, 0, -11] },
    { url: mod("template-wall-top"), position: [-8, 0, -11] },
    { url: mod("template-wall-top"), position: [8, 0, -11] },
    { url: mod("template-wall"), position: [-12, 0, -11] },
    { url: mod("template-wall"), position: [12, 0, -11] },
    { url: mod("template-wall"), position: [-16, 0, -11] },
    { url: mod("template-wall"), position: [16, 0, -11] },
    { url: mod("template-detail"), position: [-10, 0, -8] },
    { url: mod("template-detail"), position: [10, 0, -8] },
    { url: mod("cables"), position: [-6.5, 0, -9.8] },
    { url: mod("cables"), position: [5.5, 0, -9.9], rotationY: 1.6 },
    { url: sta("container-tall"), position: [-3.4, 0, -5.2], rotationY: 0.4, scale: 2.4 },
    { url: sta("container-wide"), position: [-4.6, 0, -6.4], rotationY: -0.2, scale: 2.4 },
    { url: sta("container"), position: [-2.5, 0, -6.8], rotationY: 0.9, scale: 2.4 },
    { url: sta("skip"), position: [-6.2, 0, -4.8], rotationY: 0.7, scale: 2.4 },
    { url: sta("computer-wide"), position: [3.6, 0, -6], rotationY: -0.55, scale: 2.6 },
    { url: sta("chair"), position: [4.8, 0, -5], rotationY: -2.4, scale: 2.6 },
    { url: sta("table-display-planet"), position: [7.6, 0, -9.4], rotationY: -0.8, scale: 3.2 },
  ],
  mars: [
    { url: ext("hangar_smallA"), position: [8.5, 0, -17], rotationY: -0.5, scale: 3.5 },
    { url: ext("hangar_smallB"), position: [-8, 0, -20], rotationY: 0.4, scale: 3.5 },
    { url: ext("satelliteDish_large"), position: [-3.5, 0, -13], rotationY: -0.3, scale: 2 },
    { url: ext("machine_generatorLarge"), position: [4, 0, -8.5], rotationY: 0.3, scale: 2 },
    { url: ext("craft_speederA"), position: [-5, 0, -6.5], rotationY: 0.9, scale: 1.8 },
    { url: ext("craterLarge"), position: [-5.5, 0, -3], rotationY: 0.5, scale: 3.5 },
    { url: ext("crater"), position: [3, 0, -4], rotationY: 1.8, scale: 3 },
    { url: ext("rocks_smallA"), position: [-3.5, 0, -3.2], rotationY: 0.7, scale: 2.5 },
    { url: ext("rock_largeA"), position: [5.5, 0, -5.5], rotationY: 1.2, scale: 2.5 },
    { url: ext("meteor"), position: [1, 0, -9], rotationY: 2.1, scale: 1.5 },
    { url: ext("rocket_baseA"), position: [3.7, 0, -18.1], scale: 2.4 },
    { url: ext("rocket_sidesA"), position: [3.7, 3.84, -18.1], scale: 2.4 },
    { url: ext("rocket_topA"), position: [3.7, 6.24, -18.1], scale: 2.4 },
    { url: ext("rocket_fuelA"), position: [6.7, 0, -15.6], scale: 2.4 },
    { url: ext("astronautA"), position: [-6.7, 0, -7.6], scale: 1.6 },
    { url: ext("rover"), position: [1.5, 0, -10], scale: 2 },
    { url: ext("machine_wireless"), position: [-12.9, 0, -11.3], scale: 2.2 },
    { url: ext("barrels"), position: [-10.2, 0, -10.1], scale: 2.2 },
    { url: ext("rock_crystalsLargeA"), position: [-9.5, 0, -7.5], scale: 2 },
  ],
  urban: [
    { url: urb("roads/road-straight"), position: [-8, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [-4, -0.05, -1], scale: 4 },
    { url: urb("roads/road-crossing"), position: [0, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [4, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [8, -0.05, -1], scale: 4 },
    { url: urb("commercial/building-g"), position: [-11.1, 0, -10.3], scale: 6 },
    { url: urb("commercial/building-a"), position: [-5.5, 0, -10], scale: 6 },
    { url: urb("commercial/building-d"), position: [-0.4, 0, -10.2], scale: 6 },
    { url: urb("commercial/building-skyscraper-a"), position: [6.2, 0, -10], scale: 6 },
    { url: urb("commercial/building-h"), position: [12.9, 0, -10.3], scale: 6 },
    { url: urb("roads/light-curved"), position: [-8, 0, -4.2], rotationY: Math.PI, scale: 6 },
    { url: urb("roads/light-curved"), position: [6, 0, -4.2], rotationY: Math.PI, scale: 6 },
    { url: urb("tree-large"), position: [-11.5, 0, -4.6], scale: 6 },
    { url: urb("tree-small"), position: [10.5, 0, -4.6], rotationY: 0.8, scale: 6 },
    { url: urb("planter"), position: [2.5, 0, -4.4], rotationY: -0.2, scale: 6 },
    { url: urb("roads/construction-cone"), position: [-4.6, 0, -2.2], scale: 6 },
    { url: urb("roads/construction-cone"), position: [-5.3, 0, -2.7], scale: 6 },
  ],
};

for (const pieces of Object.values(DIORAMAS)) {
  for (const piece of pieces) {
    useGLTF.preload(piece.url);
  }
}

function AvatarActor({ avatar, slot }: { avatar: AvatarId; slot: StageSlot }) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(avatarModel(avatar));
  const object = useMemo(() => scene.clone(true), [scene]);
  const { actions, mixer } = useAnimations(animations, group);

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
    <group position={[slot.x, 0, slot.z]} rotation-y={slot.yaw}>
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
}: { map: MapId; actors: StageActor[]; inParty: boolean }) {
  const theme = STAGE_THEMES[map];
  const slots = computeStageSlots(actors.length, inParty);
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
        <Suspense fallback={null}>
          {DIORAMAS[map].map((piece) => (
            <SetPieceModel key={`${piece.url}:${piece.position.join(",")}`} piece={piece} />
          ))}
          <StaticShadows key={map} />
        </Suspense>
        <Suspense fallback={null}>
          {actors.map((actor, index) => (
            <AvatarActor
              key={`${actor.id}:${actor.avatar}`}
              avatar={actor.avatar}
              slot={slots[index] ?? SOLO_SLOT}
            />
          ))}
        </Suspense>
        {actors.map((actor, index) =>
          !inParty || index > 0 ? (
            <ActorNameplate
              key={actor.id}
              label={`${actor.isHost ? "★ " : ""}${actor.name}`}
              slot={slots[index] ?? SOLO_SLOT}
            />
          ) : null,
        )}
      </Canvas>
    </div>
  );
}
