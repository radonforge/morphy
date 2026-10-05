/**
 * A failing lamp: steady for long stretches, then a short burst of stutter, then steady again.
 * The gaps and the stutter are random, so it never settles into a rhythm the eye can predict.
 * A pure fold over elapsed time with the randomness injected, so it can be tested.
 */

const GAP_MIN_S = 7;
const GAP_MAX_S = 18;
const BURST_MIN_S = 0.5;
const BURST_MAX_S = 1.4;
const STEP_MIN_S = 0.04;
const STEP_MAX_S = 0.16;
const DIM_LEVEL = 0.12;
const DIM_CHANCE = 0.55;

export interface FlickerState {
  /** Seconds since the lamp was hung. */
  now: number;
  /** When the next burst starts, or the current one ends while `inBurst`. */
  edge: number;
  inBurst: boolean;
  /** When the stutter next changes level, inside a burst. */
  nextStep: number;
  level: number;
}

const between = (random: () => number, min: number, max: number): number =>
  min + random() * (max - min);

export function beginFlicker(random: () => number): FlickerState {
  return {
    now: 0,
    edge: between(random, GAP_MIN_S, GAP_MAX_S),
    inBurst: false,
    nextStep: 0,
    level: 1,
  };
}

/** Advance the lamp by `delta` seconds; `level` is the share of its intensity it gives now. */
export function advanceFlicker(
  state: FlickerState,
  delta: number,
  random: () => number,
): FlickerState {
  const now = state.now + delta;
  if (!state.inBurst) {
    if (now < state.edge) return { ...state, now };
    return {
      now,
      edge: now + between(random, BURST_MIN_S, BURST_MAX_S),
      inBurst: true,
      nextStep: now + between(random, STEP_MIN_S, STEP_MAX_S),
      level: DIM_LEVEL,
    };
  }
  if (now >= state.edge) {
    return {
      now,
      edge: now + between(random, GAP_MIN_S, GAP_MAX_S),
      inBurst: false,
      nextStep: 0,
      level: 1,
    };
  }
  if (now < state.nextStep) return { ...state, now };
  return {
    ...state,
    now,
    nextStep: now + between(random, STEP_MIN_S, STEP_MAX_S),
    level: random() < DIM_CHANCE ? DIM_LEVEL : 1,
  };
}
