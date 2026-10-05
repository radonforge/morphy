import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOOK_SENSITIVITY_DEFAULT,
  LOOK_SENSITIVITY_MAX,
  LOOK_SENSITIVITY_MIN,
  lookSensitivity,
  parseLookSensitivity,
  setLookSensitivity,
} from "../packages/client/src/game/prefs.ts";
import { storageGet } from "../packages/client/src/safeStorage.ts";

test("a missing or blank look sensitivity is the default", () => {
  assert.equal(parseLookSensitivity(null), LOOK_SENSITIVITY_DEFAULT);
  assert.equal(parseLookSensitivity(""), LOOK_SENSITIVITY_DEFAULT);
  assert.equal(parseLookSensitivity("  "), LOOK_SENSITIVITY_DEFAULT);
});

test("a look sensitivity that is not a finite number is the default", () => {
  for (const raw of ["fast", "1.5x", "NaN", "Infinity", "-Infinity", "{}"]) {
    assert.equal(parseLookSensitivity(raw), LOOK_SENSITIVITY_DEFAULT, raw);
  }
});

test("a stored look sensitivity in range is kept as is", () => {
  assert.equal(parseLookSensitivity("0.6"), 0.6);
  assert.equal(parseLookSensitivity(String(LOOK_SENSITIVITY_MIN)), LOOK_SENSITIVITY_MIN);
  assert.equal(parseLookSensitivity(String(LOOK_SENSITIVITY_MAX)), LOOK_SENSITIVITY_MAX);
});

test("a stored look sensitivity out of range is clamped to the nearest end", () => {
  assert.equal(parseLookSensitivity("0"), LOOK_SENSITIVITY_MIN);
  assert.equal(parseLookSensitivity("-3"), LOOK_SENSITIVITY_MIN);
  assert.equal(parseLookSensitivity("50"), LOOK_SENSITIVITY_MAX);
});

test("setting the look sensitivity stores it clamped and reads back at once", () => {
  setLookSensitivity(0.55);
  assert.equal(lookSensitivity(), 0.55);
  assert.equal(storageGet("morphy:look-sensitivity"), "0.55");
  setLookSensitivity(9);
  assert.equal(lookSensitivity(), LOOK_SENSITIVITY_MAX);
  assert.equal(storageGet("morphy:look-sensitivity"), String(LOOK_SENSITIVITY_MAX));
  setLookSensitivity(Number.NaN);
  assert.equal(lookSensitivity(), LOOK_SENSITIVITY_DEFAULT);
});
