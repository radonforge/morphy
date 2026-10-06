import type { MapDefinition, MapLight } from "@morphy/shared";
import { useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGuardedFrame } from "./guardedFrame";
import { tintGlow } from "./modelGlow";
import { useSharedGLTF } from "./sharedTextures";

const SKY_GLOW_RADIUS = 400;
const SKY_GLOW_SEGMENTS = 32;
const BULB_SIZE: [number, number, number] = [0.36, 0.04, 0.36];
const LAMP_MODEL_MARK = "/roads/light-";
const BACKDROP_MODEL_MARK = "/low-detail-building-";
const WINDOW_GLOW = "windows";
const ARM_EPSILON = 1e-6;

const noRaycast = () => {};

/** A night street's lamps, lit from the `MapDefinition.lights` that carry a lamp head height. */
export interface StreetLampPreset {
  color: string;
  /**
   * Colour of every `altEvery`-th lamp hanging from a pole whose model contains `altPole`,
   * in document order; 0 keeps them all `color`.
   */
  altColor: string;
  altEvery: number;
  altPole: string;
  intensity: number;
  distance: number;
  /** How far below the head the light hangs, and how far past it along the arm. */
  lightDrop: number;
  lightPull: number;
  /** How far the bulb's glow exceeds its colour, so bloom catches it. */
  bulbGlow: number;
  /** Lamp models' colour at night, as a fraction of their day colour, so a light does not wash its own pole. */
  poleTint: number;
  /** The skyline facades beyond the map's edge at night, as a fraction of their day colour. */
  backdropTint: number;
  /** What the building windows glow at night: lit rooms behind them. */
  windowGlow: string;
  /** Real point lights, moved each frame onto the lamps nearest the camera; the rest only glow. */
  budget: number;
}

/** A gradient dome behind the stars: `horizon` at the skyline fading to `top` by `fade` (sine of elevation). */
export interface SkyGlowPreset {
  top: string;
  horizon: string;
  fade: number;
}

const SKY_GLOW_VERTEX = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_GLOW_FRAGMENT = `
uniform vec3 top;
uniform vec3 horizon;
uniform float fade;
varying vec3 vDir;
void main() {
  float h = smoothstep(0.0, fade, max(vDir.y, 0.0));
  gl_FragColor = vec4(mix(horizon, top, h), 1.0);
}`;

/** A city's light-polluted sky: a dome glowing warm at the skyline, drawn behind everything. */
export function SkyGlow({ preset }: { preset: SkyGlowPreset }) {
  const uniforms = useMemo(
    () => ({
      top: { value: new THREE.Color(preset.top) },
      horizon: { value: new THREE.Color(preset.horizon) },
      fade: { value: preset.fade },
    }),
    [preset],
  );
  return (
    <mesh renderOrder={-1} raycast={noRaycast}>
      <sphereGeometry args={[SKY_GLOW_RADIUS, SKY_GLOW_SEGMENTS, SKY_GLOW_SEGMENTS]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={SKY_GLOW_VERTEX}
        fragmentShader={SKY_GLOW_FRAGMENT}
      />
    </mesh>
  );
}

function modelsMarked(map: MapDefinition, mark: string): string[] {
  return [...new Set(map.scenery.filter((s) => s.model.includes(mark)).map((s) => s.model))];
}

interface Lamp {
  bulb: THREE.Vector3;
  light: THREE.Vector3;
  color: THREE.Color;
}

/** Where each lamp's bulb glows and its light hangs: below the head, pulled along the arm away from the pole. */
function layLamps(map: MapDefinition, preset: StreetLampPreset): Lamp[] {
  const poles = map.scenery.filter((s) => s.model.includes(LAMP_MODEL_MARK));
  const lights = (map.lights ?? []).filter(
    (light): light is MapLight & { y: number } => light.y !== undefined,
  );
  let altCount = 0;
  return lights.map((light) => {
    let nearest = poles[0]?.position ?? { x: light.x, z: light.z };
    let model = poles[0]?.model ?? "";
    for (const pole of poles) {
      const d = Math.hypot(pole.position.x - light.x, pole.position.z - light.z);
      if (d < Math.hypot(nearest.x - light.x, nearest.z - light.z)) {
        nearest = pole.position;
        model = pole.model;
      }
    }
    const dx = light.x - nearest.x;
    const dz = light.z - nearest.z;
    const arm = Math.hypot(dx, dz);
    const pull = arm > ARM_EPSILON ? preset.lightPull / arm : 0;
    const alternates = preset.altEvery > 0 && model.includes(preset.altPole);
    const alt = alternates && ++altCount % preset.altEvery === 0;
    return {
      bulb: new THREE.Vector3(light.x, light.y, light.z),
      light: new THREE.Vector3(
        light.x + dx * pull,
        light.y - preset.lightDrop,
        light.z + dz * pull,
      ),
      color: new THREE.Color(alt ? preset.altColor : preset.color),
    };
  });
}

/** Darken one model's materials for the night, and give the day colour back on unmount. */
function ModelTint({ url, tint }: { url: string; tint: number }) {
  const { scene } = useSharedGLTF(url);
  useEffect(() => {
    const restore: [THREE.MeshStandardMaterial, THREE.Color][] = [];
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.color) continue;
        restore.push([standard, standard.color.clone()]);
        standard.color.multiplyScalar(tint);
      }
    });
    return () => {
      for (const [material, color] of restore) material.color.copy(color);
    };
  }, [scene, tint]);
  return null;
}

/**
 * A night street: every lamp's bulb glows (one instanced mesh, untoned so bloom
 * catches it), while only `budget` point lights exist, each frame moved onto the
 * lamps nearest the camera. A fixed count never recompiles a shader, and a forward
 * renderer pays for every light on every lit pixel, reach or not.
 */
export function StreetLamps({ map, preset }: { map: MapDefinition; preset: StreetLampPreset }) {
  const lamps = useMemo(() => layLamps(map, preset), [map, preset]);
  const lampModels = useMemo(() => modelsMarked(map, LAMP_MODEL_MARK), [map]);
  const backdropModels = useMemo(() => modelsMarked(map, BACKDROP_MODEL_MARK), [map]);
  const bulbs = useRef<THREE.InstancedMesh>(null);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const camera = useThree((state) => state.camera);
  const order = useMemo(() => lamps.map((_, index) => index), [lamps]);

  useLayoutEffect(() => {
    const mesh = bulbs.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const glow = new THREE.Color();
    lamps.forEach((lamp, index) => {
      mesh.setMatrixAt(index, matrix.makeTranslation(lamp.bulb));
      mesh.setColorAt(index, glow.copy(lamp.color).multiplyScalar(preset.bulbGlow));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [lamps, preset.bulbGlow]);

  useEffect(() => {
    tintGlow(WINDOW_GLOW, preset.windowGlow);
    return () => tintGlow(WINDOW_GLOW, null);
  }, [preset.windowGlow]);

  useGuardedFrame(() => {
    const eye = camera.position;
    order.sort(
      (a, b) => lamps[a]!.light.distanceToSquared(eye) - lamps[b]!.light.distanceToSquared(eye),
    );
    lights.current.forEach((light, slot) => {
      if (!light) return;
      const lamp = lamps[order[slot]!];
      light.visible = lamp !== undefined;
      if (!lamp) return;
      light.position.copy(lamp.light);
      light.color.copy(lamp.color);
    });
  });

  return (
    <>
      <Suspense fallback={null}>
        {lampModels.map((url) => (
          <ModelTint key={url} url={url} tint={preset.poleTint} />
        ))}
        {backdropModels.map((url) => (
          <ModelTint key={url} url={url} tint={preset.backdropTint} />
        ))}
      </Suspense>
      {lamps.length > 0 && (
        <instancedMesh ref={bulbs} args={[undefined, undefined, lamps.length]} raycast={noRaycast}>
          <boxGeometry args={BULB_SIZE} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      )}
      {Array.from({ length: Math.min(preset.budget, lamps.length) }, (_, slot) => (
        <pointLight
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pool of light slots, never reordered
          key={slot}
          ref={(light) => {
            lights.current[slot] = light;
          }}
          intensity={preset.intensity}
          distance={preset.distance}
        />
      ))}
    </>
  );
}
