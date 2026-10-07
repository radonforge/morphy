import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePropView,
  propEyeHeight,
  propView,
  setPropView,
} from "../packages/client/src/game/propView.ts";

test("a missing or unknown prop view is third person", () => {
  for (const raw of [null, "", "third", "First", "first-person", "1"]) {
    assert.equal(parsePropView(raw), "third", String(raw));
  }
});

test("a stored first-person prop view is kept", () => {
  assert.equal(parsePropView("first"), "first");
});

test("a set prop view is read back", () => {
  setPropView("first");
  assert.equal(propView(), "first");
  setPropView("third");
  assert.equal(propView(), "third");
});

test("the eye sits just under the top of a disguise", () => {
  const cone = propEyeHeight(0.7);
  const dumpster = propEyeHeight(1.6);
  assert.ok(cone < 0.7 && cone > 0.5, `cone eye ${cone}`);
  assert.ok(dumpster < 1.6 && dumpster > 1.3, `dumpster eye ${dumpster}`);
});

test("a flat disguise still gets an eye above the floor", () => {
  assert.ok(propEyeHeight(0) > 0);
  assert.equal(propEyeHeight(0.05), propEyeHeight(0));
});
