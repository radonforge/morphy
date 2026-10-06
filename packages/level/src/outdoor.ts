import {
  ASSET_CARDS,
  type AssetCard,
  type BoxCollider,
  type DoorFacing,
  type GroundKind,
  type GroundPatch,
  type MapLight,
  type SceneryInstance,
  type Vec3,
} from "@morphy/shared";
import type {
  BlockZone,
  CellRect,
  LampFixture,
  LevelBlock,
  LevelDocument,
  LevelLight,
} from "./document";
import { TILE } from "./floorplan";

const RESIDENTIAL_KIT = "/models/urban";
const COMMERCIAL_KIT = "/models/urban/commercial";
const INDUSTRIAL_KIT = "/models/urban/industrial";
const ROADS_KIT = "/models/urban/roads";

const kitModels = (kit: string, prefix: string, letters: string): string[] =>
  [...letters].map((letter) => `${kit}/${prefix}${letter}.glb`);

/** The buildings that dress a block of each zone, one per lot. */
const ZONE_BUILDINGS: Record<BlockZone, readonly string[]> = {
  residential: kitModels(RESIDENTIAL_KIT, "building-type-", "abcdefghjklmnoprstu"),
  commercial: kitModels(COMMERCIAL_KIT, "building-", "abcdefghijkln"),
  industrial: kitModels(INDUSTRIAL_KIT, "building-", "abcegkmprst"),
};

/** Low sheds for a strip one cell deep, where a full building would not fit. */
const SHED_BUILDINGS = kitModels(INDUSTRIAL_KIT, "building-", "kps");

/** Buildings a block may name on its own: landmarks that are not part of any zone's fill. */
const LANDMARK_BUILDINGS = [
  `${COMMERCIAL_KIT}/building-m.glb`,
  `${COMMERCIAL_KIT}/building-skyscraper-a.glb`,
  `${COMMERCIAL_KIT}/building-skyscraper-b.glb`,
  `${COMMERCIAL_KIT}/building-skyscraper-c.glb`,
  `${COMMERCIAL_KIT}/building-skyscraper-d.glb`,
  `${COMMERCIAL_KIT}/building-skyscraper-e.glb`,
  `${INDUSTRIAL_KIT}/chimney-large.glb`,
];

/** Facades standing just outside the map wherever open ground meets its edge. */
const BACKDROP_BUILDINGS = kitModels(COMMERCIAL_KIT, "low-detail-building-", "abcdefghijklmn");

/** Every building model a block may name with `building`. */
export const OUTDOOR_BUILDING_MODELS: readonly string[] = [
  ...new Set([
    ...ZONE_BUILDINGS.residential,
    ...ZONE_BUILDINGS.commercial,
    ...ZONE_BUILDINGS.industrial,
    ...LANDMARK_BUILDINGS,
  ]),
];

/**
 * A street lamp of the road kit. Its pole stands on the model origin, and `head`, in
 * model units from the pole before the lamp's yaw, is where its light hangs: under the
 * end of the arm (-Z) for a one-armed lamp, over the pole for the symmetric ones.
 * Measured from the asset cards; `tests/level-outdoor.test.mjs` holds each head inside
 * its model's footprint.
 */
interface Fixture {
  model: string;
  head: { x: number; z: number };
}

const FIXTURES: Record<LampFixture, Fixture> = {
  curved: { model: `${ROADS_KIT}/light-curved.glb`, head: { x: 0, z: -0.175 } },
  "curved-double": { model: `${ROADS_KIT}/light-curved-double.glb`, head: { x: 0, z: 0 } },
  "curved-cross": { model: `${ROADS_KIT}/light-curved-cross.glb`, head: { x: 0, z: 0 } },
  square: { model: `${ROADS_KIT}/light-square.glb`, head: { x: 0, z: -0.19 } },
  "square-double": { model: `${ROADS_KIT}/light-square-double.glb`, head: { x: 0, z: 0 } },
  "square-cross": { model: `${ROADS_KIT}/light-square-cross.glb`, head: { x: 0, z: 0 } },
};

/** Every model an outdoor document can compile to, for any document. */
export const OUTDOOR_MODEL_PATHS: readonly string[] = [
  ...new Set([
    ...OUTDOOR_BUILDING_MODELS,
    ...SHED_BUILDINGS,
    ...BACKDROP_BUILDINGS,
    ...Object.values(FIXTURES).map((fixture) => fixture.model),
  ]),
];

/** Kit units to metres for a street lamp: a 5.4 m pole for the curved one. */
const LAMP_SCALE = 8;
export const LAMP_POLE_WIDTH = 0.3;
/** How far below the top of a lamp model its head's underside hangs, where the bulb glows, in model units. */
const LAMP_HEAD_DEPTH = 0.025;
/** How far past its lot's edge the ground must be walkable for a doorway to be an entrance. */
const ENTRANCE_PROBE = 0.5;
const FACING_AXIS: Record<DoorFacing, { x: number; z: number }> = {
  "+x": { x: 1, z: 0 },
  "-x": { x: -1, z: 0 },
  "+z": { x: 0, z: 1 },
  "-z": { x: 0, z: -1 },
};
/** The longest side of a lot before a block is split into more buildings. */
const LOT_MAX_SIDE = 11;
/** A fit within this much of the best coverage counts as just as good, so lots vary. */
const FIT_SLACK = 0.04;
/** A rect this many cells deep or less gets sheds instead of buildings. */
const SHED_MAX_CELLS = 1;
const PERIMETER_HEIGHT = 10;
const PERIMETER_THICKNESS = 1;
const BACKDROP_DEPTH = 8;
const QUARTER_TURN = Math.PI / 2;
/** Slack when a lot edge in metres is turned into a cell index, so an exact edge is not rounded past. */
const CELL_EPSILON = 1e-9;

/** The geometry an outdoor document adds to its map. */
export interface OutdoorParts {
  colliders: BoxCollider[];
  scenery: SceneryInstance[];
  ground: GroundPatch[];
  lights?: MapLight[];
}

interface Emitted {
  colliders: BoxCollider[];
  scenery: SceneryInstance[];
  /** Filled only when asked for: each building's doorways, carried out to its lot's edge. */
  doors?: Entrance[];
}

interface Lot {
  minX: number;
  minZ: number;
  w: number;
  d: number;
}

interface Fit {
  model: string;
  card: AssetCard;
  turns: number;
  scale: number;
  cover: number;
}

function cardFor(model: string): AssetCard {
  const card = ASSET_CARDS[model];
  if (card === undefined) {
    throw new Error(`no asset card for outdoor model ${model}; run pnpm cards`);
  }
  return card;
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let k = 0; k < text.length; k++) {
    hash ^= text.charCodeAt(k);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function splitLength(length: number): number[] {
  const count = Math.max(1, Math.ceil(length / LOT_MAX_SIDE - 1e-9));
  return new Array<number>(count).fill(length / count);
}

/** Every model of `pool` at both footprint turns, scaled uniformly into a `w` x `d` lot. */
function allFits(pool: readonly string[], w: number, d: number): Fit[] {
  const fits: Fit[] = [];
  for (const model of pool) {
    const card = cardFor(model);
    for (const turns of [0, 1]) {
      const fx = turns === 0 ? card.size.x : card.size.z;
      const fz = turns === 0 ? card.size.z : card.size.x;
      const scale = Math.min(w / fx, d / fz);
      fits.push({ model, card, turns, scale, cover: (fx * scale * fz * scale) / (w * d) });
    }
  }
  return fits;
}

/**
 * The fits of `pool` within {@link FIT_SLACK} of the best cover, in a fixed order
 * (code-unit string order, never locale order, so every runtime picks alike).
 */
function bestFits(pool: readonly string[], w: number, d: number): Fit[] {
  const fits = allFits(pool, w, d);
  const top = Math.max(...fits.map((fit) => fit.cover));
  return fits
    .filter((fit) => fit.cover >= top - FIT_SLACK)
    .sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : a.turns - b.turns));
}

/**
 * The `index`-th of the good fits that can face `front` (quarter turns), or of all
 * the good fits when none can: a fit lying the other way round would turn the
 * building's front 90 degrees off the street.
 */
function pickFit(fits: readonly Fit[], front: number, index: number): Fit {
  const facing = fits.filter((fit) => fit.turns === front % 2);
  const pool = facing.length > 0 ? facing : fits;
  return pool[index % pool.length]!;
}

/** Rotate a model-space offset by `yaw` about +Y, the way three.js turns an object. */
function turn(x: number, z: number, yaw: number): { x: number; z: number } {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}

/**
 * Seat `fit` on `lot`: its footprint centred on the lot, its front (+Z) toward
 * `front` quarter turns when that keeps the fitted footprint, and the collider
 * covering the whole lot at the building's height, so no gap opens between neighbours.
 */
function placeBuilding(fit: Fit, lot: Lot, front: number, out: Emitted): void {
  const turns = (front - fit.turns) % 2 === 0 ? front : fit.turns;
  const yaw = turns * QUARTER_TURN;
  const cx = lot.minX + lot.w / 2;
  const cz = lot.minZ + lot.d / 2;
  const offset = turn(fit.card.center.x * fit.scale, fit.card.center.z * fit.scale, yaw);
  const height = fit.card.size.y * fit.scale;
  out.scenery.push({
    model: fit.model,
    position: { x: cx - offset.x, y: -fit.card.minY * fit.scale, z: cz - offset.z },
    rotationY: yaw,
    scale: fit.scale,
  });
  out.colliders.push({
    position: { x: cx, y: height / 2, z: cz },
    size: { x: lot.w, y: height, z: lot.d },
  });
  for (const door of out.doors ? (fit.card.doors ?? []) : []) {
    const at = turn(door.x * fit.scale, door.z * fit.scale, yaw);
    const axis = FACING_AXIS[door.facing];
    const way = turn(axis.x, axis.z, yaw);
    const nx = Math.round(way.x) || 0;
    const nz = Math.round(way.z) || 0;
    const edgeX = nx > 0 ? lot.minX + lot.w : lot.minX;
    const edgeZ = nz > 0 ? lot.minZ + lot.d : lot.minZ;
    out.doors?.push({
      x: nx === 0 ? cx - offset.x + at.x : edgeX,
      z: nz === 0 ? cz - offset.z + at.z : edgeZ,
      width: door.width * fit.scale,
      nx,
      nz,
    });
  }
}

/** World-space rectangle of a cell rect. */
function rectLot(halfW: number, halfD: number, rect: CellRect): Lot {
  return {
    minX: -halfW + rect.i0 * TILE,
    minZ: -halfD + rect.j0 * TILE,
    w: (rect.i1 - rect.i0) * TILE,
    d: (rect.j1 - rect.j0) * TILE,
  };
}

/**
 * Quarter turns that face a lot's front onto the most open ground: 0 is +Z, 1 is +X,
 * 2 is -Z, 3 is -X, the way {@link turn} carries the model's +Z.
 */
function openSide(
  lot: Lot,
  halfW: number,
  halfD: number,
  walkable: (i: number, j: number) => boolean,
): number {
  const i0 = Math.floor((lot.minX + halfW) / TILE + CELL_EPSILON);
  const i1 = Math.ceil((lot.minX + lot.w + halfW) / TILE - CELL_EPSILON);
  const j0 = Math.floor((lot.minZ + halfD) / TILE + CELL_EPSILON);
  const j1 = Math.ceil((lot.minZ + lot.d + halfD) / TILE - CELL_EPSILON);
  const along = (from: number, to: number, cell: (k: number) => boolean): number => {
    let open = 0;
    for (let k = from; k < to; k++) if (cell(k)) open++;
    return open;
  };
  const sides = [
    along(i0, i1, (i) => walkable(i, j1)),
    along(j0, j1, (j) => walkable(i1, j)),
    along(i0, i1, (i) => walkable(i, j0 - 1)),
    along(j0, j1, (j) => walkable(i0 - 1, j)),
  ];
  let best = 0;
  for (let side = 1; side < sides.length; side++) if (sides[side]! > sides[best]!) best = side;
  return best;
}

function emitBlock(
  block: LevelBlock,
  halfW: number,
  halfD: number,
  walkable: (i: number, j: number) => boolean,
  out: Emitted,
): void {
  const salt = stableHash(block.id);
  if (block.building !== undefined) {
    const lot = rectLot(halfW, halfD, block.rects[0]!);
    const front = ((Math.round((block.yaw ?? 0) / QUARTER_TURN) % 4) + 4) % 4;
    const fit = allFits([block.building], lot.w, lot.d).find((f) => f.turns === front % 2)!;
    placeBuilding(fit, lot, front, out);
    return;
  }
  let lotIndex = 0;
  for (const rect of block.rects) {
    const area = rectLot(halfW, halfD, rect);
    const shed = Math.min(rect.i1 - rect.i0, rect.j1 - rect.j0) <= SHED_MAX_CELLS;
    const pool = shed ? SHED_BUILDINGS : ZONE_BUILDINGS[block.zone];
    let minZ = area.minZ;
    for (const d of splitLength(area.d)) {
      let minX = area.minX;
      for (const w of splitLength(area.w)) {
        const lot = { minX, minZ, w, d };
        const front = openSide(lot, halfW, halfD, walkable);
        placeBuilding(pickFit(bestFits(pool, w, d), front, salt + lotIndex), lot, front, out);
        lotIndex++;
        minX += w;
      }
      minZ += d;
    }
  }
}

interface CellRun<K> {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
  key: K;
}

/** Merge cells with the same non-null key into rectangles: runs along each row, stacked down while they match. */
function mergeCells<K>(
  cols: number,
  rows: number,
  keyAt: (i: number, j: number) => K | null,
): CellRun<K>[] {
  const used: boolean[][] = Array.from({ length: cols }, () =>
    new Array<boolean>(rows).fill(false),
  );
  const runs: CellRun<K>[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const key = keyAt(i, j);
      if (key === null || used[i]![j]) continue;
      let i1 = i + 1;
      while (i1 < cols && keyAt(i1, j) === key && !used[i1]![j]) i1++;
      let j1 = j + 1;
      const rowMatches = (row: number): boolean => {
        for (let k = i; k < i1; k++) if (keyAt(k, row) !== key || used[k]![row]) return false;
        return true;
      };
      while (j1 < rows && rowMatches(j1)) j1++;
      for (let k = i; k < i1; k++) for (let row = j; row < j1; row++) used[k]![row] = true;
      runs.push({ i0: i, i1, j0: j, j1, key });
    }
  }
  return runs;
}

/** A wall nobody sees round the grid border, and one over every cell that is neither ground nor block. */
function perimeter(
  cols: number,
  rows: number,
  halfW: number,
  halfD: number,
  isVoid: (i: number, j: number) => boolean,
): BoxCollider[] {
  const y = PERIMETER_HEIGHT / 2;
  const t = PERIMETER_THICKNESS;
  const colliders: BoxCollider[] = [
    {
      position: { x: 0, y, z: -halfD - t / 2 },
      size: { x: 2 * halfW + 2 * t, y: PERIMETER_HEIGHT, z: t },
    },
    {
      position: { x: 0, y, z: halfD + t / 2 },
      size: { x: 2 * halfW + 2 * t, y: PERIMETER_HEIGHT, z: t },
    },
    { position: { x: -halfW - t / 2, y, z: 0 }, size: { x: t, y: PERIMETER_HEIGHT, z: 2 * halfD } },
    { position: { x: halfW + t / 2, y, z: 0 }, size: { x: t, y: PERIMETER_HEIGHT, z: 2 * halfD } },
  ];
  for (const run of mergeCells(cols, rows, (i, j) => (isVoid(i, j) ? true : null))) {
    const lot = rectLot(halfW, halfD, run);
    colliders.push({
      position: { x: lot.minX + lot.w / 2, y, z: lot.minZ + lot.d / 2 },
      size: { x: lot.w, y: PERIMETER_HEIGHT, z: lot.d },
    });
  }
  return colliders;
}

/** Facades just outside every stretch of the border where open ground meets the map's edge. */
function backdrop(
  cols: number,
  rows: number,
  halfW: number,
  halfD: number,
  walkable: (i: number, j: number) => boolean,
): SceneryInstance[] {
  const out = { colliders: [] as BoxCollider[], scenery: [] as SceneryInstance[] };
  const runs = (count: number, open: (k: number) => boolean): [number, number][] => {
    const found: [number, number][] = [];
    let start = -1;
    for (let k = 0; k <= count; k++) {
      const here = k < count && open(k);
      if (here && start < 0) start = k;
      if (!here && start >= 0) {
        found.push([start, k]);
        start = -1;
      }
    }
    return found;
  };
  const sides: {
    lots: (from: number, to: number) => Lot;
    front: number;
    along: number;
    open: (k: number) => boolean;
  }[] = [
    {
      along: cols,
      open: (i) => walkable(i, 0),
      front: 0,
      lots: (a, b) => ({
        minX: -halfW + a * TILE,
        minZ: -halfD - BACKDROP_DEPTH,
        w: (b - a) * TILE,
        d: BACKDROP_DEPTH,
      }),
    },
    {
      along: cols,
      open: (i) => walkable(i, rows - 1),
      front: 2,
      lots: (a, b) => ({
        minX: -halfW + a * TILE,
        minZ: halfD,
        w: (b - a) * TILE,
        d: BACKDROP_DEPTH,
      }),
    },
    {
      along: rows,
      open: (j) => walkable(0, j),
      front: 1,
      lots: (a, b) => ({
        minX: -halfW - BACKDROP_DEPTH,
        minZ: -halfD + a * TILE,
        w: BACKDROP_DEPTH,
        d: (b - a) * TILE,
      }),
    },
    {
      along: rows,
      open: (j) => walkable(cols - 1, j),
      front: 3,
      lots: (a, b) => ({
        minX: halfW,
        minZ: -halfD + a * TILE,
        w: BACKDROP_DEPTH,
        d: (b - a) * TILE,
      }),
    },
  ];
  let index = 0;
  for (const side of sides) {
    for (const [a, b] of runs(side.along, side.open)) {
      const span = side.lots(a, b);
      const horizontal = side.front % 2 === 0;
      const pieces = splitLength(horizontal ? span.w : span.d);
      let offset = 0;
      for (const length of pieces) {
        const lot: Lot = horizontal
          ? { minX: span.minX + offset, minZ: span.minZ, w: length, d: span.d }
          : { minX: span.minX, minZ: span.minZ + offset, w: span.w, d: length };
        const fits = bestFits(BACKDROP_BUILDINGS, lot.w, lot.d);
        placeBuilding(pickFit(fits, side.front, index), lot, side.front, out);
        index++;
        offset += length;
      }
    }
  }
  return out.scenery;
}

function emitLamps(
  lights: readonly LevelLight[],
  out: { colliders: BoxCollider[]; scenery: SceneryInstance[] },
): MapLight[] {
  return lights.map((light) => {
    const mapLight: MapLight = { id: light.id, x: light.x, z: light.z, kind: light.kind };
    if (light.fixture === undefined) return mapLight;
    const lamp = streetLamp(light.fixture, light.x, light.z, light.yaw ?? 0);
    out.scenery.push(lamp.scenery);
    out.colliders.push({
      position: { x: light.x, y: lamp.height / 2, z: light.z },
      size: { x: LAMP_POLE_WIDTH, y: lamp.height, z: LAMP_POLE_WIDTH },
    });
    return { ...mapLight, x: lamp.head.x, z: lamp.head.z, y: lamp.head.y };
  });
}

/** A street lamp as it stands in a map: its model, its height and where its head's light hangs. */
export interface StreetLamp {
  scenery: SceneryInstance;
  height: number;
  head: Vec3;
  /** The centre of the lamp's footprint, which its arm pulls off the pole. */
  centre: { x: number; z: number };
}

/**
 * The lamp of `fixture` with its pole at `x`/`z`, turned by `yaw`, at `scale`: what a
 * document's lamp compiles to, and what the lobby stands in its North District diorama
 * (at the diorama's own scale, placed by `centre`), so the two hang their light from the
 * same head.
 */
export function streetLamp(
  fixture: LampFixture,
  x: number,
  z: number,
  yaw: number,
  scale = LAMP_SCALE,
): StreetLamp {
  const { model, head } = FIXTURES[fixture];
  const card = cardFor(model);
  const height = card.size.y * scale;
  const arm = turn(head.x * scale, head.z * scale, yaw);
  const centre = turn(card.center.x * scale, card.center.z * scale, yaw);
  return {
    scenery: { model, position: { x, y: 0, z }, rotationY: yaw, scale },
    height,
    head: { x: x + arm.x, y: height - LAMP_HEAD_DEPTH * scale, z: z + arm.z },
    centre: { x: x + centre.x, z: z + centre.z },
  };
}

/**
 * A building's doorway onto open ground, in world space: where its way out meets the
 * edge of the building's lot (the lot's collider covers any inset in front of the
 * facade), the doorway's width and the axis it opens along.
 */
export interface Entrance {
  x: number;
  z: number;
  width: number;
  nx: number;
  nz: number;
}

/**
 * The doorways of every block building that open onto walkable ground: the buildings
 * {@link compileOutdoor} seats, each door read off its asset card. Walkable is the same
 * rule the compiler orients buildings by, a cell some room owns. A door that opens onto
 * a neighbour's lot or the map's edge is not an entrance.
 */
export function outdoorEntrances(doc: LevelDocument): Entrance[] {
  const { cols, rows } = doc.grid;
  const halfW = (cols * TILE) / 2;
  const halfD = (rows * TILE) / 2;
  const owned = Array.from({ length: cols }, () => new Array<boolean>(rows).fill(false));
  for (const room of doc.rooms) {
    for (const rect of room.rects) {
      for (let i = rect.i0; i < rect.i1; i++)
        for (let j = rect.j0; j < rect.j1; j++) owned[i]![j] = true;
    }
  }
  const walkable = (i: number, j: number): boolean => owned[i]?.[j] === true;
  const out: Emitted = { colliders: [], scenery: [], doors: [] };
  for (const block of doc.blocks ?? []) emitBlock(block, halfW, halfD, walkable, out);
  return (out.doors ?? []).filter((door) =>
    walkable(
      Math.floor((door.x + door.nx * ENTRANCE_PROBE + halfW) / TILE),
      Math.floor((door.z + door.nz * ENTRANCE_PROBE + halfD) / TILE),
    ),
  );
}

/**
 * Compile the outdoor half of a document: ground patches over its rooms, the
 * buildings and colliders of its blocks, an unseen wall round the map and over any
 * cell left empty, facades beyond the edge where open ground meets it, and a street
 * lamp under every light that names a fixture. Building choice depends only on the
 * block ids, never on a seed, so the colliders are the same every round.
 */
export function compileOutdoor(
  doc: LevelDocument,
  groundOf: (i: number, j: number) => GroundKind | null,
): OutdoorParts {
  const { cols, rows } = doc.grid;
  const halfW = (cols * TILE) / 2;
  const halfD = (rows * TILE) / 2;
  const blockCells: boolean[][] = Array.from({ length: cols }, () =>
    new Array<boolean>(rows).fill(false),
  );
  for (const block of doc.blocks ?? []) {
    for (const rect of block.rects) {
      for (let i = rect.i0; i < rect.i1; i++)
        for (let j = rect.j0; j < rect.j1; j++) blockCells[i]![j] = true;
    }
  }
  const inGrid = (i: number, j: number): boolean => i >= 0 && i < cols && j >= 0 && j < rows;
  const walkable = (i: number, j: number): boolean => inGrid(i, j) && groundOf(i, j) !== null;

  const out = { colliders: [] as BoxCollider[], scenery: [] as SceneryInstance[] };
  for (const block of doc.blocks ?? []) emitBlock(block, halfW, halfD, walkable, out);
  out.colliders.push(
    ...perimeter(cols, rows, halfW, halfD, (i, j) => !walkable(i, j) && !blockCells[i]![j]),
  );
  out.scenery.push(...backdrop(cols, rows, halfW, halfD, walkable));
  const lights = doc.lights === undefined ? undefined : emitLamps(doc.lights, out);
  return {
    colliders: out.colliders,
    scenery: out.scenery,
    ground: mergeCells(cols, rows, groundOf).map((run) => {
      const lot = rectLot(halfW, halfD, run);
      return {
        x: lot.minX + lot.w / 2,
        z: lot.minZ + lot.d / 2,
        w: lot.w,
        d: lot.d,
        kind: run.key,
      };
    }),
    ...(lights !== undefined ? { lights } : {}),
  };
}
