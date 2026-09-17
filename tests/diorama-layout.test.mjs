import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LOBBY_DIORAMAS } from "../packages/client/src/ui/lobbyDioramas.ts";

const GLB_JSON_OFFSET = 20;
const GLB_JSON_LENGTH_OFFSET = 12;
const BOX_CORNERS = 8;

/**
 * A piece flatter than this fraction of its own width is ground dressing, not a body: a road
 * tile, a crater, a scatter of pebbles. Things are meant to stand in and on those.
 */
const FLAT_RATIO = 0.2;

/**
 * How far a centre may sit inside another footprint before it counts as buried. A box around a
 * rotated or irregular hull claims corners the model does not fill, so a graze this shallow is
 * one the box invented: a chair tucked under a console, a crate leaning on a skip.
 */
const ANCHOR_TOLERANCE = 0.25;

async function glbJson(model) {
  const bytes = await readFile(new URL(`../packages/client/public${model}`, import.meta.url));
  const length = bytes.readUInt32LE(GLB_JSON_LENGTH_OFFSET);
  return JSON.parse(bytes.subarray(GLB_JSON_OFFSET, GLB_JSON_OFFSET + length).toString("utf8"));
}

function rotate([x, y, z], [qx, qy, qz, qw]) {
  const cx = qy * z - qz * y + qw * x;
  const cy = qz * x - qx * z + qw * y;
  const cz = qx * y - qy * x + qw * z;
  return [x + 2 * (qy * cz - qz * cy), y + 2 * (qz * cx - qx * cz), z + 2 * (qx * cy - qy * cx)];
}

/** A node's own transform, in glTF's order: scale, then rotate, then translate. */
function nodeTransform(node) {
  const translation = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const scale = node.scale ?? [1, 1, 1];
  return (point) =>
    rotate(
      point.map((value, axis) => value * scale[axis]),
      rotation,
    ).map((value, axis) => value + translation[axis]);
}

/**
 * The model's own bounding box, the one `Box3.setFromObject` gives the stage: every node's
 * transform applied, and each mesh measured by the corners of its position accessor.
 */
function modelBox(gltf) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const walk = (index, toParent) => {
    const node = gltf.nodes[index];
    const local = nodeTransform(node);
    const toWorld = (point) => toParent(local(point));
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        if (!accessor.min) continue;
        for (let corner = 0; corner < BOX_CORNERS; corner++) {
          const point = toWorld(
            accessor.min.map((low, axis) => (corner & (1 << axis) ? accessor.max[axis] : low)),
          );
          for (let axis = 0; axis < point.length; axis++) {
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
          }
        }
      }
    }
    for (const child of node.children ?? []) walk(child, toWorld);
  };
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) walk(root, (point) => point);
  return { min, max };
}

/**
 * Where a set piece stands once the stage has anchored it on its own footprint, which is what
 * `SetPieceModel` does and what makes `position` readable as a place.
 */
function placed(piece, box) {
  const size = box.max.map((value, axis) => value - box.min[axis]);
  const rotation = piece.rotationY ?? 0;
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const scale = piece.scale ?? 1;
  return {
    url: piece.url,
    x: piece.position[0],
    z: piece.position[2],
    halfX: ((size[0] / 2) * cos + (size[2] / 2) * sin) * scale,
    halfZ: ((size[0] / 2) * sin + (size[2] / 2) * cos) * scale,
    base: piece.position[1] + box.min[1] * scale,
    top: piece.position[1] + box.max[1] * scale,
    flat: size[1] / Math.max(size[0], size[2]) < FLAT_RATIO,
  };
}

/** How far `piece` reaches past the edges of `other`, negative when it is outside. */
function bite(piece, other) {
  return Math.min(
    other.halfX - Math.abs(piece.x - other.x),
    other.halfZ - Math.abs(piece.z - other.z),
  );
}

test("no lobby set piece is buried inside another", async () => {
  for (const [map, pieces] of Object.entries(LOBBY_DIORAMAS)) {
    const boxes = await Promise.all(pieces.map((piece) => glbJson(piece.url).then(modelBox)));
    const bodies = pieces.map((piece, index) => placed(piece, boxes[index])).filter((b) => !b.flat);
    assert.ok(bodies.length > 0, `${map}: fixture should hold solid set pieces`);
    for (const piece of bodies) {
      for (const other of bodies) {
        if (piece === other) continue;
        if (piece.base >= other.top || other.base >= piece.top) continue;
        const overlap = bite(piece, other);
        assert.ok(
          overlap <= ANCHOR_TOLERANCE,
          `${map}: ${piece.url} stands ${overlap.toFixed(2)} inside ${other.url}`,
        );
      }
    }
  }
});
