import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Room } from "@colyseus/sdk";
import {
  INPUT_SEND_RATE_MS,
  MOVE_SPEED,
  MSG_INPUT,
  MSG_TRANSFORM,
  MSG_SHOOT,
  type MapDefinition,
  type Phase,
  type PrimitiveSpec,
  type PropDefinition,
  type Role,
} from "@webhunt/shared";
import { useControls } from "./useControls";
import type { MetaMap, PlayersRef, RemotePlayerView, TeleportRef } from "./types";

const PLAYER_RADIUS = 0.4;
const PLAYER_BODY_LENGTH = 0.9;
const PLAYER_BODY_Y = PLAYER_BODY_LENGTH / 2 + PLAYER_RADIUS;
const PLAYER_HEAD_Y = PLAYER_BODY_LENGTH + PLAYER_RADIUS * 1.6;
const HUNTER_COLOR = "#e8564a";
const PROP_COLOR = "#5bd75b";

const CAMERA_DISTANCE = 8;
const CAMERA_TARGET_Y = 1.2;
const CAMERA_DAMP = 0.0008;
const REMOTE_DAMP = 0.0009;
const LOOK_SENSITIVITY = 0.0025;
const PITCH_MIN = -1.4;
const PITCH_MAX = 1.4;
const TP_PITCH_MIN = -0.15;
const TP_PITCH_MAX = 1.2;
const DEFAULT_PITCH = 0.5;
const EYE_HEIGHT = 1.6;
const UP = new THREE.Vector3(0, 1, 0);
const SCREEN_CENTER = new THREE.Vector2(0, 0);

type Catalog = Map<string, PropDefinition>;

interface SceneProps {
  room: Room;
  map: MapDefinition;
  localId: string;
  ids: string[];
  playersRef: PlayersRef;
  meta: MetaMap;
  phase: Phase;
  teleportRef: TeleportRef;
}

export function Scene({ room, map, localId, ids, playersRef, meta, phase, teleportRef }: SceneProps) {
  const catalog = useMemo<Catalog>(
    () => new Map(map.propCatalog.map((def) => [def.id, def])),
    [map],
  );
  const localMeta = meta[localId];
  const localRole: Role = localMeta?.role ?? "prop";
  const localAlive = localMeta?.alive ?? true;
  const canTransform = localRole === "prop" && localAlive && (phase === "hiding" || phase === "hunting");
  const canShoot = localRole === "hunter" && localAlive && phase === "hunting";

  return (
    <>
      <color attach="background" args={["#aecbe8"]} />
      <hemisphereLight args={["#ffffff", "#404a5c", 1.0]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[12, 22, 8]} intensity={1.2} castShadow />
      <MapView map={map} />
      <PropPicker room={room} enabled={canTransform} />
      <Shooter room={room} enabled={canShoot} />
      <LocalPlayer
        room={room}
        map={map}
        catalog={catalog}
        role={localRole}
        propType={localMeta?.propType ?? ""}
        phase={phase}
        alive={localAlive}
        teleportRef={teleportRef}
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
          />
        ))}
    </>
  );
}

function Shooter({ room, enabled }: { room: Room; enabled: boolean }) {
  const { camera, gl } = useThree();
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
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [enabled, camera, gl, raycaster, room]);

  return null;
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

function PropMesh({ def }: { def: PropDefinition }) {
  return (
    <>
      {def.parts.map((part, index) => (
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

function MapView({ map }: { map: MapDefinition }) {
  const catalog = useMemo<Catalog>(
    () => new Map(map.propCatalog.map((def) => [def.id, def])),
    [map],
  );
  const floorWidth = map.bounds.max.x - map.bounds.min.x + 2;
  const floorDepth = map.bounds.max.z - map.bounds.min.z + 2;

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[floorWidth, floorDepth]} />
        <meshStandardMaterial color="#cfd6df" />
      </mesh>

      {map.colliders
        .filter((collider) => collider.position.y > 0)
        .map((collider, index) => (
          <mesh
            key={`wall-${index}`}
            position={[collider.position.x, collider.position.y, collider.position.z]}
            receiveShadow
          >
            <boxGeometry args={[collider.size.x, collider.size.y, collider.size.z]} />
            <meshStandardMaterial color="#e8ebf0" />
          </mesh>
        ))}

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
}

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

function PlayerModel({ role, propType, catalog }: { role: Role; propType: string; catalog: Catalog }) {
  const def = propType ? catalog.get(propType) : undefined;
  if (def) {
    return <PropMesh def={def} />;
  }
  return <Avatar color={role === "hunter" ? HUNTER_COLOR : PROP_COLOR} />;
}

function PropPicker({ room, enabled }: { room: Room; enabled: boolean }) {
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
        while (obj) {
          const propType = obj.userData?.propType;
          if (typeof propType === "string" && propType) {
            room.send(MSG_TRANSFORM, { propType });
            return;
          }
          obj = obj.parent;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, camera, scene, raycaster, room]);

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
  role: Role;
  propType: string;
  phase: Phase;
  alive: boolean;
  teleportRef: TeleportRef;
}

function LocalPlayer({ room, map, catalog, role, propType, phase, alive, teleportRef }: LocalPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const keys = useControls();
  const look = useMouseLook();
  const { camera } = useThree();

  const spawn = map.spawnPoints.props[0] ?? map.bounds.min;
  const pos = useMemo(() => new THREE.Vector3(spawn.x, 0, spawn.z), [spawn.x, spawn.z]);
  const heading = useRef(0);
  const sendAccumMs = useRef(0);
  const forwardVec = useMemo(() => new THREE.Vector3(), []);
  const rightVec = useMemo(() => new THREE.Vector3(), []);
  const moveVec = useMemo(() => new THREE.Vector3(), []);
  const camOffset = useMemo(() => new THREE.Vector3(), []);
  const camTarget = useMemo(() => new THREE.Vector3(), []);

  const frozen = !alive || (role === "hunter" && phase === "hiding");

  useFrame((_, delta) => {
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

      if (moveVec.lengthSq() > 0) {
        moveVec.normalize();
        pos.x += moveVec.x * MOVE_SPEED * delta;
        pos.z += moveVec.z * MOVE_SPEED * delta;
        heading.current = Math.atan2(moveVec.x, moveVec.z);
      }

      const { min, max } = map.bounds;
      pos.x = THREE.MathUtils.clamp(pos.x, min.x + PLAYER_RADIUS, max.x - PLAYER_RADIUS);
      pos.z = THREE.MathUtils.clamp(pos.z, min.z + PLAYER_RADIUS, max.z - PLAYER_RADIUS);
    }

    const group = groupRef.current;
    if (group) {
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = heading.current;
    }

    if (role === "hunter") {
      const cosPitch = Math.cos(pitch);
      camera.position.set(pos.x, EYE_HEIGHT, pos.z);
      camera.lookAt(
        pos.x - Math.sin(yaw) * cosPitch,
        EYE_HEIGHT - Math.sin(pitch),
        pos.z - Math.cos(yaw) * cosPitch,
      );
    } else {
      const localPitch = THREE.MathUtils.clamp(pitch, TP_PITCH_MIN, TP_PITCH_MAX);
      const cosPitch = Math.cos(localPitch);
      camOffset
        .set(Math.sin(yaw) * cosPitch, Math.sin(localPitch), Math.cos(yaw) * cosPitch)
        .multiplyScalar(CAMERA_DISTANCE);
      camTarget.copy(pos).add(camOffset);
      camTarget.y += CAMERA_TARGET_Y;
      camera.position.lerp(camTarget, 1 - Math.pow(CAMERA_DAMP, delta));
      camera.lookAt(pos.x, CAMERA_TARGET_Y, pos.z);
    }

    sendAccumMs.current += delta * 1000;
    if (sendAccumMs.current >= INPUT_SEND_RATE_MS) {
      sendAccumMs.current = 0;
      room.send(MSG_INPUT, { x: pos.x, y: 0, z: pos.z, rot: heading.current });
    }
  });

  return (
    <group ref={groupRef}>
      {alive && role !== "hunter" && <PlayerModel role={role} propType={propType} catalog={catalog} />}
    </group>
  );
}

interface RemotePlayerProps {
  view: RemotePlayerView | undefined;
  catalog: Catalog;
  role: Role;
  propType: string;
}

function RemotePlayer({ view, catalog, role, propType }: RemotePlayerProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || !view) {
      return;
    }
    const t = 1 - Math.pow(REMOTE_DAMP, delta);
    group.position.x += (view.x - group.position.x) * t;
    group.position.z += (view.z - group.position.z) * t;
    group.rotation.y = view.rot;
  });

  if (!view) {
    return null;
  }
  return (
    <group ref={groupRef}>
      <PlayerModel role={role} propType={propType} catalog={catalog} />
    </group>
  );
}
