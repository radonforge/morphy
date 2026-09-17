import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.WheelEvent = { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 };

const {
  AVATAR_COUNT,
  avatarIndex,
  avatarNeighbors,
  MAP_COUNT,
  mapIndex,
  mapNeighbors,
  stepAvatar,
  stepMap,
} = await import("../packages/client/src/ui/carousel.ts");
const { feedWheel, initialWheelGesture, wheelDeltaPx } = await import(
  "../packages/client/src/ui/carouselWheel.ts"
);
const { AVATAR_CATALOG } = await import("../packages/shared/src/avatars.ts");
const { MAP_CATALOG } = await import("../packages/shared/src/maps.ts");

const FIRST = AVATAR_CATALOG[0].id;
const SECOND = AVATAR_CATALOG[1].id;
const LAST = AVATAR_CATALOG[AVATAR_CATALOG.length - 1].id;
const SECOND_TO_LAST = AVATAR_CATALOG[AVATAR_CATALOG.length - 2].id;

const FIRST_MAP = MAP_CATALOG[0].id;
const SECOND_MAP = MAP_CATALOG[1].id;
const LAST_MAP = MAP_CATALOG[MAP_CATALOG.length - 1].id;

test("the carousel covers the whole catalog", () => {
  assert.equal(AVATAR_COUNT, AVATAR_CATALOG.length);
  assert.equal(avatarIndex(FIRST), 0);
  assert.equal(avatarIndex(LAST), AVATAR_CATALOG.length - 1);
});

test("stepping forward past the end wraps to the start", () => {
  assert.equal(stepAvatar(LAST, 1), FIRST);
});

test("stepping back past the start wraps to the end", () => {
  assert.equal(stepAvatar(FIRST, -1), LAST);
});

test("a step of zero holds the current avatar", () => {
  assert.equal(stepAvatar(SECOND, 0), SECOND);
});

test("a step longer than the catalog still lands in range", () => {
  assert.equal(stepAvatar(FIRST, AVATAR_COUNT), FIRST);
  assert.equal(stepAvatar(FIRST, AVATAR_COUNT + 1), SECOND);
  assert.equal(stepAvatar(FIRST, -(AVATAR_COUNT * 2 + 1)), LAST);
});

test("walking the catalog forward returns to where it started", () => {
  let current = FIRST;
  const seen = new Set([current]);
  for (let i = 1; i < AVATAR_COUNT; i++) {
    current = stepAvatar(current, 1);
    assert.equal(seen.has(current), false, `${current} came round twice`);
    seen.add(current);
  }
  assert.equal(stepAvatar(current, 1), FIRST);
});

test("neighbours wrap at both ends of the catalog", () => {
  assert.deepEqual(avatarNeighbors(FIRST), { prev: LAST, next: SECOND });
  assert.deepEqual(avatarNeighbors(LAST), { prev: SECOND_TO_LAST, next: FIRST });
});

test("an avatar missing from the catalog steps from the default instead of pinning", () => {
  assert.equal(stepAvatar("retired-shape", 1), SECOND);
});

test("the world carousel covers the whole map catalog", () => {
  assert.equal(MAP_COUNT, MAP_CATALOG.length);
  assert.equal(mapIndex(FIRST_MAP), 0);
  assert.equal(mapIndex(LAST_MAP), MAP_CATALOG.length - 1);
});

test("the world carousel wraps at both ends", () => {
  assert.equal(stepMap(LAST_MAP, 1), FIRST_MAP);
  assert.equal(stepMap(FIRST_MAP, -1), LAST_MAP);
  assert.deepEqual(mapNeighbors(FIRST_MAP), { prev: LAST_MAP, next: SECOND_MAP });
});

test("a retired map id steps from the default instead of pinning", () => {
  assert.equal(stepMap("atlantis", 1), SECOND_MAP);
});

const pixels = (x, y) => ({ x, y });

function feed(gesture, delta, now) {
  return feedWheel(gesture, delta, now);
}

test("a wheel notch past the step threshold moves one place", () => {
  const { step } = feed(initialWheelGesture(), pixels(0, 100), 1000);
  assert.equal(step, 1);
});

test("the sign of the travel picks the direction", () => {
  const { step } = feed(initialWheelGesture(), pixels(0, -100), 1000);
  assert.equal(step, -1);
});

test("travel short of the threshold moves nothing", () => {
  const { step } = feed(initialWheelGesture(), pixels(0, 40), 1000);
  assert.equal(step, 0);
});

test("two gentle swipes on the same axis add up to one step", () => {
  const first = feed(initialWheelGesture(), pixels(0, 50), 1000);
  assert.equal(first.step, 0);
  const second = feed(first.gesture, pixels(0, 50), 1010);
  assert.equal(second.step, 1);
});

test("decaying inertia after a step never steps again", () => {
  let gesture = feed(initialWheelGesture(), pixels(0, 200), 1000).gesture;
  let time = 1000;
  for (const sample of [160, 120, 90, 70, 50, 30, 20, 10, 5]) {
    time += 12;
    const outcome = feed(gesture, pixels(0, sample), time);
    assert.equal(outcome.step, 0, `inertia sample ${sample} produced a step`);
    gesture = outcome.gesture;
  }
});

test("a magnitude climbing back over the floor is a fresh push, not inertia", () => {
  let gesture = feed(initialWheelGesture(), pixels(0, 200), 1000).gesture;
  let time = 1000;
  for (const sample of [160, 100, 60]) {
    time += 12;
    gesture = feed(gesture, pixels(0, sample), time).gesture;
  }
  const pushed = feed(gesture, pixels(0, 240), time + 12);
  assert.equal(pushed.step, 1);
});

test("silence re-arms the wheel after a step", () => {
  const stepped = feed(initialWheelGesture(), pixels(0, 200), 1000);
  const afterQuiet = feed(stepped.gesture, pixels(0, 120), 3000);
  assert.equal(afterQuiet.step, 1);
});

test("the axis a gesture opens on swallows events on the other one", () => {
  const opened = feed(initialWheelGesture(), pixels(50, 0), 1000);
  assert.equal(opened.gesture.axis, "x");
  const crooked = feed(opened.gesture, pixels(0, 200), 1005);
  assert.equal(crooked.step, 0);
  assert.equal(crooked.gesture.axis, "x");
});

test("an event with no travel on either axis is ignored outright", () => {
  const gesture = initialWheelGesture();
  const outcome = feed(gesture, pixels(0, 0), 1000);
  assert.equal(outcome.step, 0);
  assert.equal(outcome.gesture, gesture);
});

test("line and page wheel units are scaled to pixels", () => {
  assert.deepEqual(wheelDeltaPx({ deltaX: 0, deltaY: 3, deltaMode: 0 }), { x: 0, y: 3 });
  assert.deepEqual(wheelDeltaPx({ deltaX: 0, deltaY: 3, deltaMode: 1 }), { x: 0, y: 120 });
  assert.deepEqual(wheelDeltaPx({ deltaX: 1, deltaY: 0, deltaMode: 2 }), { x: 400, y: 0 });
});
