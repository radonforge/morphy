import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFrameRing,
  formatDiagnostics,
  frameStats,
  gpuInfo,
  recordFrame,
} from "../packages/client/src/game/diagnostics.ts";

test("frame stats cover only the most recent frames once the ring wraps", () => {
  const ring = createFrameRing(4);
  for (const ms of [100, 100, 100, 100, 10, 20, 30, 40]) recordFrame(ring, ms);
  const stats = frameStats(ring);
  assert.equal(stats.maxMs, 40);
  assert.equal(stats.fps, 40);
  assert.equal(stats.p50Ms, 30);
});

test("an empty ring reports zeros instead of NaN", () => {
  assert.deepEqual(frameStats(createFrameRing(8)), { fps: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
});

test("a software WebGL renderer is flagged as hardware acceleration off", () => {
  assert.equal(
    gpuInfo(
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
      "WebKit WebGL",
    ).software,
    true,
  );
  assert.equal(
    gpuInfo(
      "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "WebKit WebGL",
    ).software,
    false,
  );
  assert.equal(gpuInfo(null, "Mesa llvmpipe").renderer, "Mesa llvmpipe");
});

test("the copied text leads with the version and says plainly when acceleration is off", () => {
  const text = formatDiagnostics({
    version: "0.3.0",
    build: "abc1234",
    userAgent: "UA",
    gpu: { renderer: "SwiftShader", software: true },
    antialias: true,
    pixelRatio: 1.25,
    bufferWidth: 1600,
    bufferHeight: 900,
    cores: 4,
    memoryGb: null,
    frames: { fps: 24, p50Ms: 40, p95Ms: 55, maxMs: 90 },
    drawCalls: 80,
    triangles: 150000,
    geometries: 40,
    textures: 6,
    programs: 9,
    heapMb: null,
    longTasks: 3,
    longestTaskMs: 120,
    contextLosses: 1,
    map: "Kepler-9 Station",
    phase: "hunting",
    players: 6,
  });
  assert.match(text.split("\n")[0], /^Morphy 0\.3\.0 \(abc1234\)$/);
  assert.match(text, /Hardware acceleration: OFF/);
  assert.match(text, /memory: \?/);
});
