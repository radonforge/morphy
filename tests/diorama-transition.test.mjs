import assert from "node:assert/strict";
import { test } from "node:test";

const {
  beginTransition,
  DIORAMA_TRANSITION_S,
  isVeiled,
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
  assert.equal(isVeiled(loading), false);
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
  assert.ok(scales(last, SECOND).every((scale) => scale > 0.9));
  assert.ok(scales(last, SECOND).at(-1) < 1, "the sweep should still be running at the budget");

  const done = tick(crossing, DIORAMA_TRANSITION_S);
  assert.equal(done.phase, "settled");
  assert.deepEqual(liveMaps(done), [SECOND]);
  assert.equal(stageMap(done), SECOND);
  assert.equal(veilOpacity(done), 0);
});

test("stepping mid-cross leaves the world on screen exactly where it stands", () => {
  const partway = tick(ready(retarget(settled(FIRST), SECOND), false), DIORAMA_TRANSITION_S / 5);
  const leaving = scales(partway, FIRST);
  assert.ok(leaving.some((scale) => scale > 0));

  const interrupted = retarget(partway, THIRD);
  assert.deepEqual(liveMaps(interrupted), [FIRST, THIRD]);
  assert.deepEqual(scales(interrupted, FIRST), leaving);
  assert.equal(veilOpacity(interrupted), veilOpacity(partway));
  assert.equal(stageMap(interrupted), stageMap(partway));

  assert.deepEqual(scales(ready(interrupted, false), FIRST), leaving);
});

test("stepping past the handover gives the stage to the arriving world, whole", () => {
  const crossing = ready(retarget(settled(FIRST), SECOND), false);
  const late = tick(crossing, DIORAMA_TRANSITION_S / 2 + FRAME_S);

  const interrupted = retarget(late, THIRD);
  assert.deepEqual(liveMaps(interrupted), [SECOND, THIRD]);
  assert.deepEqual(scales(interrupted, SECOND), Array(PIECES).fill(1));
  assert.equal(stageMap(interrupted), SECOND);
});

test("the world held through a step is always one the stage can still be seen by", () => {
  const crossing = ready(retarget(settled(FIRST), SECOND), false);

  for (let frame = 0; frame * FRAME_S < DIORAMA_TRANSITION_S; frame++) {
    const interrupted = retarget(tick(crossing, frame * FRAME_S), THIRD);
    const held = scales(interrupted, interrupted.current);
    assert.ok(
      held.some((scale) => scale > 0.5),
      `a step at ${(frame * FRAME_S).toFixed(2)}s left the stage at ${Math.max(...held).toFixed(2)}`,
    );
  }
});

test("stepping faster than the timeline never leaves more than two worlds mounted", () => {
  const order = [SECOND, THIRD, FIRST, SECOND, FIRST, THIRD];
  const paces = [FRAME_S, DIORAMA_TRANSITION_S / 3, DIORAMA_TRANSITION_S / 8];
  let state = settled(FIRST);

  order.forEach((map, step) => {
    state = retarget(state, map);
    assert.ok(liveMaps(state).length <= 2, `${liveMaps(state).length} worlds live`);
    assert.equal(new Set(liveMaps(state)).size, liveMaps(state).length, "a world mounted twice");
    state = tick(ready(state, false), paces[step % paces.length]);
    assert.ok(liveMaps(state).length <= 2, `${liveMaps(state).length} worlds live`);
  });

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
  const crossing = tick(ready(retarget(settled(FIRST), SECOND), false), FRAME_S);

  assert.equal(sameStageRender(crossing, tick(crossing, FRAME_S)), true);
  assert.equal(sameStageRender(crossing, tick(crossing, DIORAMA_TRANSITION_S)), false);
});
