import type { CeilingPanel } from "@morphy/shared";
import { memo, type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { type CeilingRib, glassRibs } from "./ceiling";

const GLASS_COLOR = "#000000";
const GLASS_OPACITY = 0.12;
const GLASS_ROUGHNESS = 0.5;
const GLASS_METALNESS = 0;
const SOLID_COLOR = "#4a5568";
const SOLID_THICKNESS = 0.3;
const SOLID_ROUGHNESS = 0.8;
const SOLID_METALNESS = 0.2;
const RIB_COLOR = "#6b7a90";
const RIB_WIDTH = 0.22;
const RIB_DEPTH = 0.3;
const RIB_ROUGHNESS = 0.6;
const RIB_METALNESS = 0.4;
const QUARTER_TURN = Math.PI / 2;

const UP = new THREE.Vector3(0, 1, 0);
const FACE_DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), QUARTER_TURN);
const NO_TURN = new THREE.Quaternion();
const ALONG_Z = new THREE.Quaternion().setFromAxisAngle(UP, QUARTER_TURN);

interface Placement {
  x: number;
  y: number;
  z: number;
  turn: THREE.Quaternion;
  sx: number;
  sy: number;
  sz: number;
}

function usePlacements(mesh: RefObject<THREE.InstancedMesh | null>, placements: Placement[]) {
  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    placements.forEach((p, i) => {
      position.set(p.x, p.y, p.z);
      scale.set(p.sx, p.sy, p.sz);
      target.setMatrixAt(i, matrix.compose(position, p.turn, scale));
    });
    target.instanceMatrix.needsUpdate = true;
  }, [mesh, placements]);
}

function glassPlacement(panel: CeilingPanel): Placement {
  return {
    x: panel.x,
    y: panel.y,
    z: panel.z,
    turn: FACE_DOWN,
    sx: panel.size,
    sy: panel.size,
    sz: 1,
  };
}

function solidPlacement(panel: CeilingPanel): Placement {
  return {
    x: panel.x,
    y: panel.y + SOLID_THICKNESS / 2,
    z: panel.z,
    turn: NO_TURN,
    sx: panel.size,
    sy: SOLID_THICKNESS,
    sz: panel.size,
  };
}

function ribPlacement(rib: CeilingRib): Placement {
  return {
    x: rib.x,
    y: rib.y + RIB_DEPTH / 2,
    z: rib.z,
    turn: rib.axis === "x" ? NO_TURN : ALONG_Z,
    sx: rib.length,
    sy: RIB_DEPTH,
    sz: RIB_WIDTH,
  };
}

/**
 * A map's ceiling: clear glass panes on a grid of beams where the sky shows
 * through, closed slabs where it does not. The glass is a dielectric with no
 * colour of its own and a soft sheen, so a deck light hanging under it neither
 * lights the pane nor leaves a sharp image of itself in it for bloom to blow up.
 * Instanced, casts no shadow, and is never a collider: the camera keeps under
 * it on its own.
 */
export const CeilingView = memo(function CeilingView({
  panels,
}: {
  panels: readonly CeilingPanel[];
}) {
  const glass = useMemo(
    () => panels.filter((panel) => panel.kind === "glass").map(glassPlacement),
    [panels],
  );
  const solid = useMemo(
    () => panels.filter((panel) => panel.kind === "solid").map(solidPlacement),
    [panels],
  );
  const ribs = useMemo(() => glassRibs(panels).map(ribPlacement), [panels]);
  const glassRef = useRef<THREE.InstancedMesh>(null);
  const solidRef = useRef<THREE.InstancedMesh>(null);
  const ribRef = useRef<THREE.InstancedMesh>(null);
  usePlacements(glassRef, glass);
  usePlacements(solidRef, solid);
  usePlacements(ribRef, ribs);

  return (
    <>
      {glass.length > 0 && (
        <instancedMesh
          key={`glass-${glass.length}`}
          ref={glassRef}
          args={[undefined, undefined, glass.length]}
          frustumCulled={false}
          renderOrder={1}
        >
          <planeGeometry args={[1, 1]} />
          <meshStandardMaterial
            color={GLASS_COLOR}
            transparent
            opacity={GLASS_OPACITY}
            roughness={GLASS_ROUGHNESS}
            metalness={GLASS_METALNESS}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </instancedMesh>
      )}
      {solid.length > 0 && (
        <instancedMesh
          key={`solid-${solid.length}`}
          ref={solidRef}
          args={[undefined, undefined, solid.length]}
          frustumCulled={false}
          receiveShadow
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={SOLID_COLOR}
            roughness={SOLID_ROUGHNESS}
            metalness={SOLID_METALNESS}
          />
        </instancedMesh>
      )}
      {ribs.length > 0 && (
        <instancedMesh
          key={`ribs-${ribs.length}`}
          ref={ribRef}
          args={[undefined, undefined, ribs.length]}
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={RIB_COLOR}
            roughness={RIB_ROUGHNESS}
            metalness={RIB_METALNESS}
          />
        </instancedMesh>
      )}
    </>
  );
});
