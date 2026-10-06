import type { PropDefinition, Vec3 } from "@morphy/shared";
import { boxProp } from "./propDef";

const ur = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban", id, name, w, h, color);

const rd = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban/roads", id, name, w, h, color);

const ind = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban/industrial", id, name, w, h, color);

const com = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban/commercial", id, name, w, h, color);

const STREET_KIT = "urban/street";

const st = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp(STREET_KIT, id, name, w, h, color);

/** Car Kit units to metres: a sedan about 1.6 m tall beside a City Kit house's 1.9 m door. */
const CAR_SCALE = 1.2;
/** City Kit Roads units to metres, the scale its street lamps stand at. */
const ROAD_KIT_SCALE = 8;

/**
 * A shape that dresses the street but nobody wears, boxed at its model's own
 * proportions (`size`, in kit units, from its asset card) `scale` times over, so a long
 * model keeps a long collider instead of the square one {@link boxProp} gives.
 */
function decor(
  kit: string,
  id: string,
  name: string,
  size: Vec3,
  scale: number,
  color: string,
): PropDefinition {
  return {
    id,
    name,
    model: `/models/${kit}/${id}.glb`,
    decor: true,
    parts: [
      {
        kind: "box",
        position: { x: 0, y: (size.y * scale) / 2, z: 0 },
        size: { x: size.x * scale, y: size.y * scale, z: size.z * scale },
        color,
      },
    ],
  };
}

const car = (id: string, name: string, size: Vec3, color: string): PropDefinition =>
  decor("urban/cars", id, name, size, CAR_SCALE, color);

/**
 * Urban hideables: the street furniture (planters, trees, fences, roadworks, yard
 * clutter) that dresses the sidewalks, plus the `decor` nobody wears (parked cars, a
 * work site's fence).
 *
 * Each width and height is derived from the GLB's own proportions, because the
 * client fits the model uniformly inside them while the server resolves hits
 * against the bounding cylinder they imply: a height that does not match the
 * model's aspect leaves air above it that a hunter can still hit.
 */
export const URBAN_CATALOG: PropDefinition[] = [
  ur("planter", "Planter", 1.1, 0.85, "#6f7a5a"),
  ur("tree-small", "Sapling", 1.1, 2.1, "#3f6b3a"),
  ur("tree-large", "Tree", 1.3, 2.9, "#3f6b3a"),
  ur("fence-1x2", "Fence", 1.2, 0.37, "#9a7b4d"),
  ur("fence-2x2", "Fence corner", 1.3, 0.4, "#9a7b4d"),
  rd("construction-cone", "Cone", 0.5, 0.7, "#e0712a"),
  rd("construction-barrier", "Barrier", 1.2, 0.9, "#d8d2c0"),
  rd("construction-light", "Work light", 0.5, 1.2, "#c8c2a8"),
  rd("bridge-pillar", "Pillar", 0.45, 2.25, "#a8a49a"),
  rd("bridge-pillar-wide", "Wide pillar", 0.6, 2.15, "#a8a49a"),
  ind("chimney-basic", "Chimney", 0.4, 2.0, "#8f6551"),
  ind("chimney-small", "Vent stack", 0.7, 1.75, "#8f6551"),
  com("detail-parasol-a", "Parasol", 1.3, 1.45, "#b5503f"),
  com("detail-parasol-b", "Patio parasol", 1.3, 1.45, "#3f6f8a"),
  st("dumpster", "Dumpster", 1.9, 1.07, "#3f7a5a"),
  decor(
    STREET_KIT,
    "construction-fence",
    "Site fence",
    { x: 0.075, y: 0.179, z: 0.375 },
    ROAD_KIT_SCALE,
    "#8a8fd0",
  ),
  car("sedan", "Sedan", { x: 1.5, y: 1.3, z: 2.55 }, "#d8573c"),
  car("suv", "SUV", { x: 1.5, y: 1.3, z: 2.7 }, "#3f8a5a"),
  car("hatchback-sports", "Hatchback", { x: 1.3, y: 1.1, z: 2.85 }, "#4fae6a"),
  car("taxi", "Taxi", { x: 1.5, y: 1.5, z: 2.75 }, "#f0b03c"),
  car("van", "Van", { x: 1.5, y: 1.35, z: 2.75 }, "#4a6fc8"),
  car("delivery", "Delivery van", { x: 1.5, y: 1.65, z: 3.25 }, "#3f9a6a"),
  car("truck", "Pickup", { x: 1.5, y: 1.3, z: 2.95 }, "#4fae6a"),
];
