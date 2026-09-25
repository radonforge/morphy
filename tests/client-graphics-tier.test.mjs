import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoTier,
  GRAPHICS_PREFERENCES,
  isGraphicsPreference,
  nextRoundTier,
  STEP_DOWN_FPS,
  STEP_DOWN_MIN_FRAMES,
} from "../packages/client/src/game/graphicsTier.ts";

function hints(renderer, { software = false, cores = 8, memoryGb = 8 } = {}) {
  return { gpu: { renderer, software }, cores, memoryGb };
}

function round(fps, frames = STEP_DOWN_MIN_FRAMES * 2) {
  return { frames, totalMs: (frames * 1000) / fps };
}

test("software rendering starts on Low", () => {
  assert.equal(autoTier(hints("SwiftShader", { software: true })), "low");
});

test("integrated GPUs start on Medium, discrete ones and Apple silicon on High", () => {
  assert.equal(autoTier(hints("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)")), "medium");
  assert.equal(autoTier(hints("ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)")), "medium");
  assert.equal(autoTier(hints("ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)")), "high");
  assert.equal(autoTier(hints("ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11)")), "high");
  assert.equal(autoTier(hints("ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)")), "high");
});

test("a small machine starts on Medium even with a discrete GPU", () => {
  assert.equal(autoTier(hints("NVIDIA GeForce GTX 1060", { cores: 4 })), "medium");
  assert.equal(autoTier(hints("NVIDIA GeForce GTX 1060", { memoryGb: 4 })), "medium");
});

test("a slow round steps down one tier and Low stays Low", () => {
  assert.equal(nextRoundTier("high", round(STEP_DOWN_FPS - 5)), "medium");
  assert.equal(nextRoundTier("medium", round(STEP_DOWN_FPS - 5)), "low");
  assert.equal(nextRoundTier("low", round(STEP_DOWN_FPS - 5)), "low");
});

test("a fast round, or one too short to judge, keeps the tier", () => {
  assert.equal(nextRoundTier("high", round(STEP_DOWN_FPS + 5)), "high");
  assert.equal(nextRoundTier("high", round(10, STEP_DOWN_MIN_FRAMES - 1)), "high");
});

test("a stored graphics preference is accepted only when it names a known option", () => {
  for (const pref of GRAPHICS_PREFERENCES) assert.equal(isGraphicsPreference(pref), true);
  for (const bad of [null, "", "ultra", "Auto", " high"]) {
    assert.equal(isGraphicsPreference(bad), false);
  }
});
