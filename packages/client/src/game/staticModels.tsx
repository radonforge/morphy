import {
  computePropBounds,
  type MapDefinition,
  type PropDefinition,
  type PropInstance,
  type SceneryInstance,
} from "@morphy/shared";
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { fitModel } from "./modelFit";
import { enableShadows } from "./modelShading";
import { useSharedGLTF } from "./sharedTextures";

const UP = new THREE.Vector3(0, 1, 0);

type Placement =
  | { kind: "fitted"; prop: PropInstance; def: PropDefinition }
  | { kind: "scenery"; inst: SceneryInstance };

interface ModelPart {
  id: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  local: THREE.Matrix4;
}

function placementsByModel(
  map: MapDefinition,
  catalog: ReadonlyMap<string, PropDefinition>,
): [string, Placement[]][] {
  const groups = new Map<string, Placement[]>();
  const add = (url: string, placement: Placement) => {
    const group = groups.get(url);
    if (group) group.push(placement);
    else groups.set(url, [placement]);
  };
  for (const prop of map.props) {
    const def = catalog.get(prop.type);
    if (def?.model) add(def.model, { kind: "fitted", prop, def });
  }
  for (const inst of map.scenery) add(inst.model, { kind: "scenery", inst });
  return [...groups.entries()];
}

function modelParts(root: THREE.Object3D): ModelPart[] {
  root.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    parts.push({
      id: mesh.uuid,
      geometry: mesh.geometry,
      material: mesh.material,
      local: mesh.matrixWorld.clone(),
    });
  });
  return parts;
}

function rootMatrix(placement: Placement, box: THREE.Box3): THREE.Matrix4 {
  const quat = new THREE.Quaternion();
  if (placement.kind === "scenery") {
    const { inst } = placement;
    quat.setFromAxisAngle(UP, inst.rotationY);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(inst.position.x, inst.position.y, inst.position.z),
      quat,
      new THREE.Vector3(inst.scale, inst.scale, inst.scale),
    );
  }
  const { prop, def } = placement;
  const bounds = computePropBounds(def);
  const fit = fitModel(
    box,
    2 * bounds.radius,
    bounds.yMax - bounds.yMin,
    bounds.yMin,
    def.modelScale ?? 1,
  );
  quat.setFromAxisAngle(UP, prop.rotation);
  const seat = new THREE.Matrix4().compose(
    new THREE.Vector3(prop.position.x, prop.position.y, prop.position.z),
    quat,
    new THREE.Vector3(1, 1, 1),
  );
  const fitted = new THREE.Matrix4().compose(
    new THREE.Vector3(fit.offset[0], fit.offset[1], fit.offset[2]),
    new THREE.Quaternion(),
    new THREE.Vector3(fit.scale, fit.scale, fit.scale),
  );
  return seat.multiply(fitted);
}

function InstancedPart({ part, roots }: { part: ModelPart; roots: THREE.Matrix4[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    roots.forEach((root, i) => {
      mesh.setMatrixAt(i, matrix.multiplyMatrices(root, part.local));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return () => mesh.dispose();
  }, [part, roots]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[part.geometry, part.material, roots.length]}
      castShadow
      receiveShadow
      matrixAutoUpdate={false}
      dispose={null}
    />
  );
}

function InstancedModel({ url, placements }: { url: string; placements: Placement[] }) {
  const { scene } = useSharedGLTF(url);
  const parts = useMemo(() => {
    enableShadows(scene);
    return modelParts(scene);
  }, [scene]);
  const roots = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    return placements.map((placement) => rootMatrix(placement, box));
  }, [scene, placements]);
  return (
    <>
      {parts.map((part) => (
        <InstancedPart key={part.id} part={part} roots={roots} />
      ))}
    </>
  );
}

/**
 * Every static model on the map, props and scenery alike, drawn as one instanced
 * mesh per model part instead of one clone per placement: the draw calls go from
 * one per primitive per placement to one per primitive per model, in both the main
 * and the shadow pass.
 *
 * A map prop is fitted through {@link fitModel} with the same box a disguised
 * player's clone measures, so a real prop and its look-alike render identically;
 * only the players stay as clones. Props without a model are left to the caller.
 */
export function StaticModels({
  map,
  catalog,
}: {
  map: MapDefinition;
  catalog: ReadonlyMap<string, PropDefinition>;
}) {
  const groups = useMemo(() => placementsByModel(map, catalog), [map, catalog]);
  return (
    <Suspense fallback={null}>
      {groups.map(([url, placements]) => (
        <InstancedModel key={url} url={url} placements={placements} />
      ))}
    </Suspense>
  );
}
