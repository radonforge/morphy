import {
  doorKey,
  type LevelContext,
  type LevelDocument,
  type LevelObject,
  type LevelOverlays,
  objectFootprint,
  rectCorners,
  TILE,
  WALL_HEIGHT,
} from "@morphy/level";
import { LEVEL_SIGHTLINE_MAX, type MapDefinition } from "@morphy/shared";
import {
  Line,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  Stars,
  Text,
} from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { type MutableRefObject, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DeckLights, GAME_FOV, MapView, SUN_POSITION, type ThemePreset } from "../game/Scene";
import type { OverlayToggles } from "./ChecksPanel";
import type { EditorView, Preview, Selection } from "./types";

const PLAN_HEIGHT = 200;
const PLAN_FIT_MARGIN = 0.9;
const ORBIT_START: [number, number, number] = [0, 55, 60];
const ORBIT_MAX_POLAR = Math.PI / 2.05;
const OVERLAY_PLAN_Y = WALL_HEIGHT + 0.05;
const OVERLAY_FLOOR_Y = 0.04;
const OVERLAY_ORDER = 10;
const RING_SEGMENTS = 40;
const SPAWN_RADIUS = 0.6;
const DOOR_MARK_HALF = 0.9;
const LABEL_SIZE = 1.1;
const GRID_COLOR = "#35e0ff";
const GRID_OPACITY = 0.14;
const ROOM_OPACITY = 0.1;
const SELECT_COLOR = "#35e0ff";
const EXTERNAL_COLOR = "#ffb24a";
const VALID_COLOR = "#4ce8a0";
const INVALID_COLOR = "#ff5b5b";
const DOOR_COLOR = "#dbe7f2";
const OBJECT_RING_COLOR = "#9fb0d8";
const PROP_SPAWN_COLOR = "#5bd75b";
const HUNTER_SPAWN_COLOR = "#e8564a";
const ROOM_HUES = 12;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const FINDING_COLOR = "#ff7a45";
const UNREACHABLE_COLOR = "#ff5b5b";
const UNREACHABLE_OPACITY = 0.45;
const SIGHTLINE_OVER_COLOR = "#ff5b5b";
const SIGHTLINE_OK_COLOR = "#9fb0d8";
const UNIQUE_COLOR = "#d98cff";
const UNIQUE_MARGIN = 0.35;

/** Imperative handle on the canvas: the live camera, for turning a pointer into a floor point, and plan navigation. */
export interface CanvasApi {
  camera: THREE.Camera | null;
  size: { width: number; height: number };
  panBy: (dx: number, dy: number) => void;
  zoomAt: (clientX: number, clientY: number, factor: number, rect: DOMRect) => void;
  centerOn: (x: number, z: number) => void;
}

const raycaster = new THREE.Raycaster();
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** The floor point under a screen position, or null when the ray misses the floor. */
export function groundAt(
  api: CanvasApi,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): { x: number; z: number } | null {
  if (!api.camera) return null;
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, api.camera);
  const hit = raycaster.ray.intersectPlane(FLOOR, new THREE.Vector3());
  return hit ? { x: hit.x, z: hit.z } : null;
}

function roomColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${(hash % ROOM_HUES) * (360 / ROOM_HUES)}, 70%, 60%)`;
}

function ring(x: number, z: number, radius: number, y: number): [number, number, number][] {
  return Array.from({ length: RING_SEGMENTS + 1 }, (_, k) => {
    const angle = (k / RING_SEGMENTS) * Math.PI * 2;
    return [x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius];
  });
}

function PlanCamera({ doc, apiRef }: { doc: LevelDocument; apiRef: MutableRefObject<CanvasApi> }) {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const size = useThree((state) => state.size);
  const fitted = useRef(false);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || fitted.current || size.width === 0) return;
    fitted.current = true;
    const zoom =
      Math.min(size.width / (doc.grid.cols * TILE), size.height / (doc.grid.rows * TILE)) *
      PLAN_FIT_MARGIN;
    camera.zoom = zoom;
    camera.position.set(0, PLAN_HEIGHT, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [doc.grid, size]);

  useEffect(() => {
    const api = apiRef.current;
    api.panBy = (dx, dy) => {
      const camera = cameraRef.current;
      if (!camera) return;
      camera.position.x -= dx / camera.zoom;
      camera.position.z -= dy / camera.zoom;
    };
    api.zoomAt = (clientX, clientY, factor, rect) => {
      const camera = cameraRef.current;
      if (!camera) return;
      const before = groundAt(api, rect, clientX, clientY);
      camera.zoom *= factor;
      camera.updateProjectionMatrix();
      const after = groundAt(api, rect, clientX, clientY);
      if (before && after) {
        camera.position.x += before.x - after.x;
        camera.position.z += before.z - after.z;
      }
    };
    api.centerOn = (x, z) => {
      const camera = cameraRef.current;
      if (!camera) return;
      camera.position.set(x, PLAN_HEIGHT, z);
    };
  }, [apiRef]);

  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      up={[0, 0, -1]}
      position={[0, PLAN_HEIGHT, 0]}
      near={CAMERA_NEAR}
      far={CAMERA_FAR}
    />
  );
}

function OrbitView({ apiRef }: { apiRef: MutableRefObject<CanvasApi> }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const [camera, setCamera] = useState<THREE.PerspectiveCamera | null>(null);
  useEffect(() => {
    const api = apiRef.current;
    api.panBy = () => {};
    api.zoomAt = () => {};
    api.centerOn = (x, z) => {
      const orbit = controls.current;
      if (!orbit) return;
      const offset = orbit.object.position.clone().sub(orbit.target);
      orbit.target.set(x, 0, z);
      orbit.object.position.copy(orbit.target).add(offset);
      orbit.update();
    };
  }, [apiRef]);
  return (
    <>
      <PerspectiveCamera
        ref={setCamera}
        makeDefault
        fov={GAME_FOV}
        position={ORBIT_START}
        near={CAMERA_NEAR}
        far={CAMERA_FAR}
      />
      {camera && (
        <OrbitControls ref={controls} camera={camera} makeDefault maxPolarAngle={ORBIT_MAX_POLAR} />
      )}
    </>
  );
}

function CameraProbe({ apiRef }: { apiRef: MutableRefObject<CanvasApi> }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  useEffect(() => {
    apiRef.current.camera = camera;
    apiRef.current.size = size;
  }, [apiRef, camera, size]);
  return null;
}

function OverlayMaterial({
  color,
  opacity,
  onTop,
}: {
  color: string;
  opacity: number;
  onTop: boolean;
}) {
  return (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={opacity}
      depthTest={!onTop}
      depthWrite={false}
      side={THREE.DoubleSide}
    />
  );
}

function GridLines({ doc, y, onTop }: { doc: LevelDocument; y: number; onTop: boolean }) {
  const positions = useMemo(() => {
    const { cols, rows } = doc.grid;
    const halfW = (cols * TILE) / 2;
    const halfD = (rows * TILE) / 2;
    const out: number[] = [];
    for (let i = 0; i <= cols; i++) {
      const x = -halfW + i * TILE;
      out.push(x, y, -halfD, x, y, halfD);
    }
    for (let j = 0; j <= rows; j++) {
      const z = -halfD + j * TILE;
      out.push(-halfW, y, z, halfW, y, z);
    }
    return new Float32Array(out);
  }, [doc.grid, y]);
  return (
    <lineSegments renderOrder={OVERLAY_ORDER} key={positions.length}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={GRID_COLOR} transparent opacity={GRID_OPACITY} depthTest={!onTop} />
    </lineSegments>
  );
}

function rectOutline(
  doc: LevelDocument,
  rect: { i0: number; i1: number; j0: number; j1: number },
  y: number,
): [number, number, number][] {
  const halfW = (doc.grid.cols * TILE) / 2;
  const halfD = (doc.grid.rows * TILE) / 2;
  const x0 = -halfW + rect.i0 * TILE;
  const x1 = -halfW + rect.i1 * TILE;
  const z0 = -halfD + rect.j0 * TILE;
  const z1 = -halfD + rect.j1 * TILE;
  return [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
    [x0, y, z0],
  ];
}

function RectFill({
  doc,
  rect,
  color,
  opacity,
  y,
  onTop,
}: {
  doc: LevelDocument;
  rect: { i0: number; i1: number; j0: number; j1: number };
  color: string;
  opacity: number;
  y: number;
  onTop: boolean;
}) {
  const halfW = (doc.grid.cols * TILE) / 2;
  const halfD = (doc.grid.rows * TILE) / 2;
  const w = (rect.i1 - rect.i0) * TILE;
  const d = (rect.j1 - rect.j0) * TILE;
  return (
    <mesh
      position={[-halfW + rect.i0 * TILE + w / 2, y, -halfD + rect.j0 * TILE + d / 2]}
      rotation-x={-Math.PI / 2}
      renderOrder={OVERLAY_ORDER}
    >
      <planeGeometry args={[w, d]} />
      <OverlayMaterial color={color} opacity={opacity} onTop={onTop} />
    </mesh>
  );
}

function doorSegment(
  doc: LevelDocument,
  door: { axis: "v" | "h"; line: number; cell: number },
  y: number,
  across: boolean,
): [number, number, number][] {
  const halfW = (doc.grid.cols * TILE) / 2;
  const halfD = (doc.grid.rows * TILE) / 2;
  if (door.axis === "v") {
    const x = -halfW + door.line * TILE;
    const z = -halfD + (door.cell + 0.5) * TILE;
    return across
      ? [
          [x - DOOR_MARK_HALF, y, z],
          [x + DOOR_MARK_HALF, y, z],
        ]
      : [
          [x, y, z - TILE / 2],
          [x, y, z + TILE / 2],
        ];
  }
  const z = -halfD + door.line * TILE;
  const x = -halfW + (door.cell + 0.5) * TILE;
  return across
    ? [
        [x, y, z - DOOR_MARK_HALF],
        [x, y, z + DOOR_MARK_HALF],
      ]
    : [
        [x - TILE / 2, y, z],
        [x + TILE / 2, y, z],
      ];
}

/** A point the checks panel wants marked on the plan. */
export interface FocusMark {
  x: number;
  z: number;
}

/**
 * An object's real footprint (the rotated rect the level checks measure) as a
 * closed outline, grown by `margin`; a circle of `fallbackRadius` when the
 * object has no asset card to measure.
 */
function footprintOutline(
  object: LevelObject,
  context: LevelContext,
  fallbackRadius: number,
  y: number,
  margin = 0,
): [number, number, number][] {
  const footprint = objectFootprint(object, context);
  if (!footprint) return ring(object.x, object.z, fallbackRadius + margin, y);
  const { rect } = footprint;
  const corners = rectCorners({ ...rect, halfX: rect.halfX + margin, halfZ: rect.halfZ + margin });
  return [...corners, corners[0]!].map((corner) => [corner.x, y, corner.z]);
}

function UnreachableFloor({
  overlays,
  y,
  onTop,
}: {
  overlays: LevelOverlays;
  y: number;
  onTop: boolean;
}) {
  const positions = useMemo(() => {
    const half = overlays.sampleCell / 2;
    const out = new Float32Array(overlays.unreachable.length * 18);
    overlays.unreachable.forEach((p, k) => {
      const [x0, x1, z0, z1] = [p.x - half, p.x + half, p.z - half, p.z + half];
      out.set([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1], k * 18);
    });
    return out;
  }, [overlays, y]);
  if (positions.length === 0) return null;
  return (
    <mesh renderOrder={OVERLAY_ORDER} key={positions.length}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <OverlayMaterial color={UNREACHABLE_COLOR} opacity={UNREACHABLE_OPACITY} onTop={onTop} />
    </mesh>
  );
}

interface OverlayProps {
  doc: LevelDocument;
  selection: Selection;
  highlights: ReadonlySet<string>;
  preview: Preview;
  radiusOf: (type: string) => number;
  context: LevelContext;
  focus: FocusMark | null;
  overlays: LevelOverlays | null;
  overlayToggles: OverlayToggles;
  uniqueIds: ReadonlySet<string>;
  onTop: boolean;
}

function Overlay({
  doc,
  selection,
  highlights,
  preview,
  radiusOf,
  context,
  focus,
  overlays,
  overlayToggles,
  uniqueIds,
  onTop,
}: OverlayProps) {
  const y = onTop ? OVERLAY_PLAN_Y : OVERLAY_FLOOR_Y;
  const halfW = (doc.grid.cols * TILE) / 2;
  const halfD = (doc.grid.rows * TILE) / 2;
  const selectedObject =
    selection?.kind === "object" ? doc.objects.find((o) => o.id === selection.id) : undefined;
  return (
    <group>
      <GridLines doc={doc} y={y} onTop={onTop} />
      {doc.rooms.map((room) =>
        room.rects.map((rect, index) => {
          const selected =
            selection?.kind === "room" && selection.roomId === room.id && selection.index === index;
          const external = highlights.has(`room:${room.id}`);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a room's rects have no id; their index is their identity in the document
            <group key={`${room.id}:${index}`}>
              <RectFill
                doc={doc}
                rect={rect}
                color={roomColor(room.id)}
                opacity={ROOM_OPACITY}
                y={y}
                onTop={onTop}
              />
              {(selected || external) && (
                <Line
                  points={rectOutline(doc, rect, y)}
                  color={selected ? SELECT_COLOR : EXTERNAL_COLOR}
                  lineWidth={selected ? 3 : 2}
                  depthTest={!onTop}
                  renderOrder={OVERLAY_ORDER + 1}
                />
              )}
            </group>
          );
        }),
      )}
      {onTop &&
        doc.rooms.map((room) => {
          const rect = room.rects[0]!;
          return (
            <Text
              key={`label:${room.id}`}
              position={[
                -halfW + ((rect.i0 + rect.i1) / 2) * TILE,
                y,
                -halfD + ((rect.j0 + rect.j1) / 2) * TILE,
              ]}
              rotation-x={-Math.PI / 2}
              fontSize={LABEL_SIZE}
              color={roomColor(room.id)}
              fillOpacity={0.7}
              renderOrder={OVERLAY_ORDER + 1}
              material-depthTest={false}
            >
              {room.id}
            </Text>
          );
        })}
      {doc.doors.map((door) => {
        const key = doorKey(door);
        return (
          <Line
            key={`door:${key}`}
            points={doorSegment(doc, door, y, false)}
            color={highlights.has(`door:${key}`) ? EXTERNAL_COLOR : DOOR_COLOR}
            lineWidth={4}
            dashed
            dashSize={0.5}
            gapSize={0.3}
            depthTest={!onTop}
            renderOrder={OVERLAY_ORDER + 1}
          />
        );
      })}
      {doc.objects.map((object) => {
        const external = highlights.has(`object:${object.id}`);
        if (!onTop && !external) return null;
        return (
          <Line
            key={`ring:${object.id}`}
            points={footprintOutline(object, context, radiusOf(object.type), y)}
            color={external ? EXTERNAL_COLOR : OBJECT_RING_COLOR}
            lineWidth={external ? 2.5 : 1}
            transparent
            opacity={external ? 1 : 0.35}
            depthTest={!onTop}
            renderOrder={OVERLAY_ORDER + 1}
          />
        );
      })}
      {selectedObject && (
        <>
          <Line
            points={footprintOutline(selectedObject, context, radiusOf(selectedObject.type), y)}
            color={SELECT_COLOR}
            lineWidth={3}
            depthTest={!onTop}
            renderOrder={OVERLAY_ORDER + 2}
          />
          <Line
            points={[
              [selectedObject.x, y, selectedObject.z],
              [
                selectedObject.x + Math.sin(selectedObject.yaw) * radiusOf(selectedObject.type),
                y,
                selectedObject.z + Math.cos(selectedObject.yaw) * radiusOf(selectedObject.type),
              ],
            ]}
            color={SELECT_COLOR}
            lineWidth={3}
            depthTest={!onTop}
            renderOrder={OVERLAY_ORDER + 2}
          />
        </>
      )}
      {(["props", "hunters"] as const).map((team) =>
        doc.spawns[team].map((point, index) => {
          const selected =
            selection?.kind === "spawn" && selection.team === team && selection.index === index;
          const external = highlights.has(`spawn:${team}:${index}`);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: spawn points have no id; the index is their identity in the document
            <group key={`${team}:${index}`}>
              <mesh
                position={[point.x, y, point.z]}
                rotation-x={-Math.PI / 2}
                renderOrder={OVERLAY_ORDER + 1}
              >
                <circleGeometry args={[SPAWN_RADIUS, RING_SEGMENTS]} />
                <OverlayMaterial
                  color={team === "props" ? PROP_SPAWN_COLOR : HUNTER_SPAWN_COLOR}
                  opacity={0.85}
                  onTop={onTop}
                />
              </mesh>
              {(selected || external) && (
                <Line
                  points={ring(point.x, point.z, SPAWN_RADIUS * 1.6, y)}
                  color={selected ? SELECT_COLOR : EXTERNAL_COLOR}
                  lineWidth={2.5}
                  depthTest={!onTop}
                  renderOrder={OVERLAY_ORDER + 2}
                />
              )}
            </group>
          );
        }),
      )}
      {preview.rect && (
        <>
          <RectFill
            doc={doc}
            rect={preview.rect.rect}
            color={preview.rect.valid ? VALID_COLOR : INVALID_COLOR}
            opacity={0.25}
            y={y}
            onTop={onTop}
          />
          <Line
            points={rectOutline(doc, preview.rect.rect, y)}
            color={preview.rect.valid ? VALID_COLOR : INVALID_COLOR}
            lineWidth={2}
            depthTest={!onTop}
            renderOrder={OVERLAY_ORDER + 2}
          />
        </>
      )}
      {preview.edge && (
        <Line
          points={doorSegment(doc, preview.edge.door, y, false)}
          color={preview.edge.valid ? VALID_COLOR : INVALID_COLOR}
          lineWidth={6}
          depthTest={!onTop}
          renderOrder={OVERLAY_ORDER + 2}
        />
      )}
      {preview.ghost && (
        <Line
          points={ring(preview.ghost.x, preview.ghost.z, preview.ghost.radius, y)}
          color={VALID_COLOR}
          lineWidth={2}
          depthTest={!onTop}
          renderOrder={OVERLAY_ORDER + 2}
        />
      )}
      {overlayToggles.unreachable && overlays && (
        <UnreachableFloor overlays={overlays} y={y} onTop={onTop} />
      )}
      {overlayToggles.sightlines &&
        overlays?.sightlines.map(({ room, line }) => (
          <Line
            key={`sight:${room}`}
            points={[
              [line.from.x, y, line.from.z],
              [line.to.x, y, line.to.z],
            ]}
            color={line.length > LEVEL_SIGHTLINE_MAX ? SIGHTLINE_OVER_COLOR : SIGHTLINE_OK_COLOR}
            lineWidth={3}
            dashed={line.length <= LEVEL_SIGHTLINE_MAX}
            dashSize={0.6}
            gapSize={0.4}
            depthTest={!onTop}
            renderOrder={OVERLAY_ORDER + 2}
          />
        ))}
      {overlayToggles.unique &&
        doc.objects
          .filter((object) => uniqueIds.has(object.id))
          .map((object) => (
            <Line
              key={`unique:${object.id}`}
              points={footprintOutline(object, context, radiusOf(object.type), y, UNIQUE_MARGIN)}
              color={UNIQUE_COLOR}
              lineWidth={2.5}
              depthTest={!onTop}
              renderOrder={OVERLAY_ORDER + 2}
            />
          ))}
      {focus && (
        <Line
          points={ring(focus.x, focus.z, TILE / 2, y)}
          color={FINDING_COLOR}
          lineWidth={3}
          depthTest={!onTop}
          renderOrder={OVERLAY_ORDER + 2}
        />
      )}
    </group>
  );
}

function Lighting({
  map,
  theme,
  orbit,
}: {
  map: MapDefinition;
  theme: ThemePreset;
  orbit: boolean;
}) {
  return (
    <>
      <color attach="background" args={[theme.background]} />
      {orbit && theme.sky === "stars" && <Stars fade speed={0} />}
      <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
      <ambientLight intensity={theme.ambient} />
      <directionalLight position={SUN_POSITION} intensity={theme.dir} color={theme.dirColor} />
      {theme.deckLights && <DeckLights map={map} preset={theme.deckLights} />}
    </>
  );
}

export interface EditorCanvasProps extends Omit<OverlayProps, "onTop"> {
  map: MapDefinition;
  theme: ThemePreset;
  view: EditorView;
  apiRef: MutableRefObject<CanvasApi>;
}

/**
 * The editor's scene: the compiled map drawn by the game's own renderers
 * (tiles, fitted props, the theme's lights) under a plan overlay of rooms,
 * doors, footprints and spawns. The plan view is an orthographic camera looking
 * straight down; the orbit view is a free perspective camera over the same scene.
 */
export function EditorCanvas({ map, theme, view, apiRef, ...overlay }: EditorCanvasProps) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }}>
      <CameraProbe apiRef={apiRef} />
      {view === "plan" ? (
        <PlanCamera doc={overlay.doc} apiRef={apiRef} />
      ) : (
        <OrbitView apiRef={apiRef} />
      )}
      <Lighting map={map} theme={theme} orbit={view === "orbit"} />
      <Suspense fallback={null}>
        <MapView map={map} groundColor={theme.ground} />
      </Suspense>
      <Suspense fallback={null}>
        <Overlay {...overlay} onTop={view === "plan"} />
      </Suspense>
    </Canvas>
  );
}
