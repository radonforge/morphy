import assert from "node:assert/strict";
import { test } from "node:test";
import { phaseLabel, propsLeftLabel } from "../packages/client/src/game/roundStory.ts";

test("a prop is never told to hunt", () => {
  for (const phase of ["lobby", "starting", "hiding", "hunting", "round_end"]) {
    assert.doesNotMatch(phaseLabel(phase, "prop"), /hunt/i);
  }
});

test("a prop hides and then survives while a hunter hunts", () => {
  assert.equal(phaseLabel("hiding", "prop"), "Hide");
  assert.equal(phaseLabel("hunting", "prop"), "Survive");
  assert.equal(phaseLabel("hunting", "hunter"), "Hunt!");
});

test("the props counter carries its unit and agrees in number", () => {
  assert.equal(propsLeftLabel(3), "3 props left");
  assert.equal(propsLeftLabel(1), "1 prop left");
  assert.equal(propsLeftLabel(0), "0 props left");
});
