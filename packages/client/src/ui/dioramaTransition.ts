import type { MapId } from "@morphy/shared";

const EXIT_DURATION_S = 0.3;
const ENTER_DURATION_S = 0.35;
const STAGGER_WINDOW_S = 0.45;
const ENTER_OFFSET_S = 0.25;

/**
 * The whole cross, start to finish. The stage derives its shadow settle and its motion boost
 * from this one number rather than keeping its own: a boost that ends early drops the tail of
 * the sweep to 30 fps, and a shadow map that freezes early bakes a world that is half gone.
 */
export const DIORAMA_TRANSITION_S = ENTER_OFFSET_S + STAGGER_WINDOW_S + ENTER_DURATION_S;

const EXIT_TOTAL_S = STAGGER_WINDOW_S + EXIT_DURATION_S;
const VEIL_PEAK_S = EXIT_TOTAL_S / 2;

interface Settled {
  phase: "settled";
  current: MapId;
  next: null;
  exit: number;
  enter: number;
  bake: number;
}

interface Pending {
  phase: "loading" | "crossing";
  current: MapId | null;
  next: MapId;
  exit: number;
  enter: number;
  bake: number;
}

/**
 * Which worlds are on the stage and how far through swapping them it is.
 *
 * `current` is the world holding the stage and `next` the one arriving, so at most two dioramas
 * are ever mounted. `current` is null only for the first arrival of all, which has nothing to
 * dissolve and rides the same ramp as every later one.
 *
 * The two ramps run on clocks of their own. `exit` belongs to the world on screen and survives a
 * retarget, so a step taken mid-cross never rewinds or cuts what the player is looking at;
 * `enter` belongs to whichever world is arriving and restarts with it. `bake` counts the moments
 * new geometry starts moving, which is what the shadow map and the materialize burst key off:
 * the map prop changing is too early, since the cross waits for the incoming models to load.
 */
export type DioramaTransition = Settled | Pending;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stagger(index: number, count: number): number {
  return count <= 1 ? 0 : (index / (count - 1)) * STAGGER_WINDOW_S;
}

function ramp(elapsed: number, delay: number, duration: number): number {
  return clamp01((elapsed - delay) / duration);
}

/** The stage's opening state: one world on its way in, nothing to see yet. */
export function beginTransition(map: MapId): DioramaTransition {
  return { phase: "loading", current: null, next: map, exit: 0, enter: 0, bake: 0 };
}

/**
 * Aim the stage at `map`.
 *
 * Two dioramas is the ceiling, so stepping mid-cross has to drop one of them, and which one is
 * the whole question: whatever is dropped leaves in a single frame. Until the world on screen
 * has finished dissolving it stays, frozen where its ramp had reached, and the half-formed
 * arrival is the one dropped, which early in a cross is still at nothing. Only once the leaving
 * world is actually gone does the arrival take the stage, because dropping it there would be
 * dropping everything. Stepping faster than the timeline therefore degrades to near-instant
 * swaps, and never to an empty stage or a third mounted diorama.
 *
 * Stepping back to the world still on screen is not a swap at all: the pending one is dropped and
 * the dissolve it had started is undone.
 */
export function retarget(state: DioramaTransition, map: MapId): DioramaTransition {
  const heading = state.next ?? state.current;
  if (heading === map) return state;
  if (state.phase === "settled") {
    return {
      phase: "loading",
      current: state.current,
      next: map,
      exit: 0,
      enter: 0,
      bake: state.bake,
    };
  }
  const holding = state.exit < EXIT_TOTAL_S;
  if (holding && state.current === map) {
    return { phase: "settled", current: map, next: null, exit: 0, enter: 0, bake: state.bake };
  }
  if (holding) {
    return {
      phase: "loading",
      current: state.current,
      next: map,
      exit: state.exit,
      enter: 0,
      bake: state.bake,
    };
  }
  return { phase: "loading", current: state.next, next: map, exit: 0, enter: 0, bake: state.bake };
}

/**
 * Every model of the incoming world has resolved, so the ramps can start. The arrival skips as
 * much of its head start as the departure has already taken: a resumed dissolve is that much
 * closer to leaving a hole, and the offset exists only to keep the two sweeps from overlapping
 * exactly.
 */
export function ready(state: DioramaTransition, reduced: boolean): DioramaTransition {
  if (state.phase !== "loading") return state;
  const bake = state.bake + 1;
  if (reduced) {
    return { phase: "settled", current: state.next, next: null, exit: 0, enter: 0, bake };
  }
  return {
    phase: "crossing",
    current: state.current,
    next: state.next,
    exit: state.exit,
    enter: Math.min(state.exit, ENTER_OFFSET_S),
    bake,
  };
}

export function tick(state: DioramaTransition, delta: number): DioramaTransition {
  if (state.phase !== "crossing") return state;
  const enter = state.enter + delta;
  if (enter >= DIORAMA_TRANSITION_S) {
    return {
      phase: "settled",
      current: state.next,
      next: null,
      exit: 0,
      enter: 0,
      bake: state.bake,
    };
  }
  return { ...state, exit: state.exit + delta, enter };
}

/** The dioramas to mount, outgoing first. Never more than two. */
export function liveMaps(state: DioramaTransition): MapId[] {
  return [state.current, state.next].filter((map): map is MapId => map !== null);
}

/**
 * The world whose theme the sky, lights and fog follow. It flips at the veil's peak, which is
 * the one moment in the cross when the sky is fully hidden.
 */
export function stageMap(state: DioramaTransition): MapId {
  if (state.phase === "settled") return state.current;
  if (state.current === null) return state.next;
  if (state.exit >= VEIL_PEAK_S) return state.next;
  return state.current;
}

/**
 * Scale of set piece `index` of `count` in the diorama of `map`, staggered across the sweep so
 * a world leaves and arrives as matter dissolving and forming rather than a block appearing.
 *
 * Keyed on the map rather than on a slot the caller tracks, so a piece whose render is a frame
 * behind the clock still reads the right end of its ramp: the frame a cross settles, the world
 * that just left is no longer in the state at all and stays at zero until React drops it.
 */
export function pieceScale(
  state: DioramaTransition,
  map: MapId,
  index: number,
  count: number,
): number {
  if (state.next === map) {
    if (state.phase !== "crossing") return 0;
    return ramp(state.enter, ENTER_OFFSET_S + stagger(index, count), ENTER_DURATION_S);
  }
  if (state.current !== map) return 0;
  if (state.phase === "settled") return 1;
  return 1 - ramp(state.exit, stagger(index, count), EXIT_DURATION_S);
}

/**
 * How solid the sky veil is. `Stars` and `Sky` cannot be alpha faded, their shaders carrying no
 * opacity uniform between them, so the sky is dissolved into the scene's own fog colour and
 * reformed instead. That also covers Mars, whose sky is no component at all.
 *
 * It rides the departure's clock, which is the one that survives a retarget, so a step taken
 * mid-cross leaves the sky where it stands instead of snapping it back.
 */
export function veilOpacity(state: DioramaTransition): number {
  if (state.phase === "settled") return 0;
  if (state.exit <= VEIL_PEAK_S) return clamp01(state.exit / VEIL_PEAK_S);
  return clamp01((EXIT_TOTAL_S - state.exit) / (EXIT_TOTAL_S - VEIL_PEAK_S));
}

/** Whether the veil is on screen at all, which is the only time the stage mounts it. */
export function isVeiled(state: DioramaTransition): boolean {
  return state.phase !== "settled" && state.exit > 0;
}

/** Whether both states render the same stage, which is true of all but a few frames of a cross. */
export function sameStageRender(a: DioramaTransition, b: DioramaTransition): boolean {
  return (
    a.phase === b.phase &&
    a.current === b.current &&
    a.next === b.next &&
    a.bake === b.bake &&
    isVeiled(a) === isVeiled(b) &&
    stageMap(a) === stageMap(b)
  );
}
