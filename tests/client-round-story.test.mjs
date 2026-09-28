import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nextStartingRoles,
  phaseLabel,
  propsLeftLabel,
  resultStatus,
  storyLine,
  wonRound,
} from "../packages/client/src/game/roundStory.ts";

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

test("roles read while hiding are the starting roles", () => {
  const roles = nextStartingRoles({}, "hiding", { a: "hunter", b: "prop" });
  assert.deepEqual(roles, { a: "hunter", b: "prop" });
});

test("a capture during the hunt does not rewrite a starting role", () => {
  const dealt = nextStartingRoles({}, "hiding", { a: "hunter", b: "prop" });
  const hunt = nextStartingRoles(dealt, "hunting", { a: "hunter", b: "hunter" });
  const end = nextStartingRoles(hunt, "round_end", { a: "hunter", b: "hunter" });
  assert.equal(end.b, "prop");
});

test("a player the record never saw enters with the role they hold now", () => {
  const roles = nextStartingRoles({ a: "hunter" }, "hunting", { a: "hunter", c: "prop" });
  assert.deepEqual(roles, { a: "hunter", c: "prop" });
});

test("the record clears for the next round", () => {
  assert.deepEqual(nextStartingRoles({ a: "prop" }, "starting", { a: "hunter" }), {});
  assert.deepEqual(nextStartingRoles({ a: "prop" }, "lobby", { a: "prop" }), {});
});

test("an unchanged record keeps its identity so React skips the render", () => {
  const dealt = nextStartingRoles({}, "hiding", { a: "hunter", b: "prop" });
  assert.equal(nextStartingRoles(dealt, "hiding", { a: "hunter", b: "prop" }), dealt);
  assert.equal(nextStartingRoles(dealt, "hunting", { a: "hunter", b: "hunter" }), dealt);
});

test("a caught prop still loses when the hunters win", () => {
  assert.equal(wonRound("prop", "hunters"), false);
  assert.equal(wonRound("prop", "props"), true);
  assert.equal(wonRound("hunter", "hunters"), true);
  assert.equal(wonRound("hunter", ""), false);
});

test("a caught prop's story names the catcher and the time hidden", () => {
  assert.equal(storyLine("prop", { byName: "Echo", atMs: 12_400 }, 0), "Caught by Echo after 0:12");
  assert.equal(
    storyLine("prop", { byName: "Echo", atMs: 75_000 }, 2),
    "Caught by Echo after 1:15, then caught 2 props",
  );
});

test("an uncaught prop survived and a hunter counts its catches", () => {
  assert.equal(storyLine("prop", undefined, 0), "You survived the hunt");
  assert.equal(storyLine("hunter", undefined, 1), "You caught 1 prop");
  assert.equal(storyLine("hunter", undefined, 0), "You caught nobody this round");
});

test("the result column tells a starting prop's fate", () => {
  assert.equal(resultStatus("prop", { byName: "Echo", atMs: 9_000 }, true), "Caught 0:09");
  assert.equal(resultStatus("prop", undefined, true), "Survived");
  assert.equal(resultStatus("hunter", undefined, false), "Out of HP");
});
