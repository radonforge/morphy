import assert from "node:assert/strict";
import { test } from "node:test";
import {
  announcesHunt,
  CAUGHT_CARD_COPY,
  caughtByLine,
  localCaptureOf,
} from "../packages/client/src/game/caught.ts";

const ME = "me";
const NOW = 1234;

function kill(overrides) {
  return {
    byId: "h1",
    byName: "Hunter",
    victimId: ME,
    victimName: "Me",
    reason: "converted",
    ...overrides,
  };
}

test("a capture of the local player names who got them", () => {
  assert.deepEqual(localCaptureOf(kill({}), ME, NOW), { byId: "h1", byName: "Hunter", at: NOW });
});

test("a capture of someone else is not the local player's", () => {
  assert.equal(localCaptureOf(kill({ victimId: "other" }), ME, NOW), null);
});

test("a self-kill or a plain shot is not a capture", () => {
  assert.equal(localCaptureOf(kill({ reason: "self", byId: "", byName: "" }), ME, NOW), null);
  assert.equal(localCaptureOf(kill({ reason: "shot" }), ME, NOW), null);
});

test("the by line names the hunter, and is empty without one", () => {
  assert.equal(caughtByLine("Hunter"), "by Hunter");
  assert.equal(caughtByLine(""), "");
});

test("the card tells the player the role switch", () => {
  assert.equal(CAUGHT_CARD_COPY.hunterNow, "You're a hunter now");
});

test("the hunt call follows only a capture that ended mid-hunt", () => {
  assert.equal(announcesHunt("hunting"), true);
  assert.equal(announcesHunt("round_end"), false);
  assert.equal(announcesHunt("lobby"), false);
});
