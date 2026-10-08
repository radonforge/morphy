import { gateClearances, type Rect2 } from "@morphy/level";
import {
  ASSET_CARDS,
  ASSET_TAGS,
  computePropBounds,
  FRONT_YAW,
  fittedExtent,
  type MapDefinition,
  type ModelMount,
  type ModelSymmetry,
  type PropBounds,
  type ShapeExtent,
  UNTRANSFORMED_PROP_HEIGHT,
  UNTRANSFORMED_PROP_RADIUS,
} from "@morphy/shared";
import { buildObstacles, buildWalls, type Obstacle, type Wall } from "./collision";
import { buildNavGrid, type NavGrid } from "./nav/grid";
import { inscribedExtent, SightIndex } from "./perception";

/**
 * How a catalog shape stands: the extent it renders at, its bounding
 * cylinder, and what its asset tags say geometry cannot (where it belongs,
 * how many quarter turns leave it looking the same, and the yaw that turns
 * its model's +Z onto its front).
 */
export interface Shape {
  extent: ShapeExtent;
  bounds: PropBounds;
  mount: ModelMount;
  symmetry: ModelSymmetry;
  frontYaw: number;
}

/** The cylinder a player wearing no disguise, or one the map does not list, is measured by. */
export const UNTRANSFORMED_BOUNDS: PropBounds = {
  radius: UNTRANSFORMED_PROP_RADIUS,
  yMin: 0,
  yMax: UNTRANSFORMED_PROP_HEIGHT,
};

export const UNTRANSFORMED_EXTENT = inscribedExtent(UNTRANSFORMED_BOUNDS);

/** What a shape with no catalog entry stands as: a floor object the size of the player capsule. */
const UNKNOWN_MOUNT: ModelMount = "floor";
const UNKNOWN_SYMMETRY: ModelSymmetry = 1;

/**
 * What a bot knows of a map without perceiving anything: its layout, the
 * walls and furniture it walks round and sees past, and how every catalog
 * shape stands. Built once per map and shared by the reflex, which moves and
 * looks through it, and the policy, which plans where to hide and run with it.
 * It holds nothing about players: what moves is perceived, never looked up.
 */
export class Terrain {
  readonly walls: Wall[];
  readonly obstacles: Obstacle[];
  readonly grid: NavGrid;
  readonly sight: SightIndex;
  /** The floor kept clear either side of each doorway, as the level checks keep it. */
  readonly doorClearance: Rect2[];
  private readonly shapes = new Map<string, Shape>();

  constructor(readonly map: MapDefinition) {
    this.walls = buildWalls(map);
    this.obstacles = buildObstacles(map);
    this.grid = buildNavGrid(map.bounds, this.walls, this.obstacles);
    this.sight = new SightIndex(map);
    this.doorClearance = gateClearances(map.tiles);
    for (const def of map.propCatalog) {
      const bounds = computePropBounds(def);
      const tags = ASSET_TAGS[def.model ?? ""];
      this.shapes.set(def.id, {
        extent: fittedExtent(def, ASSET_CARDS) ?? inscribedExtent(bounds),
        bounds,
        mount: tags?.mount ?? UNKNOWN_MOUNT,
        symmetry: tags?.symmetry ?? UNKNOWN_SYMMETRY,
        frontYaw: tags ? FRONT_YAW[tags.front] : 0,
      });
    }
  }

  /** How the catalog shape `type` stands, or undefined for a shape the map does not list. */
  shape(type: string): Shape | undefined {
    return this.shapes.get(type);
  }

  /** The extent `type` renders at, or the player capsule's for a shape the map does not list. */
  extentOf(type: string): ShapeExtent {
    return this.shapes.get(type)?.extent ?? UNTRANSFORMED_EXTENT;
  }
}
