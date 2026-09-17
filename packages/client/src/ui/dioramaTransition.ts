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

const VEIL_PEAK_S = DIORAMA_TRANSITION_S / 2;

interface Settled {
  phase: "settled";
  current: MapId;
  next: null;
  elapsed: number;
  bake: number;
}

interface Pending {
  phase: "loading" | "crossing";
  current: MapId | null;
  next: MapId;
  elapsed: number;
  bake: number;
}

/**
 * Which worlds are on the stage and how far through swapping them it is.
 *
 * `current` is the world holding the stage and `next` the one arriving, so at most two dioramas
 * are ever mounted. `current` is null only for the first arrival of all, which has nothing to
 * dissolve and rides the same ramp as every later one. `bake` counts the moments new geometry
 * starts moving, which is what the shadow map and the materialize burst key off: the map prop
 * changing is too early, since the cross waits for the incoming models to load.
 */
export type DioramaTransition = Settled | Pending;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stagger(index: number, count: number): number {
  return count === 0 ? 0 : (index / count) * STAGGER_WINDOW_S;
}

function ramp(elapsed: number, delay: number, duration: number): number {
  return clamp01((elapsed - delay) / duration);
}

/** The stage's opening state: one world on its way in, nothing to see yet. */
export function beginTransition(map: MapId): DioramaTransition {
  return { phase: "loading", current: null, next: map, elapsed: 0, bake: 0 };
}

/**
 * Aim the stage at `map`.
 *
 * A retarget while the incoming world is still loading only swaps the target: the world on
 * screen is untouched, so there is no frame in which the stage is empty. A retarget mid-cross
 * snaps that cross to its end first, which costs nothing but the rest of the ramp because the
 * arriving world is loaded by then. Stepping faster than the timeline therefore degrades to
 * near-instant swaps, and never to a third mounted diorama.
 */
export function retarget(state: DioramaTransition, map: MapId): DioramaTransition {
  const heading = state.next ?? state.current;
  if (heading === map) return state;
  if (state.phase === "loading") {
    if (state.current === map) {
      return { phase: "settled", current: map, next: null, elapsed: 0, bake: state.bake };
    }
    return { ...state, next: map, elapsed: 0 };
  }
  const current = state.phase === "crossing" ? state.next : state.current;
  return { phase: "loading", current, next: map, elapsed: 0, bake: state.bake };
}

/** Every model of the incoming world has resolved, so the ramps can start. */
export function ready(state: DioramaTransition, reduced: boolean): DioramaTransition {
  if (state.phase !== "loading") return state;
  const bake = state.bake + 1;
  if (reduced) {
    return { phase: "settled", current: state.next, next: null, elapsed: 0, bake };
  }
  return { phase: "crossing", current: state.current, next: state.next, elapsed: 0, bake };
}

export function tick(state: DioramaTransition, delta: number): DioramaTransition {
  if (state.phase !== "crossing") return state;
  const elapsed = state.elapsed + delta;
  if (elapsed >= DIORAMA_TRANSITION_S) {
    return { phase: "settled", current: state.next, next: null, elapsed: 0, bake: state.bake };
  }
  return { ...state, elapsed };
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
  if (state.phase === "crossing" && state.elapsed >= VEIL_PEAK_S) return state.next;
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
    return ramp(state.elapsed, ENTER_OFFSET_S + stagger(index, count), ENTER_DURATION_S);
  }
  if (state.current !== map) return 0;
  if (state.phase !== "crossing") return 1;
  return 1 - ramp(state.elapsed, stagger(index, count), EXIT_DURATION_S);
}

/**
 * How solid the sky veil is. `Stars` and `Sky` cannot be alpha faded, their shaders carrying no
 * opacity uniform between them, so the sky is dissolved into the scene's own fog colour and
 * reformed instead. That also covers Mars, whose sky is no component at all.
 */
export function veilOpacity(state: DioramaTransition): number {
  if (state.phase !== "crossing") return 0;
  if (state.elapsed <= VEIL_PEAK_S) return clamp01(state.elapsed / VEIL_PEAK_S);
  return clamp01((DIORAMA_TRANSITION_S - state.elapsed) / (DIORAMA_TRANSITION_S - VEIL_PEAK_S));
}

/** Whether both states render the same stage, which is true of all but a few frames of a cross. */
export function sameStageRender(a: DioramaTransition, b: DioramaTransition): boolean {
  return (
    a.phase === b.phase &&
    a.current === b.current &&
    a.next === b.next &&
    a.bake === b.bake &&
    stageMap(a) === stageMap(b)
  );
}
