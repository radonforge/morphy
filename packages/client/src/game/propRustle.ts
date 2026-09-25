import { MOVE_SPEED, RUN_MULTIPLIER_PROP } from "@morphy/shared";
import { STEP_DISTANCE } from "./movement";

/** Faster than a prop can walk and slower than it runs: past this it is running. */
const RUN_SPEED_THRESHOLD = (MOVE_SPEED * (1 + RUN_MULTIPLIER_PROP)) / 2;
/** A jump this large between two frames is a teleport, not a stride. */
const TELEPORT_SKIP = 2;
const SPEED_DAMP = 1e-2;

/** Where a remote prop was last frame, how far it has come since its last rustle, how fast it goes. */
export interface Stride {
  x: number;
  z: number;
  travelled: number;
  speed: number;
}

export type Rustle = "walk" | "run";

/**
 * Advance a remote prop's stride by one frame, from where its synced position
 * now is. A prop rustles once per {@link STEP_DISTANCE} it covers, the same
 * cadence as a character's footsteps, and not at all while it stands still;
 * `"run"` marks a rustle made at a prop's running pace. Pure, so it is tested
 * without a browser.
 */
export function advanceStride(
  stride: Stride | undefined,
  x: number,
  z: number,
  dt: number,
): { stride: Stride; rustle: Rustle | null } {
  if (!stride) return { stride: { x, z, travelled: 0, speed: 0 }, rustle: null };
  const moved = Math.hypot(x - stride.x, z - stride.z);
  if (moved > TELEPORT_SKIP) return { stride: { x, z, travelled: 0, speed: 0 }, rustle: null };
  const pace = dt > 0 ? moved / dt : 0;
  const speed = stride.speed + (pace - stride.speed) * (1 - SPEED_DAMP ** dt);
  const travelled = stride.travelled + moved;
  if (travelled < STEP_DISTANCE) return { stride: { x, z, travelled, speed }, rustle: null };
  return {
    stride: { x, z, travelled: travelled - STEP_DISTANCE, speed },
    rustle: speed > RUN_SPEED_THRESHOLD ? "run" : "walk",
  };
}
