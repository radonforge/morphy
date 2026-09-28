import type { PropDefinition } from "@morphy/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const THUMB_SIZE = 96;
const THUMB_FOV = 30;
const THUMB_DISTANCE_MULT = 1.9;
const THUMB_ELEVATION = 0.75;
const THUMB_AZIMUTH = Math.PI / 4;
const THUMB_AMBIENT = 1.1;
const THUMB_SUN = 2.2;
const THUMB_SUN_POSITION: [number, number, number] = [3, 5, 4];

function disposeModel(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of [mesh.material].flat()) material.dispose();
  });
}

/**
 * Render one small picture per catalog model with a throwaway renderer, for the
 * palette. Each resolves as it is drawn, so the palette fills in as it goes; a
 * model that fails to load is left without a picture. The renderer is disposed
 * afterwards so the editor holds only its main WebGL context.
 */
export async function renderThumbnails(
  catalog: readonly PropDefinition[],
  onThumbnail: (id: string, url: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(THUMB_SIZE, THUMB_SIZE);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, THUMB_AMBIENT));
  const sun = new THREE.DirectionalLight(0xffffff, THUMB_SUN);
  sun.position.set(...THUMB_SUN_POSITION);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(THUMB_FOV, 1, 0.01, 100);
  const loader = new GLTFLoader();
  try {
    for (const def of catalog) {
      if (signal.aborted) return;
      if (!def.model) continue;
      let model: THREE.Object3D;
      try {
        model = (await loader.loadAsync(def.model)).scene;
      } catch (error) {
        console.warn(`[editor] thumbnail for ${def.id} failed`, error);
        continue;
      }
      const box = new THREE.Box3().setFromObject(model);
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      const distance = (radius * THUMB_DISTANCE_MULT) / Math.tan((THUMB_FOV * Math.PI) / 360);
      camera.position.set(
        centre.x + distance * Math.cos(THUMB_ELEVATION) * Math.sin(THUMB_AZIMUTH),
        centre.y + distance * Math.sin(THUMB_ELEVATION),
        centre.z + distance * Math.cos(THUMB_ELEVATION) * Math.cos(THUMB_AZIMUTH),
      );
      camera.lookAt(centre);
      scene.add(model);
      renderer.render(scene, camera);
      scene.remove(model);
      disposeModel(model);
      onThumbnail(def.id, renderer.domElement.toDataURL());
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
