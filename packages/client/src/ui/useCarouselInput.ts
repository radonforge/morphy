import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { STEP_BACK, STEP_FORWARD } from "./carousel";
import { feedWheel, initialWheelGesture, wheelDeltaPx } from "./carouselWheel";

const STEP_COOLDOWN_MS = 180;

export interface CarouselInput {
  onWheel: (event: React.WheelEvent<HTMLElement>) => void;
}

/**
 * The pointer and keyboard surface every lobby carousel shares: wheel and trackpad gestures on
 * the backdrop, arrow keys while it is open, and Escape to dismiss. The wheel gesture is folded
 * by {@link feedWheel}, which owns the reasoning about trackpad inertia.
 *
 * Held arrow keys are rate-limited but the first press of each is not: the cooldown applies
 * only to `repeat` events, so a deliberate press always lands however fast they come.
 */
export function useCarouselInput(
  active: boolean,
  onStep: (delta: number) => void,
  onClose: () => void,
): CarouselInput {
  const gesture = useRef(initialWheelGesture());
  const lastStepAt = useRef(0);

  useEffect(() => {
    if (active) gesture.current = initialWheelGesture();
  }, [active]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      const outcome = feedWheel(gesture.current, wheelDeltaPx(event), performance.now());
      gesture.current = outcome.gesture;
      if (outcome.step !== 0) onStep(outcome.step);
    },
    [onStep],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const now = performance.now();
      if (event.repeat && now - lastStepAt.current < STEP_COOLDOWN_MS) return;
      lastStepAt.current = now;
      onStep(event.key === "ArrowLeft" ? STEP_BACK : STEP_FORWARD);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onStep, onClose]);

  return { onWheel };
}
