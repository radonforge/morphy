import assert from "node:assert/strict";
import { test } from "node:test";

const { closedDropdown, dropdownKey } = await import("../packages/client/src/ui/dropdownKeys.ts");

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
