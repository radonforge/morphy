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
