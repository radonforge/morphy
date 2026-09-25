import assert from "node:assert/strict";
import { test } from "node:test";
import { snapToTexels, sunBasis } from "../packages/client/src/game/sunShadow.ts";

const SUN = { x: 14, y: 26, z: 10 };
const TEXEL = 50 / 1024;
const basis = sunBasis(SUN);

function across(p) {
  return [
    p.x * basis.right.x + p.y * basis.right.y + p.z * basis.right.z,
    p.x * basis.up.x + p.y * basis.up.y + p.z * basis.up.z,
    p.x * basis.forward.x + p.y * basis.forward.y + p.z * basis.forward.z,
  ];
}

test("snapped centres land on whole texels across the light's view and keep their depth", () => {
  const point = { x: 12.345, y: 0, z: -7.891 };
  const [right, up, depth] = across(snapToTexels(point, basis, TEXEL));
  const [, , depthBefore] = across(point);
  assert.ok(Math.abs(right / TEXEL - Math.round(right / TEXEL)) < 1e-9);
  assert.ok(Math.abs(up / TEXEL - Math.round(up / TEXEL)) < 1e-9);
  assert.ok(Math.abs(depth - depthBefore) < 1e-9);
});

test("a player moving less than a texel leaves the shadow camera where it was", () => {
  const start = snapToTexels({ x: 3, y: 0, z: 4 }, basis, TEXEL);
  const [right, up] = across(start);
  const nudge = TEXEL * 0.2;
  const nudged = {
    x: start.x + basis.right.x * nudge,
    y: start.y + basis.right.y * nudge,
    z: start.z + basis.right.z * nudge,
  };
  const [nudgedRight, nudgedUp] = across(snapToTexels(nudged, basis, TEXEL));
  assert.ok(Math.abs(nudgedRight - right) < 1e-9);
  assert.ok(Math.abs(nudgedUp - up) < 1e-9);
});
