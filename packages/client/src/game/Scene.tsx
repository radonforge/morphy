import type { Room } from "@colyseus/sdk";
import { Sky, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  computePropBounds,
  GRAVITY,
  INPUT_SEND_RATE_MS,
  JUMP_SPEED,
  type MapDefinition,
  MOVE_SPEED,
  MSG_INPUT,
  MSG_SHOOT,
  MSG_TRANSFORM,
  type Phase,
  type PrimitiveSpec,
  type PropDefinition,
  type Role,
  RUN_MULTIPLIER_HUNTER,
  RUN_MULTIPLIER_PROP,
  type SceneryInstance,
  SHOOT_RANGE,
  type TileInstance,
} from "@webhunt/shared";
import { memo, type ReactElement, Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { playShot, playStep } from "./audio";
import type { MetaMap, PlayersRef, RemotePlayerView, TauntPulseRef, TeleportRef } from "./types";
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
const FURNITURE_MIN_RADIUS = 0.3;
const PLAYER_BODY_LENGTH = 0.9;
const PLAYER_BODY_Y = PLAYER_BODY_LENGTH / 2 + PLAYER_RADIUS;
const PLAYER_HEAD_Y = PLAYER_BODY_LENGTH + PLAYER_RADIUS * 1.6;
const HUNTER_COLOR = "#e8564a";
const PROP_COLOR = "#5bd75b";
const GROUND_COLOR = "#9c5a40";
const MODEL_MIN_SIZE = 0.001;
const BASE_PLANE_MARGIN = 8;
const animalModel = (id: string): string => `/models/pets/animal-${id}.glb`;
const BLASTER_MODEL = "/models/blaster/blaster-a.glb";
const WEAPON_SCALE = 0.32;
const WEAPON_OFFSET: [number, number, number] = [0.2, -0.22, -0.6];
const WEAPON_ROTATION: [number, number, number] = [0, Math.PI, 0];

const CAMERA_DISTANCE = 8;
const CAMERA_TARGET_Y = 1.2;
const CAMERA_DAMP = 0.0008;
const CAMERA_WALL_MARGIN = 0.35;
const CAMERA_MIN_DISTANCE = 0.2;
const CAMERA_SLAB_EPSILON = 1e-4;
const REMOTE_DAMP = 0.0009;
export const TAUNT_PULSE_SECONDS = 0.5;
const TAUNT_AMPLITUDE = 0.18;
const TRACER_TTL = 0.09;
const TRACER_COLOR = "#fff34d";
const STEP_DISTANCE = 2.2;
const LOOK_SENSITIVITY = 0.0025;
const PITCH_MIN = -1.4;
const PITCH_MAX = 1.4;
const TP_PITCH_MIN = -0.15;
const TP_PITCH_MAX = 1.2;
const DEFAULT_PITCH = 0.5;
const EYE_HEIGHT = 1.6;
const SUN_POSITION: [number, number, number] = [14, 26, 10];
const UP = new THREE.Vector3(0, 1, 0);
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const LOCAL_AVATAR_KEY = "localAvatar";
const TRANSFORM_REACH = 3.5;

type Catalog = Map<string, PropDefinition>;

interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

function buildObstacles(map: MapDefinition, catalog: Catalog): Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const instance of map.props) {
    const def = catalog.get(instance.type);
    if (!def) continue;
    let radius = 0;
    for (const part of def.parts) {
      const reach =
        Math.hypot(part.position.x, part.position.z) + Math.max(part.size.x, part.size.z) / 2;
      if (reach > radius) radius = reach;
    }
    if (radius >= FURNITURE_MIN_RADIUS) {
      obstacles.push({ x: instance.position.x, z: instance.position.z, radius });
    }
  }
  for (const inst of map.scenery) {
    if (inst.colliderRadius !== undefined && inst.colliderRadius > 0) {
      obstacles.push({ x: inst.position.x, z: inst.position.z, radius: inst.colliderRadius });
    }
  }
  return obstacles;
}

interface Wall {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function buildWalls(map: MapDefinition): Wall[] {
  return map.colliders
    .filter((collider) => collider.position.y > 0)
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
}

type TracerRef = { current: TracerState | null };
type PlayerPosRef = { readonly current: THREE.Vector3 };

interface SceneProps {
  room: Room;
  map: MapDefinition;
  localId: string;
  ids: string[];
  playersRef: PlayersRef;
  meta: MetaMap;
  phase: Phase;
  teleportRef: TeleportRef;
  tauntPulseRef: TauntPulseRef;
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
  teleportRef,
  tauntPulseRef,
  chatOpen,
  onShoot,
}: SceneProps) {
  const catalog = useMemo<Catalog>(
    () => new Map(map.propCatalog.map((def) => [def.id, def])),
    [map],
  );
  const obstacles = useMemo(() => buildObstacles(map, catalog), [map, catalog]);
  const walls = useMemo(() => buildWalls(map), [map]);
  const tracerRef = useRef<TracerState | null>(null);
  const localGroundRef = useRef(new THREE.Vector3());
  const localMeta = meta[localId];
  const localRole: Role = localMeta?.role ?? "prop";
  const localAlive = localMeta?.alive ?? true;
  const canTransform =
    localRole === "prop" && localAlive && !chatOpen && (phase === "hiding" || phase === "hunting");
  const canShoot = localRole === "hunter" && localAlive && !chatOpen && phase === "hunting";

  return (
    <>
      <color attach="background" args={["#adcdec"]} />
      <Sky sunPosition={SUN_POSITION} turbidity={6} rayleigh={1.2} />
      <hemisphereLight args={["#cfe2f7", "#7a6e5c", 1.0]} />
      <ambientLight intensity={0.7} />
      <directionalLight
        position={SUN_POSITION}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={32}
        shadow-camera-bottom={-32}
        shadow-bias={-0.0004}
      />
      <MapView map={map} />
      <PropPicker room={room} enabled={canTransform} playerPos={localGroundRef} />
      <Shooter room={room} enabled={canShoot} tracerRef={tracerRef} onShoot={onShoot} />
      <Tracer tracerRef={tracerRef} />
      <HunterViewmodel enabled={localRole === "hunter" && localAlive} />
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
        obstacles={obstacles}
        walls={walls}
        avatar={localMeta?.avatar ?? ""}
        playerPos={localGroundRef}
      />
      {ids
        .filter((id) => id !== localId && (meta[id]?.alive ?? true))
        .map((id) => (
          <RemotePlayer
            key={id}
            view={playersRef.current.get(id)}
            catalog={catalog}
            role={meta[id]?.role ?? "prop"}
            propType={meta[id]?.propType ?? ""}
            avatar={meta[id]?.avatar ?? ""}
            tauntPulseRef={tauntPulseRef}
          />
        ))}
    </>
  );
}

function Shooter({
  room,
  enabled,
  tracerRef,
  onShoot,
}: {
  room: Room;
  enabled: boolean;
  tracerRef: TracerRef;
  onShoot: () => void;
}) {
  const { camera, gl, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const el = gl.domElement;
    const onClick = () => {
      if (document.pointerLockElement !== el) {
        return;
      }
      raycaster.setFromCamera(SCREEN_CENTER, camera);
      const o = raycaster.ray.origin;
      const d = raycaster.ray.direction;
      room.send(MSG_SHOOT, {
        origin: { x: o.x, y: o.y, z: o.z },
        dir: { x: d.x, y: d.y, z: d.z },
      });
      playShot();
      onShoot();
      const hits = raycaster.intersectObjects(scene.children, true);
      const end = hits[0]?.point;
      tracerRef.current = {
        ox: o.x,
        oy: o.y,
        oz: o.z,
        ex: end ? end.x : o.x + d.x * SHOOT_RANGE,
        ey: end ? end.y : o.y + d.y * SHOOT_RANGE,
        ez: end ? end.z : o.z + d.z * SHOOT_RANGE,
        ttl: TRACER_TTL,
      };
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [enabled, camera, gl, scene, raycaster, room, tracerRef, onShoot]);

  return null;
}

function Tracer({ tracerRef }: { tracerRef: TracerRef }) {
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    return geom;
  }, []);
  const material = useMemo(
    () => new THREE.LineBasicMaterial({ color: TRACER_COLOR, transparent: true }),
    [],
  );
  const line = useMemo(() => {
    const l = new THREE.Line(geometry, material);
    l.visible = false;
    l.frustumCulled = false;
    return l;
  }, [geometry, material]);

  useFrame((_, delta) => {
    const tracer = tracerRef.current;
    if (!tracer) {
      line.visible = false;
      return;
    }
    tracer.ttl -= delta;
    if (tracer.ttl <= 0) {
      tracerRef.current = null;
      line.visible = false;
      return;
    }
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    position.setXYZ(0, tracer.ox, tracer.oy, tracer.oz);
    position.setXYZ(1, tracer.ex, tracer.ey, tracer.ez);
    position.needsUpdate = true;
    material.opacity = tracer.ttl / TRACER_TTL;
    line.visible = true;
  });

  return <primitive object={line} />;
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

function HunterViewmodel({ enabled }: { enabled: boolean }) {
  const camera = useThree((state) => state.camera);
  if (!enabled) {
    return null;
  }
  return (
    <primitive object={camera}>
      <group position={WEAPON_OFFSET} rotation={WEAPON_ROTATION}>
        <Suspense fallback={null}>
          <WeaponModel url={BLASTER_MODEL} scale={WEAPON_SCALE} />
        </Suspense>
      </group>
    </primitive>
  );
}

const MapView = memo(function MapView({ map }: { map: MapDefinition }) {
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
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.1, 0]} receiveShadow>
        <planeGeometry args={[floorSize.width, floorSize.depth]} />
        <meshStandardMaterial color={GROUND_COLOR} />
      </mesh>

      <Suspense fallback={null}>
        {tileGroups.map(([url, group]) => (
          <InstancedTiles key={url} url={url} tiles={group} />
        ))}
      </Suspense>

      <Suspense fallback={null}>
        {map.scenery.map((inst, index) => (
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
      return <PropMesh def={def} />;
    }
  }
  return <AnimalAvatar id={avatar} role={role} />;
}

function PropPicker({
  room,
  enabled,
  playerPos,
}: {
  room: Room;
  enabled: boolean;
  playerPos: PlayerPosRef;
}) {
  const { camera, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyE") {
        return;
      }
      raycaster.setFromCamera(SCREEN_CENTER, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        let propType: string | undefined;
        let isSelf = false;
        while (obj) {
          if (obj.userData?.[LOCAL_AVATAR_KEY]) {
            isSelf = true;
          }
          const pt = obj.userData?.propType;
          if (typeof pt === "string" && pt) {
            propType = pt;
            break;
          }
          obj = obj.parent;
        }
        if (propType) {
          const dx = hit.point.x - playerPos.current.x;
          const dz = hit.point.z - playerPos.current.z;
          if (dx * dx + dz * dz <= TRANSFORM_REACH * TRANSFORM_REACH) {
            room.send(MSG_TRANSFORM, { propType });
          }
          return;
        }
        if (isSelf) {
          continue;
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, camera, scene, raycaster, room, playerPos]);

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
  obstacles: Obstacle[];
  walls: Wall[];
  avatar: string;
  playerPos: PlayerPosRef;
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
  obstacles,
  walls,
  avatar,
  playerPos,
}: LocalPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const keys = useControls(!chatOpen);
  const look = useMouseLook();
  const { camera } = useThree();

  const spawn = map.spawnPoints.props[0] ?? map.bounds.min;
  const pos = useMemo(() => new THREE.Vector3(spawn.x, 0, spawn.z), [spawn.x, spawn.z]);
  const spawnApplied = useRef(false);
  const heading = useRef(0);
  const sendAccumMs = useRef(0);
  const stepAccum = useRef(0);
  const velocityY = useRef(0);
  const jumpHeld = useRef(false);
  const forwardVec = useMemo(() => new THREE.Vector3(), []);
  const rightVec = useMemo(() => new THREE.Vector3(), []);
  const moveVec = useMemo(() => new THREE.Vector3(), []);
  const camDistRef = useRef(CAMERA_DISTANCE);

  const frozen = !alive || (role === "hunter" && phase === "hiding");

  useFrame((_, delta) => {
    if (!spawnApplied.current) {
      const self = playersRef.current.get(id);
      if (self) {
        pos.set(self.x, 0, self.z);
        heading.current = self.rot;
        spawnApplied.current = true;
      }
    }

    const teleport = teleportRef.current;
    if (teleport) {
      pos.x = teleport.x;
      pos.z = teleport.z;
      teleportRef.current = null;
    }

    const { yaw, pitch } = look.current;
    forwardVec.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    rightVec.crossVectors(forwardVec, UP);

    if (!frozen) {
      const k = keys.current;
      const forwardInput = (k.forward ? 1 : 0) - (k.back ? 1 : 0);
      const strafeInput = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      moveVec
        .set(0, 0, 0)
        .addScaledVector(forwardVec, forwardInput)
        .addScaledVector(rightVec, strafeInput);

      const runMultiplier = role === "hunter" ? RUN_MULTIPLIER_HUNTER : RUN_MULTIPLIER_PROP;
      const speed = k.run ? MOVE_SPEED * runMultiplier : MOVE_SPEED;

      if (moveVec.lengthSq() > 0) {
        moveVec.normalize();
        pos.x += moveVec.x * speed * delta;
        pos.z += moveVec.z * speed * delta;
        heading.current = Math.atan2(moveVec.x, moveVec.z);
        if (pos.y <= 0) {
          stepAccum.current += speed * delta;
          if (stepAccum.current >= STEP_DISTANCE) {
            stepAccum.current = 0;
            playStep();
          }
        }
      }

      if (role === "hunter") {
        if (k.jump && !jumpHeld.current && pos.y <= 0 && velocityY.current <= 0) {
          velocityY.current = JUMP_SPEED;
        }
        velocityY.current -= GRAVITY * delta;
        pos.y += velocityY.current * delta;
        if (pos.y <= 0) {
          pos.y = 0;
          velocityY.current = 0;
        }
      }
      jumpHeld.current = k.jump;

      const { min, max } = map.bounds;
      pos.x = THREE.MathUtils.clamp(pos.x, min.x + PLAYER_RADIUS, max.x - PLAYER_RADIUS);
      pos.z = THREE.MathUtils.clamp(pos.z, min.z + PLAYER_RADIUS, max.z - PLAYER_RADIUS);
    }

    if (alive) {
      for (const [otherId, other] of playersRef.current) {
        if (otherId === id || !other.alive) continue;
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
      for (const obstacle of obstacles) {
        const dx = pos.x - obstacle.x;
        const dz = pos.z - obstacle.z;
        const minSep = PLAYER_RADIUS + obstacle.radius;
        const distSq = dx * dx + dz * dz;
        if (distSq > 1e-8 && distSq < minSep * minSep) {
          const dist = Math.sqrt(distSq);
          const push = minSep - dist;
          pos.x += (dx / dist) * push;
          pos.z += (dz / dist) * push;
        }
      }
      for (const wall of walls) {
        const nearestX = THREE.MathUtils.clamp(pos.x, wall.minX, wall.maxX);
        const nearestZ = THREE.MathUtils.clamp(pos.z, wall.minZ, wall.maxZ);
        const dx = pos.x - nearestX;
        const dz = pos.z - nearestZ;
        const distSq = dx * dx + dz * dz;
        if (distSq >= PLAYER_RADIUS * PLAYER_RADIUS) continue;
        if (distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const push = PLAYER_RADIUS - dist;
          pos.x += (dx / dist) * push;
          pos.z += (dz / dist) * push;
        } else {
          const toMinX = pos.x - wall.minX;
          const toMaxX = wall.maxX - pos.x;
          const toMinZ = pos.z - wall.minZ;
          const toMaxZ = wall.maxZ - pos.z;
          const minPen = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
          if (minPen === toMinX) pos.x = wall.minX - PLAYER_RADIUS;
          else if (minPen === toMaxX) pos.x = wall.maxX + PLAYER_RADIUS;
          else if (minPen === toMinZ) pos.z = wall.minZ - PLAYER_RADIUS;
          else pos.z = wall.maxZ + PLAYER_RADIUS;
        }
      }
      const { min, max } = map.bounds;
      pos.x = THREE.MathUtils.clamp(pos.x, min.x + PLAYER_RADIUS, max.x - PLAYER_RADIUS);
      pos.z = THREE.MathUtils.clamp(pos.z, min.z + PLAYER_RADIUS, max.z - PLAYER_RADIUS);
    }

    playerPos.current.set(pos.x, 0, pos.z);
    const group = groupRef.current;
    if (group) {
      group.position.set(pos.x, pos.y, pos.z);
      group.rotation.y = heading.current;
      applyTauntPulse(group, tauntPulseRef, id, delta);
    }

    if (role === "hunter") {
      const cosPitch = Math.cos(pitch);
      camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
      camera.lookAt(
        pos.x - Math.sin(yaw) * cosPitch,
        pos.y + EYE_HEIGHT - Math.sin(pitch),
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
      camera.lookAt(pos.x, CAMERA_TARGET_Y, pos.z);
    }

    sendAccumMs.current += delta * 1000;
    if (sendAccumMs.current >= INPUT_SEND_RATE_MS) {
      sendAccumMs.current = 0;
      room.send(MSG_INPUT, { x: pos.x, y: pos.y, z: pos.z, rot: heading.current });
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

interface RemotePlayerProps {
  view: RemotePlayerView | undefined;
  catalog: Catalog;
  role: Role;
  propType: string;
  avatar: string;
  tauntPulseRef: TauntPulseRef;
}

function RemotePlayer({ view, catalog, role, propType, avatar, tauntPulseRef }: RemotePlayerProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || !view) {
      return;
    }
    const t = 1 - REMOTE_DAMP ** delta;
    group.position.x += (view.x - group.position.x) * t;
    group.position.y += (view.y - group.position.y) * t;
    group.position.z += (view.z - group.position.z) * t;
    group.rotation.y = view.rot;
    applyTauntPulse(group, tauntPulseRef, view.id, delta);
  });

  if (!view) {
    return null;
  }
  return (
    <group ref={groupRef}>
      <PlayerModel role={role} propType={propType} avatar={avatar} catalog={catalog} />
    </group>
  );
}
