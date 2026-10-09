import {
  PROP_FREE_TURN_SPEED,
  PROP_TURN_SPEED,
  PROP_TURN_STEPS_DEG,
  PROP_TURN_TAP_MS,
} from "@morphy/shared";
import { storageGet, storageSet } from "../safeStorage";

const GRID_EPSILON = 1e-6;
const MS_PER_SECOND = 1_000;
const DEGREES_PER_HALF_TURN = 180;
const TURN_STEP_STORAGE_KEY = "morphy:turn-step";

export const FREE_TURN = "free";

/** How many degrees a tap of Q/E turns the disguise by. */
export type PropTurnStep = (typeof PROP_TURN_STEPS_DEG)[number];

/** How Q/E turn the disguise: smoothly and slowly while held (`free`), or by a step on a tap and spinning on a hold. */
export type PropTurnMode = typeof FREE_TURN | PropTurnStep;

/** The modes in the order X cycles them; the first is the default. */
export const PROP_TURN_MODES: readonly PropTurnMode[] = [FREE_TURN, ...PROP_TURN_STEPS_DEG];

/**
 * The Q/E press in progress: its direction, how long it has been held, the yaw it began at and the
 * mode it turns by. One object per player, updated in place every frame by `advancePropTurn`.
 */
export interface PropTurnPress {
  dir: -1 | 0 | 1;
  heldMs: number;
  from: number;
  mode: PropTurnMode;
}

/** A press with no key down. */
export function idlePropTurn(): PropTurnPress {
  return { dir: 0, heldMs: 0, from: 0, mode: FREE_TURN };
}

/** Drops the press in progress, as if its key had never been down. */
export function resetPropTurn(press: PropTurnPress): void {
  press.dir = 0;
  press.heldMs = 0;
}

/** A stored turn mode: `free` or one of `PROP_TURN_STEPS_DEG`; anything else is the default, free. */
export function parseTurnMode(raw: string | null): PropTurnMode {
  const value = Number(raw);
  return PROP_TURN_STEPS_DEG.find((step) => step === value) ?? FREE_TURN;
}

/** The mode X moves to from `mode`, wrapping from the last back to the first. */
export function nextTurnMode(mode: PropTurnMode): PropTurnMode {
  const index = PROP_TURN_MODES.indexOf(mode);
  return PROP_TURN_MODES[(index + 1) % PROP_TURN_MODES.length] ?? FREE_TURN;
}

/** The label the bar and the feed show for `mode`. */
export function turnModeLabel(mode: PropTurnMode): string {
  return mode === FREE_TURN ? FREE_TURN : `${mode}°`;
}

export function turnMode(): PropTurnMode {
  return parseTurnMode(storageGet(TURN_STEP_STORAGE_KEY));
}

export function setTurnMode(mode: PropTurnMode): void {
  storageSet(TURN_STEP_STORAGE_KEY, String(mode));
}

function stepRadians(step: PropTurnStep): number {
  return (step * Math.PI) / DEGREES_PER_HALF_TURN;
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** The first multiple of `step` strictly past `from` in direction `dir`. */
export function nextGridAngle(from: number, dir: 1 | -1, step: number): number {
  const cells = from / step;
  const index =
    dir > 0 ? Math.floor(cells + GRID_EPSILON) + 1 : Math.ceil(cells - GRID_EPSILON) - 1;
  return wrapAngle(index * step);
}

/**
 * Advances the disguise's yaw by one frame of Q/E, where `dir` is +1 for E,
 * -1 for Q and 0 for neither, and returns the new yaw. `press` is updated in
 * place, so a frame allocates nothing.
 *
 * In `free` mode the disguise turns at `PROP_FREE_TURN_SPEED` while a key is held
 * and stays where it is on release, so a tap is a short turn. In a stepped mode
 * it spins at `PROP_TURN_SPEED` while held, and a press released
 * within `PROP_TURN_TAP_MS` is a tap instead: the yaw lands on the next multiple
 * of the step in degrees past where the press began, the mode as it was when the
 * press began. Inside that window the spin stops at the tap's target, so a tap
 * never overshoots and swings back. Reversing without a release starts a new press.
 */
export function advancePropTurn(
  press: PropTurnPress,
  rot: number,
  dir: -1 | 0 | 1,
  mode: PropTurnMode,
  deltaSeconds: number,
): number {
  if (dir !== 0) {
    if (press.dir !== dir) {
      press.dir = dir;
      press.heldMs = 0;
      press.from = rot;
      press.mode = mode;
    }
    if (press.mode === FREE_TURN) {
      return wrapAngle(rot + dir * PROP_FREE_TURN_SPEED * deltaSeconds);
    }
    press.heldMs += deltaSeconds * MS_PER_SECOND;
    const spun = wrapAngle(rot + dir * PROP_TURN_SPEED * deltaSeconds);
    if (press.heldMs >= PROP_TURN_TAP_MS) return spun;
    const target = nextGridAngle(press.from, dir, stepRadians(press.mode));
    const reach = wrapAngle(target - press.from) * dir;
    const travelled = wrapAngle(spun - press.from) * dir;
    return travelled > reach ? target : spun;
  }
  if (press.dir === 0) return wrapAngle(rot);
  const landed =
    press.mode !== FREE_TURN && press.heldMs < PROP_TURN_TAP_MS
      ? nextGridAngle(press.from, press.dir, stepRadians(press.mode))
      : wrapAngle(rot);
  resetPropTurn(press);
  return landed;
}
