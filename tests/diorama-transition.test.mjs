import assert from "node:assert/strict";
import { test } from "node:test";

const {
  beginTransition,
  DIORAMA_TRANSITION_S,
  liveMaps,
  pieceScale,
  ready,
  retarget,
  sameStageRender,
  stageMap,
  tick,
  veilOpacity,
} = await import("../packages/client/src/ui/dioramaTransition.ts");
const { MAP_CATALOG } = await import("../packages/shared/src/maps.ts");

const [FIRST, SECOND, THIRD] = MAP_CATALOG.map((entry) => entry.id);
const PIECES = 8;
const FRAME_S = 1 / 60;

const settled = (map) => tick(ready(beginTransition(map), false), DIORAMA_TRANSITION_S);
const scales = (state, map) =>
  Array.from({ length: PIECES }, (_, index) => pieceScale(state, map, index, PIECES));

test("a retarget while settled holds the world on screen and animates nothing", () => {
  const loading = retarget(settled(FIRST), SECOND);

  assert.equal(loading.phase, "loading");
  assert.deepEqual(liveMaps(loading), [FIRST, SECOND]);
  assert.deepEqual(scales(loading, FIRST), Array(PIECES).fill(1));
  assert.deepEqual(scales(loading, SECOND), Array(PIECES).fill(0));
  assert.equal(stageMap(loading), FIRST);
  assert.equal(veilOpacity(loading), 0);
  assert.equal(tick(loading, 1), loading);
});

test("the arriving world reporting itself loaded starts the cross", () => {
  const loading = retarget(settled(FIRST), SECOND);
  const crossing = ready(loading, false);

  assert.equal(crossing.phase, "crossing");
  assert.equal(crossing.bake, loading.bake + 1);

  const moving = tick(crossing, DIORAMA_TRANSITION_S / 2);
  assert.ok(scales(moving, FIRST).every((scale) => scale < 1));
  assert.ok(scales(moving, SECOND).some((scale) => scale > 0));
  assert.ok(veilOpacity(moving) > 0);
});

test("the cross covers every piece within the timeline the stage budgets for", () => {
  const crossing = ready(retarget(settled(FIRST), SECOND), false);

  const last = tick(crossing, DIORAMA_TRANSITION_S - FRAME_S);
  assert.equal(last.phase, "crossing");
  assert.deepEqual(scales(last, FIRST), Array(PIECES).fill(0));
  assert.deepEqual(scales(last, SECOND), Array(PIECES).fill(1));

  const done = tick(crossing, DIORAMA_TRANSITION_S);
  assert.equal(done.phase, "settled");
  assert.deepEqual(liveMaps(done), [SECOND]);
  assert.equal(stageMap(done), SECOND);
  assert.equal(veilOpacity(done), 0);
});

test("stepping faster than the timeline never leaves more than two worlds mounted", () => {
  const order = [SECOND, THIRD, FIRST, SECOND, FIRST, THIRD];
  let state = settled(FIRST);

  for (const map of order) {
    state = retarget(state, map);
    assert.ok(liveMaps(state).length <= 2, `${liveMaps(state).length} worlds live`);
    assert.equal(new Set(liveMaps(state)).size, liveMaps(state).length, "a world mounted twice");
    state = tick(ready(state, false), FRAME_S);
    assert.ok(liveMaps(state).length <= 2, `${liveMaps(state).length} worlds live`);
  }

  assert.equal(stageMap(tick(state, DIORAMA_TRANSITION_S)), THIRD);
});

test("stepping back to the world on screen drops the one still loading", () => {
  const cancelled = retarget(retarget(settled(FIRST), SECOND), FIRST);

  assert.equal(cancelled.phase, "settled");
  assert.deepEqual(liveMaps(cancelled), [FIRST]);
});

test("reduced motion resolves the swap in one step", () => {
  const swapped = ready(retarget(settled(FIRST), SECOND), true);

  assert.equal(swapped.phase, "settled");
  assert.deepEqual(liveMaps(swapped), [SECOND]);
  assert.deepEqual(scales(swapped, SECOND), Array(PIECES).fill(1));
  assert.equal(veilOpacity(swapped), 0);
});

test("a frame of the cross alone does not re-render the stage", () => {
  const crossing = ready(retarget(settled(FIRST), SECOND), false);

  assert.equal(sameStageRender(crossing, tick(crossing, FRAME_S)), true);
  assert.equal(sameStageRender(crossing, tick(crossing, DIORAMA_TRANSITION_S)), false);
});
