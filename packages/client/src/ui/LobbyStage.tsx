import { Sky, Stars, useAnimations, useGLTF } from "@react-three/drei";
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

const CAMERA_FOV = 38;
const CAMERA_BASE: [number, number, number] = [0, 1.5, 6];
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
    { url: mod("gate"), position: [0, 0, -11] },
    { url: mod("corridor"), position: [-6.2, 0, -12] },
    { url: mod("corridor"), position: [6.2, 0, -12] },
    { url: mod("template-wall"), position: [-10.2, 0, -11.6] },
    { url: mod("template-wall"), position: [10.2, 0, -11.6] },
    { url: sta("container-tall"), position: [-3.4, 0, -5.2], rotationY: 0.4, scale: 2.4 },
    { url: sta("container-wide"), position: [-4.6, 0, -6.4], rotationY: -0.2, scale: 2.4 },
    { url: sta("computer-wide"), position: [3.6, 0, -6], rotationY: -0.55, scale: 2.6 },
    { url: sta("chair"), position: [4.8, 0, -5], rotationY: -2.4, scale: 2.6 },
  ],
  mars: [
    { url: ext("hangar_smallA"), position: [7.5, 0, -13], rotationY: -0.5, scale: 3.5 },
    { url: ext("hangar_smallB"), position: [-8, 0, -15], rotationY: 0.4, scale: 3.5 },
    { url: ext("satelliteDish_large"), position: [-3.5, 0, -13], rotationY: -0.3, scale: 2 },
    { url: ext("machine_generatorLarge"), position: [4, 0, -8.5], rotationY: 0.3, scale: 2 },
    { url: ext("craft_speederA"), position: [-5, 0, -6.5], rotationY: 0.9, scale: 1.8 },
    { url: ext("craterLarge"), position: [-5.5, 0, -3], rotationY: 0.5, scale: 3.5 },
    { url: ext("crater"), position: [3, 0, -4], rotationY: 1.8, scale: 3 },
    { url: ext("rocks_smallA"), position: [-3.5, 0, -3.2], rotationY: 0.7, scale: 2.5 },
    { url: ext("rock_largeA"), position: [5.5, 0, -5.5], rotationY: 1.2, scale: 2.5 },
    { url: ext("meteor"), position: [1, 0, -9], rotationY: 2.1, scale: 1.5 },
  ],
  urban: [
    { url: urb("roads/road-straight"), position: [-8, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [-4, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [0, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [4, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [8, -0.05, -1], scale: 4 },
    { url: urb("commercial/building-a"), position: [-6.5, 0, -9.5], scale: 6 },
    { url: urb("commercial/building-d"), position: [0, 0, -10], rotationY: 0.1, scale: 6 },
    { url: urb("commercial/building-skyscraper-a"), position: [7, 0, -11], scale: 6 },
  ],
};

for (const pieces of Object.values(DIORAMAS)) {
  for (const piece of pieces) {
    useGLTF.preload(piece.url);
  }
}

function AvatarActor({ avatar }: { avatar: AvatarId }) {
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
    <group position={[AVATAR_X, 0, 0]} rotation-y={AVATAR_YAW}>
      <group ref={group} position={[fit.offset[0], fit.offset[1], fit.offset[2]]} scale={fit.scale}>
        <primitive object={object} />
      </group>
    </group>
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

export function LobbyStage({ map, avatar }: { map: MapId; avatar: AvatarId }) {
  const theme = STAGE_THEMES[map];
  return (
    <div className="menu-canvas" aria-hidden="true">
      <Canvas shadows dpr={[1, 2]} camera={{ fov: CAMERA_FOV, position: CAMERA_BASE }}>
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
        </Suspense>
        <Suspense fallback={null}>
          <AvatarActor key={avatar} avatar={avatar} />
        </Suspense>
      </Canvas>
    </div>
  );
}
