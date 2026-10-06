/** The side of a model that is its front: `pz` is +Z of the model, `nx` is -X. */
export type ModelFront = "pz" | "px" | "nz" | "nx";

/** How many quarter turns leave a model looking the same from above: 1 none, 2 a half turn, 4 every one. */
export type ModelSymmetry = 1 | 2 | 4;

/** Where a model belongs: standing free on the floor, backed onto a wall, or on top of another object. */
export type ModelMount = "floor" | "wall" | "surface";

/** Who produced a tag value: `auto` is the proposal the owner kept on review, `human` the owner's correction. */
export type TagSource = "auto" | "human";

/** Review-confirmed judgements about a model that its geometry alone does not settle. */
export interface AssetTags {
  front: ModelFront;
  symmetry: ModelSymmetry;
  mount: ModelMount;
  source: Record<"front" | "symmetry" | "mount", TagSource>;
}

/** Yaw that turns a model's +Z onto its front, in the same sense as a placed object's yaw. */
export const FRONT_YAW: Readonly<Record<ModelFront, number>> = {
  pz: 0,
  px: Math.PI / 2,
  nz: Math.PI,
  nx: -Math.PI / 2,
};

/** Front, symmetry and mount of every catalog prop's model, keyed by model path. */
export const ASSET_TAGS: Readonly<Record<string, AssetTags>> = {
  "/models/space/exterior/barrel.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/exterior/barrels.glb": {
    front: "pz",
    symmetry: 2,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/exterior/desk_chair.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/exterior/desk_computer.glb": {
    front: "nz",
    symmetry: 1,
    mount: "wall",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/exterior/desk_computerCorner.glb": {
    front: "px",
    symmetry: 1,
    mount: "wall",
    source: {
      front: "human",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/exterior/machine_barrel.glb": {
    front: "px",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/exterior/machine_generator.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/exterior/machine_wireless.glb": {
    front: "px",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/bed-double.glb": {
    front: "pz",
    symmetry: 1,
    mount: "wall",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/bed-single.glb": {
    front: "pz",
    symmetry: 1,
    mount: "wall",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/chair-armrest.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/chair.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/computer-system.glb": {
    front: "pz",
    symmetry: 1,
    mount: "wall",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/computer-wide.glb": {
    front: "pz",
    symmetry: 1,
    mount: "wall",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/computer.glb": {
    front: "pz",
    symmetry: 1,
    mount: "wall",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/container-flat.glb": {
    front: "px",
    symmetry: 2,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/container-tall.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/container-wide.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/container.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/skip.glb": {
    front: "px",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/structure-barrier.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/structure.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/table-display.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/table-inset.glb": {
    front: "pz",
    symmetry: 2,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/table-large.glb": {
    front: "pz",
    symmetry: 2,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/space/station/table.glb": {
    front: "pz",
    symmetry: 2,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/cars/delivery.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/cars/hatchback-sports.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/cars/sedan.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/cars/suv.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/cars/taxi.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/cars/truck.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/cars/van.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/commercial/detail-parasol-a.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/commercial/detail-parasol-b.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/fence-1x2.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/fence-2x2.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/industrial/chimney-basic.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/industrial/chimney-small.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/planter.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/roads/bridge-pillar-wide.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/roads/bridge-pillar.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/roads/construction-barrier.glb": {
    front: "pz",
    symmetry: 2,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/roads/construction-cone.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/roads/construction-light.glb": {
    front: "px",
    symmetry: 2,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/street/construction-fence.glb": {
    front: "pz",
    symmetry: 2,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/street/dumpster.glb": {
    front: "pz",
    symmetry: 1,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/tree-large.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
  "/models/urban/tree-small.glb": {
    front: "pz",
    symmetry: 4,
    mount: "floor",
    source: {
      front: "auto",
      symmetry: "auto",
      mount: "auto",
    },
  },
};
