import type { AssetCard, SupportSurface } from "../../packages/shared/src/assetCards";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_BYTE = 5121;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;
const DECIMALS = 1000;
const SURFACE_NORMAL_MIN_Y = 0.98;
const SURFACE_HEIGHT_STEP = 0.02;
const SURFACE_MIN_AREA = 0.01;

type Vec3Tuple = [number, number, number];
type Matrix = number[];

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: Vec3Tuple;
  rotation?: [number, number, number, number];
  scale?: Vec3Tuple;
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  sparse?: unknown;
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteStride?: number;
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
}

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { uri?: string }[];
  skins?: unknown[];
}

interface Glb {
  gltf: Gltf;
  bin: Buffer | null;
}

const COMPONENT_BYTES: Record<number, number> = {
  [COMPONENT_FLOAT]: 4,
  [COMPONENT_UNSIGNED_BYTE]: 1,
  [COMPONENT_UNSIGNED_SHORT]: 2,
  [COMPONENT_UNSIGNED_INT]: 4,
};

const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function round(value: number): number {
  const rounded = Math.round(value * DECIMALS) / DECIMALS;
  return rounded === 0 ? 0 : rounded;
}

function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

function parseGlb(bytes: Buffer, model: string): Glb {
  if (bytes.readUInt32LE(0) !== GLB_MAGIC || bytes.readUInt32LE(4) !== GLB_VERSION) {
    throw new Error(`${model}: not a GLB 2.0 container`);
  }
  let gltf: Gltf | null = null;
  let bin: Buffer | null = null;
  let offset = GLB_HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + CHUNK_HEADER_BYTES, offset + CHUNK_HEADER_BYTES + length);
    if (type === GLB_JSON_CHUNK) gltf = JSON.parse(body.toString("utf8")) as Gltf;
    else if (type === GLB_BIN_CHUNK && bin === null) bin = body;
    offset += CHUNK_HEADER_BYTES + length;
  }
  if (gltf === null) throw new Error(`${model}: GLB has no JSON chunk`);
  return { gltf, bin };
}

function nodeMatrix(node: GltfNode): Matrix {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function transform(m: Matrix, [x, y, z]: Vec3Tuple): Vec3Tuple {
  const at = (i: number) => m[i] ?? 0;
  return [
    at(0) * x + at(4) * y + at(8) * z + at(12),
    at(1) * x + at(5) * y + at(9) * z + at(13),
    at(2) * x + at(6) * y + at(10) * z + at(14),
  ];
}

function required<T>(value: T | undefined, model: string, what: string): T {
  if (value === undefined) throw new Error(`${model}: missing ${what}`);
  return value;
}

function readAccessor(glb: Glb, index: number, model: string): number[][] {
  const accessor = required(glb.gltf.accessors?.[index], model, `accessor ${index}`);
  if (accessor.sparse !== undefined) throw new Error(`${model}: sparse accessor ${index}`);
  const viewIndex = required(accessor.bufferView, model, `bufferView of accessor ${index}`);
  const view = required(glb.gltf.bufferViews?.[viewIndex], model, `bufferView ${viewIndex}`);
  const buffer = glb.gltf.buffers?.[view.buffer];
  if (view.buffer !== 0 || buffer === undefined || buffer.uri !== undefined || glb.bin === null) {
    throw new Error(`${model}: buffer ${view.buffer} is not the embedded GLB chunk`);
  }
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  if (componentBytes === undefined || components === undefined) {
    throw new Error(`${model}: unsupported accessor ${index} (${accessor.type})`);
  }
  const stride = view.byteStride ?? componentBytes * components;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const bin = glb.bin;
  const rows: number[][] = [];
  for (let i = 0; i < accessor.count; i++) {
    const row: number[] = [];
    for (let c = 0; c < components; c++) {
      const at = base + i * stride + c * componentBytes;
      switch (accessor.componentType) {
        case COMPONENT_FLOAT:
          row.push(bin.readFloatLE(at));
          break;
        case COMPONENT_UNSIGNED_BYTE:
          row.push(bin.readUInt8(at));
          break;
        case COMPONENT_UNSIGNED_SHORT:
          row.push(bin.readUInt16LE(at));
          break;
        default:
          row.push(bin.readUInt32LE(at));
      }
    }
    rows.push(row);
  }
  return rows;
}

interface MeshVisit {
  matrix: Matrix;
  primitive: GltfPrimitive;
}

function visitPrimitives(glb: Glb, model: string): MeshVisit[] {
  const { gltf } = glb;
  if (gltf.skins && gltf.skins.length > 0)
    throw new Error(`${model}: skinned models are unsupported`);
  const sceneIndex = gltf.scene ?? 0;
  const scene = required(gltf.scenes?.[sceneIndex], model, `scene ${sceneIndex}`);
  const visits: MeshVisit[] = [];
  const walk = (index: number, parent: Matrix): void => {
    const node = required(gltf.nodes?.[index], model, `node ${index}`);
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = required(gltf.meshes?.[node.mesh], model, `mesh ${node.mesh}`);
      for (const primitive of mesh.primitives) visits.push({ matrix, primitive });
    }
    for (const child of node.children ?? []) walk(child, matrix);
  };
  for (const root of scene.nodes ?? []) walk(root, IDENTITY);
  return visits;
}

function positionAccessor(glb: Glb, primitive: GltfPrimitive, model: string): number {
  const index = required(primitive.attributes.POSITION, model, "POSITION attribute");
  const accessor = required(glb.gltf.accessors?.[index], model, `accessor ${index}`);
  if (accessor.componentType !== COMPONENT_FLOAT || accessor.type !== "VEC3") {
    throw new Error(`${model}: POSITION accessor ${index} is not float VEC3`);
  }
  return index;
}

function extractBounds(glb: Glb, visits: MeshVisit[], model: string) {
  const lo: Vec3Tuple = [Infinity, Infinity, Infinity];
  const hi: Vec3Tuple = [-Infinity, -Infinity, -Infinity];
  for (const { matrix, primitive } of visits) {
    const index = positionAccessor(glb, primitive, model);
    const accessor = required(glb.gltf.accessors?.[index], model, `accessor ${index}`);
    if (accessor.sparse !== undefined) throw new Error(`${model}: sparse accessor ${index}`);
    const min = required(accessor.min, model, `min of accessor ${index}`);
    const max = required(accessor.max, model, `max of accessor ${index}`);
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          const p = transform(matrix, [x ?? 0, y ?? 0, z ?? 0]);
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k] ?? Infinity, p[k] ?? Infinity);
            hi[k] = Math.max(hi[k] ?? -Infinity, p[k] ?? -Infinity);
          }
        }
      }
    }
  }
  if (!Number.isFinite(lo[0]))
    throw new Error(`${model}: no mesh geometry under the default scene`);
  return { lo, hi };
}

function extractSurfaces(glb: Glb, visits: MeshVisit[], model: string): SupportSurface[] {
  const buckets = new Map<number, number>();
  for (const { matrix, primitive } of visits) {
    if ((primitive.mode ?? 4) !== 4) throw new Error(`${model}: non-triangle primitive mode`);
    const positions = readAccessor(glb, positionAccessor(glb, primitive, model), model).map((p) =>
      transform(matrix, [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]),
    );
    const indices =
      primitive.indices === undefined
        ? positions.map((_, i) => i)
        : readAccessor(glb, primitive.indices, model).map((row) => row[0] ?? 0);
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = positions[indices[t] ?? 0];
      const b = positions[indices[t + 1] ?? 0];
      const c = positions[indices[t + 2] ?? 0];
      if (!a || !b || !c) throw new Error(`${model}: triangle index out of range`);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as Vec3Tuple;
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as Vec3Tuple;
      const nx = u[1] * v[2] - u[2] * v[1];
      const ny = u[2] * v[0] - u[0] * v[2];
      const nz = u[0] * v[1] - u[1] * v[0];
      const twiceArea = Math.hypot(nx, ny, nz);
      if (twiceArea > 0 && ny / twiceArea > SURFACE_NORMAL_MIN_Y) {
        const bucket = roundHalfEven((a[1] + b[1] + c[1]) / 3 / SURFACE_HEIGHT_STEP);
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + twiceArea / 2);
      }
    }
  }
  return [...buckets]
    .filter(([, area]) => area > SURFACE_MIN_AREA)
    .map(([bucket, area]) => ({ y: round(bucket * SURFACE_HEIGHT_STEP), area: round(area) }))
    .sort((a, b) => b.y - a.y);
}

/** Read one GLB and derive its asset card. Throws with the model path on anything unsupported. */
export function extractAssetCard(bytes: Buffer, model: string): AssetCard {
  const glb = parseGlb(bytes, model);
  const visits = visitPrimitives(glb, model);
  const { lo, hi } = extractBounds(glb, visits, model);
  const [x0, y0, z0] = lo as Vec3Tuple;
  const [x1, y1, z1] = hi as Vec3Tuple;
  return {
    model,
    size: { x: round(x1 - x0), y: round(y1 - y0), z: round(z1 - z0) },
    center: { x: round((x1 + x0) / 2), y: round((y1 + y0) / 2), z: round((z1 + z0) / 2) },
    minY: round(y0),
    surfaces: extractSurfaces(glb, visits, model),
  };
}
