import { type RenderCallback, useFrame } from "@react-three/fiber";
import { useState } from "react";

/**
 * `useFrame` whose errors reach React. R3F runs frame callbacks from a bare
 * `requestAnimationFrame` loop that re-arms itself before calling them, so a throw
 * there is invisible to error boundaries: the view freezes and throws again every
 * frame. Catching it and rethrowing on the next render hands it to the match's
 * error boundary, which offers a rejoin.
 */
export function useGuardedFrame(callback: RenderCallback, priority?: number): void {
  const [crash, setCrash] = useState<{ error: unknown } | null>(null);
  if (crash) throw crash.error;
  useFrame((state, delta, frame) => {
    try {
      callback(state, delta, frame);
    } catch (error) {
      setCrash({ error });
    }
  }, priority);
}
