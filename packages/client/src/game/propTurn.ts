import { PROP_TURN_SPEED, PROP_TURN_STEPS_DEG, PROP_TURN_TAP_MS } from "@morphy/shared";
import { storageGet, storageSet } from "../safeStorage";

const GRID_EPSILON = 1e-6;
const MS_PER_SECOND = 1_000;
const DEGREES_PER_HALF_TURN = 180;
const TURN_STEP_STORAGE_KEY = "morphy:turn-step";

/** How many degrees a tap of Q/E turns the disguise by. */
export type PropTurnStep = (typeof PROP_TURN_STEPS_DEG)[number];

/**
 * The Q/E press in progress: its direction, how long it has been held, the yaw it began at and the
 * step it taps by. One object per player, updated in place every frame by `advancePropTurn`.
 */
export interface PropTurnPress {
  dir: -1 | 0 | 1;
  heldMs: number;
  from: number;
  step: PropTurnStep;
}

/** A press with no key down. */
export function idlePropTurn(): PropTurnPress {
  return { dir: 0, heldMs: 0, from: 0, step: PROP_TURN_STEPS_DEG[0] };
}

/** Drops the press in progress, as if its key had never been down. */
export function resetPropTurn(press: PropTurnPress): void {
  press.dir = 0;
  press.heldMs = 0;
}

function isTurnStep(value: number): value is PropTurnStep {
  return (PROP_TURN_STEPS_DEG as readonly number[]).includes(value);
}

/** A stored turn step; anything but one of `PROP_TURN_STEPS_DEG` is the default, the first. */
export function parseTurnStep(raw: string | null): PropTurnStep {
  const value = Number(raw);
  return raw !== null && isTurnStep(value) ? value : PROP_TURN_STEPS_DEG[0];
}

/** The step X moves to from `step`, wrapping from the last back to the first. */
export function nextTurnStep(step: PropTurnStep): PropTurnStep {
  const index = PROP_TURN_STEPS_DEG.indexOf(step);
  return PROP_TURN_STEPS_DEG[(index + 1) % PROP_TURN_STEPS_DEG.length] ?? PROP_TURN_STEPS_DEG[0];
}

export function turnStep(): PropTurnStep {
  return parseTurnStep(storageGet(TURN_STEP_STORAGE_KEY));
}

export function setTurnStep(step: PropTurnStep): void {
  storageSet(TURN_STEP_STORAGE_KEY, String(step));
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
 * While a key is held the disguise spins at `PROP_TURN_SPEED`. A press released
 * within `PROP_TURN_TAP_MS` is a tap instead: the yaw lands on the next multiple
 * of `step` degrees past where the press began, `step` as it was when the
 * press began. Inside that window the spin stops at the tap's target, so a tap
 * never overshoots and swings back. Reversing without a release starts a new press.
 */
export function advancePropTurn(
  press: PropTurnPress,
  rot: number,
  dir: -1 | 0 | 1,
  step: PropTurnStep,
  deltaSeconds: number,
): number {
  if (dir !== 0) {
    if (press.dir !== dir) {
      press.dir = dir;
      press.heldMs = 0;
      press.from = rot;
      press.step = step;
    }
    press.heldMs += deltaSeconds * MS_PER_SECOND;
    const spun = wrapAngle(rot + dir * PROP_TURN_SPEED * deltaSeconds);
    if (press.heldMs >= PROP_TURN_TAP_MS) return spun;
    const target = nextGridAngle(press.from, dir, stepRadians(press.step));
    const reach = wrapAngle(target - press.from) * dir;
    const travelled = wrapAngle(spun - press.from) * dir;
    return travelled > reach ? target : spun;
  }
  if (press.dir === 0) return wrapAngle(rot);
  const landed =
    press.heldMs < PROP_TURN_TAP_MS
      ? nextGridAngle(press.from, press.dir, stepRadians(press.step))
      : wrapAngle(rot);
  resetPropTurn(press);
  return landed;
}
