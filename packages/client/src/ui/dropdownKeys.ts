/** Whether the list is open, and which option the keyboard is on while it is. */
export interface DropdownState {
  readonly open: boolean;
  readonly active: number;
}

/**
 * What one key press does: the next state, the option to commit (or `null`), and whether the
 * key was the dropdown's, whose browser default the component then cancels.
 */
export interface DropdownKeyOutcome {
  readonly state: DropdownState;
  readonly commit: number | null;
  readonly handled: boolean;
}

/** The closed dropdown, its keyboard cursor parked on the selected option. */
export function closedDropdown(selected: number): DropdownState {
  return { open: false, active: selected };
}

function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(index, 0), count - 1);
}

/**
 * The keyboard half of the WAI-ARIA select-only combobox. Closed, the arrows, Enter, Space,
 * Home and End open the list on the selected option (Home and End on the first and last). Open,
 * the arrows, Home and End move the cursor without wrapping, Enter and Space commit it and close,
 * Escape closes without committing, and Tab commits and lets focus move on. Any other key is not
 * the dropdown's.
 */
export function dropdownKey(
  state: DropdownState,
  key: string,
  count: number,
  selected: number,
): DropdownKeyOutcome {
  const unhandled: DropdownKeyOutcome = { state, commit: null, handled: false };
  if (count <= 0) return unhandled;
  const last = count - 1;
  const move = (active: number): DropdownKeyOutcome => ({
    state: { open: true, active: clampIndex(active, count) },
    commit: null,
    handled: true,
  });
  const close = (commit: number | null, handled: boolean): DropdownKeyOutcome => ({
    state: closedDropdown(commit ?? selected),
    commit,
    handled,
  });

  if (!state.open) {
    switch (key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        return move(selected);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      default:
        return unhandled;
    }
  }

  const active = clampIndex(state.active, count);
  switch (key) {
    case "ArrowDown":
      return move(active + 1);
    case "ArrowUp":
      return move(active - 1);
    case "Home":
      return move(0);
    case "End":
      return move(last);
    case "Enter":
    case " ":
      return close(active, true);
    case "Escape":
      return close(null, true);
    case "Tab":
      return close(active, false);
    default:
      return unhandled;
  }
}

/** How long after a typed character the next one still extends the same search. */
export const TYPE_AHEAD_RESET_MS = 500;

/** The characters typed so far, lower-cased, and when the last of them was typed. */
export interface TypedPrefix {
  readonly text: string;
  readonly at: number;
}

/** No search under way: the next character starts one. */
export const NO_TYPED_PREFIX: TypedPrefix = { text: "", at: Number.NEGATIVE_INFINITY };

/**
 * Type-ahead, the half of a select-only combobox that `dropdownKey` leaves out. A character typed
 * within `TYPE_AHEAD_RESET_MS` of the last extends the search, any other starts a new one. The
 * search lands on the first label, wrapping, that starts with it in any case: from the current
 * option while the search grows, so it stays put while it still matches, and from the next one
 * for a new search. When nothing matches and every character typed is the same, that one letter
 * is searched from the next option instead, so pressing it again cycles through its options. Closed, a match is picked at once, as
 * a native select does; open, the cursor moves to it. A key that types no character, or a Space
 * that would start a search, returns `null` and is `dropdownKey`'s; a character that matches
 * nothing is not the dropdown's.
 */
export function typeAheadKey(
  state: DropdownState,
  typed: TypedPrefix,
  key: string,
  at: number,
  labels: readonly string[],
  selected: number,
): { readonly typed: TypedPrefix; readonly outcome: DropdownKeyOutcome } | null {
  if ([...key].length !== 1 || labels.length === 0) return null;
  const continues = typed.text !== "" && at - typed.at <= TYPE_AHEAD_RESET_MS;
  if (key === " " && !continues) return null;
  const text = (continues ? typed.text : "") + key.toLowerCase();
  const next: TypedPrefix = { text, at };
  const current = state.open ? clampIndex(state.active, labels.length) : selected;
  const find = (prefix: string, from: number) =>
    labels
      .map((_, step) => (from + step) % labels.length)
      .find((index) => labels[index]?.toLowerCase().startsWith(prefix));
  const first = [...text][0] ?? text;
  const match =
    find(text, continues ? current : current + 1) ??
    ([...text].every((char) => char === first) ? find(first, current + 1) : undefined);
  if (match === undefined) return { typed: next, outcome: { state, commit: null, handled: false } };
  return {
    typed: next,
    outcome: state.open
      ? { state: { open: true, active: match }, commit: null, handled: true }
      : { state: closedDropdown(match), commit: match, handled: true },
  };
}
