import { GROUND_KINDS, type GroundKind, type GroundPatch } from "@morphy/shared";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const GROUND_COLORS: Record<GroundKind, string> = {
  paving: "#b8b2a6",
  grass: "#6c9f55",
  yard: "#8c8a85",
};
const GROUND_ROUGHNESS = 0.95;
const GROUND_Y = 0.005;
const GROUND_POLYGON_OFFSET = -1;

const FACE_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

function GroundKindMesh({ kind, patches }: { kind: GroundKind; patches: GroundPatch[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    patches.forEach((patch, i) => {
      position.set(patch.x, GROUND_Y, patch.z);
      scale.set(patch.w, patch.d, 1);
      target.setMatrixAt(i, matrix.compose(position, FACE_UP, scale));
    });
    target.instanceMatrix.needsUpdate = true;
  }, [patches]);
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, patches.length]}
      receiveShadow
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial
        color={GROUND_COLORS[kind]}
        roughness={GROUND_ROUGHNESS}
        polygonOffset
        polygonOffsetFactor={GROUND_POLYGON_OFFSET}
        polygonOffsetUnits={GROUND_POLYGON_OFFSET}
      />
    </instancedMesh>
  );
}

/** An outdoor map's ground surfaces, one instanced flat mesh per kind. */
export const GroundView = memo(function GroundView({ ground }: { ground: readonly GroundPatch[] }) {
  const byKind = useMemo(
    () =>
      GROUND_KINDS.map((kind) => ({
        kind,
        patches: ground.filter((patch) => patch.kind === kind),
      })).filter((group) => group.patches.length > 0),
    [ground],
  );
  return (
    <>
      {byKind.map(({ kind, patches }) => (
        <GroundKindMesh key={kind} kind={kind} patches={patches} />
      ))}
    </>
  );
});
