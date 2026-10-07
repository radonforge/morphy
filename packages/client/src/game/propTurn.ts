import {
  PROP_TURN_FINE_STEP,
  PROP_TURN_SNAP,
  PROP_TURN_SPEED,
  PROP_TURN_TAP_MS,
} from "@morphy/shared";

const GRID_EPSILON = 1e-6;
const MS_PER_SECOND = 1_000;

/** The Q/E press in progress: its direction, how long it has been held, the yaw it began at and whether Shift was down during it. */
export interface PropTurnPress {
  dir: -1 | 0 | 1;
  heldMs: number;
  from: number;
  coarse: boolean;
}

export const PROP_TURN_IDLE: PropTurnPress = { dir: 0, heldMs: 0, from: 0, coarse: false };

/** What the held keys ask of the disguise this frame: E is +1, Q is -1, and `coarse` is Shift. */
export interface PropTurnInput {
  dir: -1 | 0 | 1;
  coarse: boolean;
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

function tapStep(coarse: boolean): number {
  return coarse ? PROP_TURN_SNAP : PROP_TURN_FINE_STEP;
}

/**
 * Advances the disguise's yaw by one frame of Q/E.
 *
 * While a key is held the disguise spins at `PROP_TURN_SPEED`. A press released
 * within `PROP_TURN_TAP_MS` is a tap instead: the yaw lands on the next
 * `PROP_TURN_FINE_STEP` past where the press began, or the next `PROP_TURN_SNAP`
 * when Shift was down at any point of it. Inside that window the spin stops at
 * the tap's target, so a tap never overshoots and swings back. Reversing without
 * a release starts a new press.
 */
export function advancePropTurn(
  press: PropTurnPress,
  rot: number,
  input: PropTurnInput,
  deltaSeconds: number,
): { press: PropTurnPress; rot: number } {
  if (input.dir !== 0) {
    const current =
      press.dir === input.dir ? press : { dir: input.dir, heldMs: 0, from: rot, coarse: false };
    const next = {
      ...current,
      heldMs: current.heldMs + deltaSeconds * MS_PER_SECOND,
      coarse: current.coarse || input.coarse,
    };
    const spun = wrapAngle(rot + input.dir * PROP_TURN_SPEED * deltaSeconds);
    if (next.heldMs >= PROP_TURN_TAP_MS) return { press: next, rot: spun };
    const target = nextGridAngle(next.from, input.dir, tapStep(next.coarse));
    const reach = wrapAngle(target - next.from) * input.dir;
    const travelled = wrapAngle(spun - next.from) * input.dir;
    return { press: next, rot: travelled > reach ? target : spun };
  }
  if (press.dir !== 0 && press.heldMs < PROP_TURN_TAP_MS) {
    return {
      press: PROP_TURN_IDLE,
      rot: nextGridAngle(press.from, press.dir, tapStep(press.coarse)),
    };
  }
  return { press: PROP_TURN_IDLE, rot: wrapAngle(rot) };
}
