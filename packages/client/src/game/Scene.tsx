import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Room } from "@colyseus/sdk";
import {
  INPUT_SEND_RATE_MS,
  MOVE_SPEED,
  MSG_INPUT,
  type MapDefinition,
  type PrimitiveSpec,
} from "@webhunt/shared";
import { useControls } from "./useControls";
import type { PlayersRef, RemotePlayerView } from "./types";

const PLAYER_RADIUS = 0.4;
const PLAYER_BODY_LENGTH = 0.9;
const PLAYER_BODY_Y = PLAYER_BODY_LENGTH / 2 + PLAYER_RADIUS;
const PLAYER_HEAD_Y = PLAYER_BODY_LENGTH + PLAYER_RADIUS * 1.6;
const LOCAL_COLOR = "#5bd75b";
const REMOTE_COLOR = "#f0a35e";

const CAMERA_DISTANCE = 8;
const CAMERA_TARGET_Y = 1.2;
const CAMERA_DAMP = 0.0008;
const REMOTE_DAMP = 0.0009;
const LOOK_SENSITIVITY = 0.0025;
const PITCH_MIN = -0.15;
const PITCH_MAX = 1.2;
const DEFAULT_PITCH = 0.5;
const UP = new THREE.Vector3(0, 1, 0);

interface SceneProps {
  room: Room;
  map: MapDefinition;
  localId: string;
  ids: string[];
  playersRef: PlayersRef;
}

export function Scene({ room, map, localId, ids, playersRef }: SceneProps) {
  return (
    <>
      <color attach="background" args={["#aecbe8"]} />
      <hemisphereLight args={["#ffffff", "#404a5c", 1.0]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[12, 22, 8]} intensity={1.2} castShadow />
      <MapView map={map} />
      <LocalPlayer room={room} map={map} />
      {ids
        .filter((id) => id !== localId)
        .map((id) => (
          <RemotePlayer key={id} view={playersRef.current.get(id)} />
        ))}
    </>
  );
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

function MapView({ map }: { map: MapDefinition }) {
  const catalog = useMemo(
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
          >
            {def.parts.map((part, partIndex) => (
              <mesh
                key={partIndex}
                position={[part.position.x, part.position.y, part.position.z]}
                castShadow
                receiveShadow
              >
                {geometryFor(part)}
                <meshStandardMaterial color={part.color} />
              </mesh>
            ))}
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

function LocalPlayer({ room, map }: { room: Room; map: MapDefinition }) {
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

  useFrame((_, delta) => {
    const { yaw, pitch } = look.current;
    forwardVec.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    rightVec.crossVectors(forwardVec, UP);

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

    const group = groupRef.current;
    if (group) {
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = heading.current;
    }

    const cosPitch = Math.cos(pitch);
    camOffset
      .set(Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch)
      .multiplyScalar(CAMERA_DISTANCE);
    camTarget.copy(pos).add(camOffset);
    camTarget.y += CAMERA_TARGET_Y;
    camera.position.lerp(camTarget, 1 - Math.pow(CAMERA_DAMP, delta));
    camera.lookAt(pos.x, CAMERA_TARGET_Y, pos.z);

    sendAccumMs.current += delta * 1000;
    if (sendAccumMs.current >= INPUT_SEND_RATE_MS) {
      sendAccumMs.current = 0;
      room.send(MSG_INPUT, { x: pos.x, y: 0, z: pos.z, rot: heading.current });
    }
  });

  return (
    <group ref={groupRef}>
      <Avatar color={LOCAL_COLOR} />
    </group>
  );
}

function RemotePlayer({ view }: { view: RemotePlayerView | undefined }) {
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
      <Avatar color={REMOTE_COLOR} />
    </group>
  );
}
