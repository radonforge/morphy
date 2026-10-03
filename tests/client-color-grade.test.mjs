import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeColor, gradeLutData } from "../packages/client/src/game/colorGrade.ts";

const IDENTITY = { lift: [0, 0, 0], gain: [1, 1, 1], contrast: 1, saturation: 1 };
const EPSILON = 1e-9;

function assertRgb(actual, expected) {
  for (let i = 0; i < 3; i++)
    assert.ok(Math.abs(actual[i] - expected[i]) < EPSILON, `${actual} vs ${expected}`);
}

test("the identity grade leaves every colour unchanged", () => {
  for (const rgb of [
    [0, 0, 0],
    [1, 1, 1],
    [0.2, 0.5, 0.9],
  ]) {
    assertRgb(gradeColor(rgb, IDENTITY), rgb);
  }
});

test("lift tints black and gain scales white", () => {
  const grade = { ...IDENTITY, lift: [0, 0.01, 0.03], gain: [1, 0.9, 0.8] };
  assertRgb(gradeColor([0, 0, 0], grade), [0, 0.01, 0.03]);
  assertRgb(gradeColor([1, 1, 1], grade), [1, 0.9, 0.8]);
});

test("contrast pivots on mid grey", () => {
  const grade = { ...IDENTITY, contrast: 2 };
  assertRgb(gradeColor([0.5, 0.5, 0.5], grade), [0.5, 0.5, 0.5]);
  assertRgb(gradeColor([0.6, 0.6, 0.6], grade), [0.7, 0.7, 0.7]);
});

test("zero saturation turns a colour into its luma grey, and results stay in range", () => {
  const [r, g, b] = gradeColor([1, 0, 0], { ...IDENTITY, saturation: 0 });
  assert.ok(Math.abs(r - g) < EPSILON && Math.abs(g - b) < EPSILON);
  for (const c of gradeColor([1, 0.02, 0], { ...IDENTITY, contrast: 3, saturation: 3 })) {
    assert.ok(c >= 0 && c <= 1);
  }
});

test("the lookup table holds the graded colour of each lattice point, red fastest", () => {
  const size = 3;
  const grade = { ...IDENTITY, gain: [0.5, 1, 1] };
  const data = gradeLutData(size, grade);
  assert.equal(data.length, size ** 3 * 4);
  const at = (r, g, b) => (r + g * size + b * size * size) * 4;
  assert.deepEqual([...data.slice(at(2, 0, 0), at(2, 0, 0) + 4)], [0.5, 0, 0, 1]);
  assert.deepEqual([...data.slice(at(0, 2, 1), at(0, 2, 1) + 4)], [0, 1, 0.5, 1]);
});
