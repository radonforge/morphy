import type * as THREE from "three";

/**
 * Prepare a cloned Kenney model for the lit scene: every mesh casts and
 * receives shadows, and standard materials are made fully matte.
 *
 * The space/exterior kit ships `metallicFactor: 1` on every material. With no
 * environment map a metal gets no diffuse term at all, so ambient and
 * hemisphere light add nothing and the piece renders near black. The lobby
 * and the match must both go through here: the materials are shared through
 * the `useGLTF` cache, so a path that skips it looks different depending on
 * which one loaded the model first.
 */
export function enableShadows(object: THREE.Object3D): void {
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
