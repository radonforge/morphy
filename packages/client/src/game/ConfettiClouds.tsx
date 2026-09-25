import { Callbacks, type Room } from "@colyseus/sdk";
import { PUFF_DURATION_MS, PUFF_RADIUS } from "@morphy/shared";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { playPuff } from "./audio";
import { useGuardedFrame } from "./guardedFrame";
import { falloff, type ListenerRef, stereoPan } from "./spatialAudio";

const PUFF_COUNT = 11;
const PUFF_SIZE_MIN = 0.9;
const PUFF_SIZE_MAX = 1.35;
const PUFF_SPREAD = PUFF_RADIUS - PUFF_SIZE_MIN;
const PUFF_COLORS = ["#fff6f0", "#ffe3ef", "#e6f3ff", "#fff3cf", "#eafbe7"];
const CHIP_COUNT = 90;
const CHIP_SIZE = 0.16;
const CHIP_SPREAD = PUFF_RADIUS * 1.25;
const CHIP_COLORS = ["#ff4d6d", "#ffd23f", "#3ec1ff", "#7bd389", "#b388ff", "#ff9f43"];
const CHIP_FALL_SPEED = 0.35;
const CHIP_SWIRL_SPEED = 1.6;
const CHIP_SPIN_SPEED = 7;
const GROW_S = 0.18;
const GROW_FROM = 0.35;
const FADE_S = 0.45;
const LIFE_S = PUFF_DURATION_MS / 1_000;
const SOUND_RADIUS = 30;
const MS_PER_SECOND = 1_000;
const SEED_MULTIPLIER = 31;
const UINT32 = 0x1_0000_0000;

interface CloudView {
  id: string;
  x: number;
  y: number;
  z: number;
  bornAt: number;
}

interface Chip {
  radius: number;
  angle: number;
  height: number;
  spin: THREE.Vector3;
}

interface CloudLayout {
  puffs: { position: THREE.Vector3; size: number; color: THREE.Color }[];
  chips: Chip[];
  chipColors: THREE.Color[];
}

let puffGeometry: THREE.IcosahedronGeometry | null = null;
let chipGeometry: THREE.PlaneGeometry | null = null;
let puffMaterial: THREE.MeshLambertMaterial | null = null;
let chipMaterial: THREE.MeshLambertMaterial | null = null;

/** One geometry and material pair for every cloud a session ever bursts. */
function sharedResources(): {
  puffGeometry: THREE.IcosahedronGeometry;
  chipGeometry: THREE.PlaneGeometry;
  puffMaterial: THREE.MeshLambertMaterial;
  chipMaterial: THREE.MeshLambertMaterial;
} {
  puffGeometry ??= new THREE.IcosahedronGeometry(1, 0);
  chipGeometry ??= new THREE.PlaneGeometry(CHIP_SIZE, CHIP_SIZE);
  puffMaterial ??= new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });
  chipMaterial ??= new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  return { puffGeometry, chipGeometry, puffMaterial, chipMaterial };
}

/** Deterministic 0..1 sequence from a cloud id, so every client lays a cloud out alike. */
function seededRandom(seed: string): () => number {
  let state = 0;
  for (const ch of seed) state = (Math.imul(state, SEED_MULTIPLIER) + ch.charCodeAt(0)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.floor(roll * items.length) % items.length] as T;
}

function layoutFor(id: string): CloudLayout {
  const random = seededRandom(id);
  const inBall = (spread: number): THREE.Vector3 => {
    const v = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    if (v.lengthSq() > 1) v.normalize();
    return v.multiplyScalar(spread);
  };
  const puffs = Array.from({ length: PUFF_COUNT }, () => ({
    position: inBall(PUFF_SPREAD),
    size: PUFF_SIZE_MIN + random() * (PUFF_SIZE_MAX - PUFF_SIZE_MIN),
    color: new THREE.Color(pick(PUFF_COLORS, random())),
  }));
  const chips = Array.from({ length: CHIP_COUNT }, () => ({
    radius: random() * CHIP_SPREAD,
    angle: random() * Math.PI * 2,
    height: (random() * 2 - 1) * CHIP_SPREAD,
    spin: new THREE.Vector3(random(), random(), random()),
  }));
  const chipColors = chips.map(() => new THREE.Color(pick(CHIP_COLORS, random())));
  return { puffs, chips, chipColors };
}

/** Pop in fast, hold, then shrink away over the cloud's last moments. */
function envelope(ageS: number): number {
  if (ageS < GROW_S) {
    const t = ageS / GROW_S;
    return GROW_FROM + (1 - GROW_FROM) * (1 - (1 - t) ** 3);
  }
  const left = LIFE_S - ageS;
  if (left < FADE_S) return Math.max(0, left / FADE_S);
  return 1;
}

function Cloud({ cloud }: { cloud: CloudView }) {
  const group = useRef<THREE.Group>(null);
  const puffs = useRef<THREE.InstancedMesh>(null);
  const chips = useRef<THREE.InstancedMesh>(null);
  const layout = useMemo(() => layoutFor(cloud.id), [cloud.id]);
  const resources = useMemo(() => sharedResources(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = puffs.current;
    const confetti = chips.current;
    if (!mesh || !confetti) return;
    layout.puffs.forEach((puff, i) => {
      dummy.position.copy(puff.position);
      dummy.rotation.set(puff.size, puff.size * 2, 0);
      dummy.scale.setScalar(puff.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, puff.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    layout.chipColors.forEach((color, i) => {
      confetti.setColorAt(i, color);
    });
    if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;
  }, [layout, dummy]);

  useGuardedFrame(() => {
    const root = group.current;
    const confetti = chips.current;
    if (!root || !confetti) return;
    const age = (performance.now() - cloud.bornAt) / MS_PER_SECOND;
    root.scale.setScalar(envelope(age));
    layout.chips.forEach((chip, i) => {
      const angle = chip.angle + age * CHIP_SWIRL_SPEED;
      dummy.position.set(
        Math.cos(angle) * chip.radius,
        chip.height - age * CHIP_FALL_SPEED,
        Math.sin(angle) * chip.radius,
      );
      dummy.rotation.set(
        chip.spin.x * age * CHIP_SPIN_SPEED,
        chip.spin.y * age * CHIP_SPIN_SPEED,
        chip.spin.z * age * CHIP_SPIN_SPEED,
      );
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      confetti.setMatrixAt(i, dummy.matrix);
    });
    confetti.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={group} position={[cloud.x, cloud.y, cloud.z]}>
      <instancedMesh
        ref={puffs}
        args={[resources.puffGeometry, resources.puffMaterial, PUFF_COUNT]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={chips}
        args={[resources.chipGeometry, resources.chipMaterial, CHIP_COUNT]}
        frustumCulled={false}
      />
    </group>
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The confetti clouds props burst, straight from the room state: each pops in
 * with a noise, hangs opaque for its life and shrinks away as the server drops
 * it. It is sight cover only, so nothing here touches hit resolution.
 */
export function ConfettiClouds({ room, listenerRef }: { room: Room; listenerRef: ListenerRef }) {
  const [clouds, setClouds] = useState<CloudView[]>([]);

  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const offAdd = callbacks.onAdd("clouds", (cloud: unknown, key: unknown) => {
      const c = cloud as Partial<CloudView>;
      if (!isFiniteNumber(c.x) || !isFiniteNumber(c.y) || !isFiniteNumber(c.z)) return;
      const view: CloudView = {
        id: String(key),
        x: c.x,
        y: c.y,
        z: c.z,
        bornAt: performance.now(),
      };
      setClouds((prev) => [...prev, view]);
      const listener = listenerRef.current;
      playPuff(falloff(listener, c.x, c.z, SOUND_RADIUS), stereoPan(listener, c.x, c.z));
    });
    const offRemove = callbacks.onRemove("clouds", (_cloud: unknown, key: unknown) => {
      const id = String(key);
      setClouds((prev) => prev.filter((c) => c.id !== id));
    });
    return () => {
      offAdd();
      offRemove();
    };
  }, [room, listenerRef]);

  return (
    <>
      {clouds.map((cloud) => (
        <Cloud key={cloud.id} cloud={cloud} />
      ))}
    </>
  );
}
