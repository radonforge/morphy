import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AVATAR_COUNT,
  avatarIndex,
  avatarNeighbors,
  stepAvatar,
} from "../packages/client/src/ui/avatarCarousel.ts";
import { AVATAR_CATALOG } from "../packages/shared/src/avatars.ts";

const FIRST = AVATAR_CATALOG[0].id;
const SECOND = AVATAR_CATALOG[1].id;
const LAST = AVATAR_CATALOG[AVATAR_CATALOG.length - 1].id;
const SECOND_TO_LAST = AVATAR_CATALOG[AVATAR_CATALOG.length - 2].id;

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
