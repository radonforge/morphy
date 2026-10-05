import assert from "node:assert/strict";
import { test } from "node:test";

const { advanceFlicker, beginFlicker } = await import("../packages/client/src/ui/flicker.ts");
const { makeRng } = await import("../packages/shared/src/random.ts");

const FRAME_S = 1 / 60;
const GAP_MIN_S = 7;
const GAP_MAX_S = 18;
const BURST_MIN_S = 0.5;
const BURST_MAX_S = 1.4;
const TOLERANCE_S = 2 * FRAME_S;

function runLamp(seed, seconds) {
  const random = makeRng(seed);
  let state = beginFlicker(random);
  const frames = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME_S) {
    state = advanceFlicker(state, FRAME_S, random);
    frames.push(state);
  }
  return frames;
}

function bursts(frames) {
  const spans = [];
  let start = null;
  let steadySince = 0;
  for (const frame of frames) {
    if (frame.inBurst && start === null) {
      spans.push({ gap: frame.now - steadySince });
      start = frame.now;
    } else if (!frame.inBurst && start !== null) {
      spans[spans.length - 1].length = frame.now - start;
      steadySince = frame.now;
      start = null;
    }
  }
  return spans.filter((span) => span.length !== undefined);
}

test("a new lamp burns steady through its first gap", () => {
  const frames = runLamp(1, GAP_MIN_S - FRAME_S);

  assert.ok(frames.every((frame) => frame.level === 1 && !frame.inBurst));
});

test("bursts are spaced by a gap and last a burst length, both within range", () => {
  const spans = bursts(runLamp(7, 600));

  assert.ok(spans.length >= 20, `only ${spans.length} bursts in ten minutes`);
  for (const { gap, length } of spans) {
    assert.ok(gap >= GAP_MIN_S - TOLERANCE_S && gap <= GAP_MAX_S + TOLERANCE_S, `gap ${gap}`);
    assert.ok(
      length >= BURST_MIN_S - TOLERANCE_S && length <= BURST_MAX_S + TOLERANCE_S,
      `burst ${length}`,
    );
  }
});

test("the lamp stutters inside a burst and is fully lit outside one", () => {
  const frames = runLamp(3, 120);
  const inBurst = frames.filter((frame) => frame.inBurst);

  assert.ok(frames.filter((frame) => !frame.inBurst).every((frame) => frame.level === 1));
  assert.ok(inBurst.some((frame) => frame.level < 1));
  assert.ok(inBurst.some((frame) => frame.level === 1));
});

test("two lamps with different draws do not burst in step", () => {
  const first = bursts(runLamp(11, 120)).map((span) => span.gap);
  const second = bursts(runLamp(12, 120)).map((span) => span.gap);

  assert.notDeepEqual(first, second);
});
