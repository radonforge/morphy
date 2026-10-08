import type { Vec3 } from "@morphy/shared";
import {
  AIM_DRIFT_MAX_RAD,
  AIM_DRIFT_MIN_RAD,
  AIM_DRIFT_TAU_S,
  AIM_FIRE_ERROR_RAD,
  AIM_FOLLOW_UP_JITTER_MS,
  AIM_OVERSHOOT_CHANCE,
  AIM_OVERSHOOT_MAX_FRACTION,
  AIM_SPREAD_BASE_RAD,
  AIM_SPREAD_PER_LATERAL_SPEED_RAD,
  AIM_SPREAD_PER_METER_RAD,
  AIM_SPREAD_PER_SELF_SPEED_RAD,
  AIM_SPREAD_SCALE_MAX,
  AIM_SPREAD_SCALE_MIN,
  AIM_VELOCITY_SMOOTHING_S,
  lerp,
  REACTION_FLOOR_FRACTION,
  REACTION_JITTER,
  REACTION_MS_MAX,
  REACTION_MS_MIN,
} from "./config";

const MS_PER_SECOND = 1_000;

/** A source of uniform draws in [0, 1), `Math.random` or a seeded `makeRng`. */
export type Rng = () => number;

/** What makes a shot hard, as the hunter sees it the moment it fires. */
export interface ShotConditions {
  /** How fast the target moves across the line of sight, in m/s. */
  lateralSpeed: number;
  distance: number;
  /** How fast the hunter itself was moving, in m/s. */
  selfSpeed: number;
}

/** A standard normal draw (Box-Muller), from two uniform draws of `rng`. */
export function gaussian(rng: Rng): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * The standard deviation, in radians, of the error a shot leaves the
 * crosshair with: it grows with how fast the target crosses the line of
 * sight, how far it is and how fast the hunter itself moves, and shrinks with
 * difficulty.
 */
export function aimSpread(shot: ShotConditions, difficulty: number): number {
  const scale = lerp(AIM_SPREAD_SCALE_MAX, AIM_SPREAD_SCALE_MIN, difficulty);
  return (
    scale *
    (AIM_SPREAD_BASE_RAD +
      AIM_SPREAD_PER_LATERAL_SPEED_RAD * shot.lateralSpeed +
      AIM_SPREAD_PER_METER_RAD * shot.distance +
      AIM_SPREAD_PER_SELF_SPEED_RAD * shot.selfSpeed)
  );
}

/**
 * The chance a hunter pulls the trigger on this tick with its crosshair
 * `aimError` radians off the target: certain on target, falling as a Gaussian
 * of {@link AIM_FIRE_ERROR_RAD} off it.
 */
export function fireChance(aimError: number): number {
  const ratio = aimError / AIM_FIRE_ERROR_RAD;
  return Math.exp(-0.5 * ratio * ratio);
}

/** The reaction time to a newly acquired target: the difficulty's mean, drawn with jitter, never under its floor. */
export function reactionDelayMs(difficulty: number, rng: Rng): number {
  const mean = lerp(REACTION_MS_MAX, REACTION_MS_MIN, difficulty);
  return mean * Math.max(REACTION_FLOOR_FRACTION, 1 + REACTION_JITTER * gaussian(rng));
}

/** The beat past the fire cooldown a hunter takes before its next shot. */
export function followUpDelayMs(rng: Rng): number {
  return Math.abs(gaussian(rng)) * AIM_FOLLOW_UP_JITTER_MS;
}

/**
 * How far past a new target the flick onto it carries, signed like the turn
 * `turnRad` it adds to: usually nothing, now and then a fraction of the turn.
 */
export function overshootRad(turnRad: number, rng: Rng): number {
  if (rng() >= AIM_OVERSHOOT_CHANCE) return 0;
  return turnRad * AIM_OVERSHOOT_MAX_FRACTION * rng();
}

/**
 * One step of the crosshair's wander around its target: an Ornstein-Uhlenbeck
 * walk that keeps a standard deviation lerped by difficulty and forgets its
 * past over {@link AIM_DRIFT_TAU_S}, so it reads as a hand, not as noise.
 */
export function driftStep(drift: number, dt: number, difficulty: number, rng: Rng): number {
  const sigma = lerp(AIM_DRIFT_MAX_RAD, AIM_DRIFT_MIN_RAD, difficulty);
  const decay = Math.exp(-dt / AIM_DRIFT_TAU_S);
  return drift * decay + sigma * Math.sqrt(1 - decay * decay) * gaussian(rng);
}

/** The speed of a velocity across the line of sight toward (dx, dz). */
export function lateralSpeed(vx: number, vz: number, dx: number, dz: number): number {
  const length = Math.hypot(dx, dz);
  if (length === 0) return 0;
  return Math.abs(vx * dz - vz * dx) / length;
}

/** The unit vector of a heading (yaw from +Z toward +X, as `rot` is) and a pitch above the horizon. */
export function directionOf(yaw: number, pitch: number): Vec3 {
  const flat = Math.cos(pitch);
  return { x: Math.sin(yaw) * flat, y: Math.sin(pitch), z: Math.cos(yaw) * flat };
}

/**
 * A velocity read off successive sightings of one body, smoothed over
 * {@link AIM_VELOCITY_SMOOTHING_S}: the first two sightings set it outright,
 * every later one pulls it toward the latest step.
 */
export class VelocityEstimate {
  vx = 0;
  vz = 0;
  private last: { x: number; z: number; at: number } | null = null;
  private primed = false;

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  observe(x: number, z: number, now: number): void {
    const last = this.last;
    this.last = { x, z, at: now };
    if (!last) return;
    const elapsed = (now - last.at) / MS_PER_SECOND;
    if (elapsed <= 0) return;
    const weight = this.primed ? Math.min(1, elapsed / AIM_VELOCITY_SMOOTHING_S) : 1;
    this.vx += ((x - last.x) / elapsed - this.vx) * weight;
    this.vz += ((z - last.z) / elapsed - this.vz) * weight;
    this.primed = true;
  }

  reset(): void {
    this.vx = 0;
    this.vz = 0;
    this.last = null;
    this.primed = false;
  }
}
