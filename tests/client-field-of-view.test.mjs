import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FIELD_OF_VIEW_DEFAULT,
  FIELD_OF_VIEW_MAX,
  FIELD_OF_VIEW_MIN,
  fieldOfView,
  parseFieldOfView,
  setFieldOfView,
} from "../packages/client/src/game/prefs.ts";
import { storageGet } from "../packages/client/src/safeStorage.ts";

test("a missing or blank field of view is the default", () => {
  assert.equal(parseFieldOfView(null), FIELD_OF_VIEW_DEFAULT);
  assert.equal(parseFieldOfView(""), FIELD_OF_VIEW_DEFAULT);
  assert.equal(parseFieldOfView("  "), FIELD_OF_VIEW_DEFAULT);
});

test("a field of view that is not a finite number is the default", () => {
  for (const raw of ["wide", "70deg", "NaN", "Infinity", "-Infinity", "{}"]) {
    assert.equal(parseFieldOfView(raw), FIELD_OF_VIEW_DEFAULT, raw);
  }
});

test("a stored field of view in range is kept as is", () => {
  assert.equal(parseFieldOfView("72"), 72);
  assert.equal(parseFieldOfView(String(FIELD_OF_VIEW_MIN)), FIELD_OF_VIEW_MIN);
  assert.equal(parseFieldOfView(String(FIELD_OF_VIEW_MAX)), FIELD_OF_VIEW_MAX);
});

test("a stored field of view out of range is clamped to the nearest end", () => {
  assert.equal(parseFieldOfView("0"), FIELD_OF_VIEW_MIN);
  assert.equal(parseFieldOfView("-20"), FIELD_OF_VIEW_MIN);
  assert.equal(parseFieldOfView("179"), FIELD_OF_VIEW_MAX);
});

test("setting the field of view stores it clamped and reads back at once", () => {
  setFieldOfView(68);
  assert.equal(fieldOfView(), 68);
  assert.equal(storageGet("morphy:fov"), "68");
  setFieldOfView(120);
  assert.equal(fieldOfView(), FIELD_OF_VIEW_MAX);
  assert.equal(storageGet("morphy:fov"), String(FIELD_OF_VIEW_MAX));
  setFieldOfView(Number.NaN);
  assert.equal(fieldOfView(), FIELD_OF_VIEW_DEFAULT);
});
