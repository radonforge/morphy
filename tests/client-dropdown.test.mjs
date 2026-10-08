import assert from "node:assert/strict";
import { test } from "node:test";

const { closedDropdown, dropdownKey, NO_TYPED_PREFIX, TYPE_AHEAD_RESET_MS, typeAheadKey } =
  await import("../packages/client/src/ui/dropdownKeys.ts");
const { placeDropdownList } = await import("../packages/client/src/ui/dropdownPlacement.ts");

const COUNT = 4;
const SELECTED = 2;
const open = (active) => ({ open: true, active });

test("opening keys open the list on the selected option", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
    const outcome = dropdownKey(closedDropdown(SELECTED), key, COUNT, SELECTED);
    assert.deepEqual(outcome, { state: open(SELECTED), commit: null, handled: true }, key);
  }
});

test("Home and End open the list on the first and last option", () => {
  assert.deepEqual(dropdownKey(closedDropdown(SELECTED), "Home", COUNT, SELECTED).state, open(0));
  assert.deepEqual(
    dropdownKey(closedDropdown(SELECTED), "End", COUNT, SELECTED).state,
    open(COUNT - 1),
  );
});

test("a closed dropdown leaves other keys, Escape and Tab included, to the page", () => {
  for (const key of ["Escape", "Tab", "a", "ArrowLeft"]) {
    const closed = closedDropdown(SELECTED);
    assert.deepEqual(dropdownKey(closed, key, COUNT, SELECTED), {
      state: closed,
      commit: null,
      handled: false,
    });
  }
});

test("the arrows move the open cursor and stop at either end", () => {
  assert.deepEqual(dropdownKey(open(1), "ArrowDown", COUNT, SELECTED).state, open(2));
  assert.deepEqual(dropdownKey(open(1), "ArrowUp", COUNT, SELECTED).state, open(0));
  assert.deepEqual(
    dropdownKey(open(COUNT - 1), "ArrowDown", COUNT, SELECTED).state,
    open(COUNT - 1),
  );
  assert.deepEqual(dropdownKey(open(0), "ArrowUp", COUNT, SELECTED).state, open(0));
  assert.deepEqual(dropdownKey(open(1), "Home", COUNT, SELECTED).state, open(0));
  assert.deepEqual(dropdownKey(open(1), "End", COUNT, SELECTED).state, open(COUNT - 1));
});

test("Enter and Space commit the open cursor and close on it", () => {
  for (const key of ["Enter", " "]) {
    assert.deepEqual(dropdownKey(open(0), key, COUNT, SELECTED), {
      state: closedDropdown(0),
      commit: 0,
      handled: true,
    });
  }
});

test("Escape closes without committing and parks on the selected option", () => {
  assert.deepEqual(dropdownKey(open(0), "Escape", COUNT, SELECTED), {
    state: closedDropdown(SELECTED),
    commit: null,
    handled: true,
  });
});

test("Tab commits the open cursor but lets focus move on", () => {
  assert.deepEqual(dropdownKey(open(3), "Tab", COUNT, SELECTED), {
    state: closedDropdown(3),
    commit: 3,
    handled: false,
  });
});

test("an open dropdown does not claim keys it has no use for", () => {
  assert.equal(dropdownKey(open(1), "w", COUNT, SELECTED).handled, false);
  assert.deepEqual(dropdownKey(open(1), "w", COUNT, SELECTED).state, open(1));
});

test("an out-of-range cursor is clamped before it moves or commits", () => {
  assert.deepEqual(dropdownKey(open(9), "ArrowUp", COUNT, SELECTED).state, open(COUNT - 2));
  assert.equal(dropdownKey(open(9), "Enter", COUNT, SELECTED).commit, COUNT - 1);
});

test("a dropdown with no options handles nothing", () => {
  assert.equal(dropdownKey(closedDropdown(0), "ArrowDown", 0, 0).handled, false);
});

const VIEWPORT = { width: 400, height: 200 };
const MARGIN = 8;
const GAP = 4;
const trigger = (top, bottom) => ({ top, bottom, left: 20, width: 120 });

test("a list that fits below its trigger opens below it at its own height", () => {
  const placed = placeDropdownList(trigger(20, 50), { width: 120, height: 100 }, VIEWPORT);
  assert.equal(placed.top, 50 + GAP);
  assert.equal(placed.maxHeight, VIEWPORT.height - 50 - GAP - MARGIN);
  assert.equal(placed.left, 20);
  assert.equal(placed.minWidth, 120);
});

test("a list too tall for either side opens on the roomier one and never above the viewport", () => {
  const placed = placeDropdownList(trigger(110, 140), { width: 120, height: 140 }, VIEWPORT);
  assert.equal(placed.top, MARGIN);
  assert.equal(placed.maxHeight, 110 - GAP - MARGIN);
  assert.equal(placed.top + placed.maxHeight, 110 - GAP);
});

test("a list that fits above sits right over its trigger", () => {
  const placed = placeDropdownList(trigger(150, 180), { width: 120, height: 60 }, VIEWPORT);
  assert.equal(placed.top, 150 - GAP - 60);
});

test("a list too tall below with less room above still opens below, capped to the room there", () => {
  const placed = placeDropdownList(trigger(40, 70), { width: 120, height: 300 }, VIEWPORT);
  assert.equal(placed.top, 70 + GAP);
  assert.equal(placed.maxHeight, VIEWPORT.height - 70 - GAP - MARGIN);
});

test("a list wider than the room to its right is pulled back inside the viewport", () => {
  const box = { top: 20, bottom: 50, left: 350, width: 40 };
  assert.equal(placeDropdownList(box, { width: 120, height: 40 }, VIEWPORT).left, 400 - 120 - 8);
  const wide = placeDropdownList(box, { width: 500, height: 40 }, VIEWPORT);
  assert.equal(wide.left, MARGIN);
});

const LABELS = ["Auto", "High", "Higher", "Low"];
const typeAt = (state, typed, key, at, selected = 0) =>
  typeAheadKey(state, typed, key, at, LABELS, selected);

test("a typed letter on a closed dropdown picks the first matching label, in any case", () => {
  const typed = typeAt(closedDropdown(0), NO_TYPED_PREFIX, "h", 1_000);
  assert.deepEqual(typed.outcome, { state: closedDropdown(1), commit: 1, handled: true });
  assert.deepEqual(typed.typed, { text: "h", at: 1_000 });
  assert.equal(typeAt(closedDropdown(0), NO_TYPED_PREFIX, "L", 1_000).outcome.commit, 3);
});

test("a typed letter on an open dropdown moves the cursor without committing", () => {
  const typed = typeAt(open(0), NO_TYPED_PREFIX, "l", 1_000);
  assert.deepEqual(typed.outcome, { state: open(3), commit: null, handled: true });
});

test("letters typed in quick succession search the whole prefix", () => {
  const first = typeAt(open(0), NO_TYPED_PREFIX, "h", 1_000);
  assert.equal(first.outcome.state.active, 1);
  const second = typeAt(first.outcome.state, first.typed, "i", 1_100);
  const third = typeAt(second.outcome.state, second.typed, "g", 1_200);
  const fourth = typeAt(third.outcome.state, third.typed, "h", 1_300);
  const fifth = typeAt(fourth.outcome.state, fourth.typed, "e", 1_400);
  assert.deepEqual(
    [second, third, fourth, fifth].map((typed) => typed.outcome.state.active),
    [1, 1, 1, 2],
  );
  assert.equal(fifth.typed.text, "highe");
});

test("a pause longer than the reset starts a new search", () => {
  const first = typeAt(open(0), NO_TYPED_PREFIX, "h", 1_000);
  const later = typeAt(first.outcome.state, first.typed, "a", 1_000 + TYPE_AHEAD_RESET_MS + 1);
  assert.equal(later.typed.text, "a");
  assert.equal(later.outcome.state.active, 0);
});

test("the same letter again cycles through the labels it starts", () => {
  const first = typeAt(open(0), NO_TYPED_PREFIX, "h", 1_000);
  const second = typeAt(first.outcome.state, first.typed, "h", 1_100);
  const third = typeAt(second.outcome.state, second.typed, "h", 1_200);
  assert.deepEqual(
    [first, second, third].map((typed) => typed.outcome.state.active),
    [1, 2, 1],
  );
});

test("the same letter on a closed dropdown picks each of its labels in turn, wrapping", () => {
  const first = typeAt(closedDropdown(0), NO_TYPED_PREFIX, "h", 1_000, 0);
  const second = typeAt(first.outcome.state, first.typed, "h", 1_100, first.outcome.commit);
  const third = typeAt(second.outcome.state, second.typed, "h", 1_200, second.outcome.commit);
  assert.deepEqual(
    [first, second, third].map((typed) => typed.outcome.commit),
    [1, 2, 1],
  );
  assert.equal(typeAt(closedDropdown(3), NO_TYPED_PREFIX, "a", 1_000, 3).outcome.commit, 0);
});

test("a Space that extends a search with no match is neither typed into a label nor opening", () => {
  const first = typeAt(closedDropdown(0), NO_TYPED_PREFIX, "h", 1_000, 0);
  const space = typeAt(first.outcome.state, first.typed, " ", 1_100, first.outcome.commit);
  assert.deepEqual(space.outcome, {
    state: first.outcome.state,
    commit: null,
    handled: false,
  });
});

test("a character no label starts with is not the dropdown's", () => {
  const typed = typeAt(closedDropdown(0), NO_TYPED_PREFIX, "z", 1_000);
  assert.deepEqual(typed.outcome, { state: closedDropdown(0), commit: null, handled: false });
});

test("keys that type nothing, and a Space that starts no search, are left to dropdownKey", () => {
  for (const key of ["ArrowDown", "Enter", "Escape", " "]) {
    assert.equal(typeAt(open(0), NO_TYPED_PREFIX, key, 1_000), null, key);
  }
  const first = typeAt(open(0), NO_TYPED_PREFIX, "h", 1_000);
  assert.equal(typeAt(first.outcome.state, first.typed, " ", 1_100).typed.text, "h ");
});
