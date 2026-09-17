const WHEEL_STEP_DELTA = 90;
const WHEEL_GESTURE_GAP_MS = 40;
const WHEEL_RISE_FACTOR = 3;
const WHEEL_LINE_PX = 40;
const WHEEL_PAGE_PX = 400;

const STEP_BACK = -1;
const STEP_FORWARD = 1;
const NO_STEP = 0;

export type WheelAxis = "x" | "y";

export interface WheelDelta {
  x: number;
  y: number;
}

export interface WheelGesture {
  travel: number;
  armed: boolean;
  axis: WheelAxis | null;
  floor: number;
  lastAt: number;
}

export interface WheelOutcome {
  gesture: WheelGesture;
  /** Places to move along the carousel: `-1`, `1`, or `0` when this event resolves to nothing. */
  step: number;
}

export function initialWheelGesture(): WheelGesture {
  return { travel: 0, armed: true, axis: null, floor: Number.POSITIVE_INFINITY, lastAt: 0 };
}

/**
 * Wheel travel in pixels on both axes, whatever unit the device reports it in. A mouse notch
 * lands around 100 px while a trackpad reports single digits per event, so reading the sign of
 * one event alone makes a notch and a twitch of a finger mean the same thing.
 */
export function wheelDeltaPx(event: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}): WheelDelta {
  const scale =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? WHEEL_LINE_PX
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? WHEEL_PAGE_PX
        : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

/**
 * Fold one wheel event into the gesture and report whether it completes a step.
 *
 * At most one step per gesture. A step disarms the wheel and only a fresh push re-arms it, off
 * the one thing inertia cannot fake: it decays. macOS keeps emitting wheel events for about a
 * second after the fingers leave the trackpad, each smaller than the last, so a magnitude that
 * climbs back above the running floor is the user pressing again. The floor is tracked only
 * while disarmed; letting the gesture's own ramp-up set it is what made an earlier attempt
 * fire several times per swipe and need a cooldown to hide it.
 *
 * The axis is whichever one each gesture opens on, and is held for the rest of it, re-picked
 * whenever a gesture opens, not only after a step, or a swipe too small to move the carousel
 * would leave the axis pinned and swallow everything arriving on the other one. The rail's
 * arrows, the ghosts flanking the stage and the arrow keys all read left-to-right, so a
 * sideways swipe is the gesture that matches what is on screen; a plain mouse wheel has no
 * horizontal axis at all, so both are taken. Choosing per event instead would let a crooked
 * swipe flip axis halfway and cancel itself out.
 *
 * Silence re-arms too, at a threshold that separates the devices rather than guessing at one:
 * inertia arrives every frame, while wheel notches are tens of milliseconds apart even when
 * rolled hard. Waiting for silence *alone* was the first mistake: browsing quickly lays the
 * next swipe over the previous one's inertia, the gap never comes and the picker goes dead.
 *
 * Travel below `WHEEL_STEP_DELTA` survives a pause on the same axis, so nudges too small to
 * move the carousel add up across gestures instead of being thrown away. Clearing it on every
 * pause reads as the tidier rule but measures far worse: a run of gentle swipes then never
 * reaches the threshold at all and the picker answers none of them.
 */
export function feedWheel(gesture: WheelGesture, delta: WheelDelta, now: number): WheelOutcome {
  const { x, y } = delta;
  if (x === 0 && y === 0) return { gesture, step: NO_STEP };

  const dominant: WheelAxis = Math.abs(x) > Math.abs(y) ? "x" : "y";
  const sample = Math.abs(dominant === "x" ? x : y);
  const quiet = now - gesture.lastAt >= WHEEL_GESTURE_GAP_MS;

  let { travel, armed, axis, floor } = gesture;
  const opens = quiet || (!armed && sample > floor * WHEEL_RISE_FACTOR);
  if (opens) {
    armed = true;
    if (axis !== dominant) {
      axis = dominant;
      travel = 0;
    }
  }
  if (!armed) {
    return {
      gesture: { travel, armed, axis, floor: Math.min(floor, sample), lastAt: now },
      step: NO_STEP,
    };
  }

  axis = axis ?? dominant;
  const travelled = axis === "x" ? x : y;
  if (travelled === 0) {
    return { gesture: { travel, armed, axis, floor, lastAt: now }, step: NO_STEP };
  }

  if (travelled > 0 !== travel > 0) travel = 0;
  travel += travelled;
  if (Math.abs(travel) < WHEEL_STEP_DELTA) {
    return { gesture: { travel, armed, axis, floor, lastAt: now }, step: NO_STEP };
  }

  return {
    gesture: {
      travel: 0,
      armed: false,
      axis: null,
      floor: Math.abs(travelled),
      lastAt: now,
    },
    step: travel > 0 ? STEP_FORWARD : STEP_BACK,
  };
}
