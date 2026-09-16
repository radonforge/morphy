import {
  AIR_CONTROL,
  FALL_GRAVITY_MULT,
  GRAVITY,
  JUMP_BUFFER_MS,
  JUMP_RELEASE_GRAVITY_MULT,
  JUMP_SPEED,
  type MapBounds,
  MOVE_ACCEL,
  MOVE_DECEL,
  MOVE_SPEED,
  PLAYER_HEIGHT,
  RUN_MULTIPLIER_HUNTER,
} from "@morphy/shared";

export const PLAYER_RADIUS = 0.4;
export const PLAYER_SEPARATION = PLAYER_RADIUS * 2;
export const STEP_HEIGHT = 0.35;
export const GROUND_EPSILON = 1e-3;
export const STEP_DISTANCE = 2.2;

const HEADING_MIN_SPEED = 0.4;
const HEADING_DAMP = 1e-8;

/**
 * `requestAnimationFrame` stops while a tab is hidden but the clock behind the
 * frame delta does not, so the first frame back carries the whole hidden
 * duration. Integrating it would fling the player across the map, held input
 * and all. Time past this bound is deliberately never simulated.
 *
 * Capping the frame also caps one step's displacement, which is what keeps
 * collision sound: the integrator tests the position it lands on rather than
 * the segment it crossed, so it would miss a collider narrower than a step.
 * `tests/client-movement.test.mjs` pins that margin against the real maps —
 * if a future prop is ever thin enough to slip through, that test fails rather
 * than the player quietly walking through a wall.
 */
const MAX_FRAME_SECONDS = 0.1;

/** Fastest a body can travel, and so the longest displacement one frame adds. */
export const MAX_BODY_SPEED = MOVE_SPEED * RUN_MULTIPLIER_HUNTER;

export const MAX_FRAME_DISPLACEMENT = MAX_BODY_SPEED * MAX_FRAME_SECONDS;

const LANDING_REFERENCE_SPEED = JUMP_SPEED * 2;

/**
 * A solid box for movement collision: Y-rotated by the angle whose cos/sin are
 * precomputed, spanning [yMin, yMax] vertically. Map colliders are axis-aligned
 * (cos 1, sin 0); prop parts carry their instance rotation, so long furniture
 * blocks by its true oriented footprint instead of a bounding circle.
 */
export interface ObbCollider {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hx: number;
  hz: number;
  yMin: number;
  yMax: number;
}

/** Mutable position, velocity and gait state of one body, advanced in place. */
export interface MovementBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  jumpBufferMs: number;
  jumpHeld: boolean;
  stepDistance: number;
}

export interface MovementInput {
  forward: number;
  strafe: number;
  yaw: number;
  run: boolean;
  jump: boolean;
}

export interface MovementWorld {
  colliders: ObbCollider[];
  bounds: MapBounds;
  runMultiplier: number;
}

/** What the caller needs after a frame: cues to play, and state to render. */
export interface MovementResult {
  footstep: boolean;
  jumped: boolean;
  landingImpact: number;
  support: number;
  speed: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Highest collider top the player's footprint circle overlaps that is no more
 * than a step above the feet — the surface the player stands on (base ground 0).
 */
export function supportHeightAt(
  x: number,
  z: number,
  footY: number,
  colliders: ObbCollider[],
): number {
  let best = 0;
  for (const c of colliders) {
    if (c.yMax <= best || c.yMax > footY + STEP_HEIGHT) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const ox = lx - clamp(lx, -c.hx, c.hx);
    const oz = lz - clamp(lz, -c.hz, c.hz);
    if (ox * ox + oz * oz < PLAYER_RADIUS * PLAYER_RADIUS) best = c.yMax;
  }
  return best;
}

/**
 * Lowest collider bottom at or above the player's head over the footprint
 * circle — the ceiling that caps upward motion (Infinity under open sky).
 * Keeps a jump under an elevated deck from entering the deck box, where
 * {@link resolveColliders} would otherwise shove the player sideways.
 */
function ceilingHeightAt(x: number, z: number, footY: number, colliders: ObbCollider[]): number {
  let best = Infinity;
  for (const c of colliders) {
    if (c.yMin >= best || c.yMin < footY + PLAYER_HEIGHT) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const ox = lx - clamp(lx, -c.hx, c.hx);
    const oz = lz - clamp(lz, -c.hz, c.hz);
    if (ox * ox + oz * oz < PLAYER_RADIUS * PLAYER_RADIUS) best = c.yMin;
  }
  return best;
}

/**
 * Push the body's footprint circle out of every solid box overlapping its
 * vertical span. Boxes whose top is within a step of the feet are walkable
 * (handled by {@link supportHeightAt}); boxes above the head are ignored.
 */
export function resolveColliders(
  body: { x: number; y: number; z: number },
  colliders: ObbCollider[],
): void {
  for (const c of colliders) {
    if (c.yMax <= body.y + STEP_HEIGHT || c.yMin >= body.y + PLAYER_HEIGHT) continue;
    const dx = body.x - c.x;
    const dz = body.z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const nx = clamp(lx, -c.hx, c.hx);
    const nz = clamp(lz, -c.hz, c.hz);
    const ox = lx - nx;
    const oz = lz - nz;
    const distSq = ox * ox + oz * oz;
    if (distSq >= PLAYER_RADIUS * PLAYER_RADIUS) continue;
    let pushX = 0;
    let pushZ = 0;
    if (distSq > 1e-8) {
      const dist = Math.sqrt(distSq);
      const push = PLAYER_RADIUS - dist;
      pushX = (ox / dist) * push;
      pushZ = (oz / dist) * push;
    } else {
      const toMinX = lx + c.hx;
      const toMaxX = c.hx - lx;
      const toMinZ = lz + c.hz;
      const toMaxZ = c.hz - lz;
      const minPen = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
      if (minPen === toMinX) pushX = -(toMinX + PLAYER_RADIUS);
      else if (minPen === toMaxX) pushX = toMaxX + PLAYER_RADIUS;
      else if (minPen === toMinZ) pushZ = -(toMinZ + PLAYER_RADIUS);
      else pushZ = toMaxZ + PLAYER_RADIUS;
    }
    body.x += pushX * c.cos + pushZ * c.sin;
    body.z += -pushX * c.sin + pushZ * c.cos;
  }
}

export function clampToBounds(body: { x: number; z: number }, bounds: MapBounds): void {
  body.x = clamp(body.x, bounds.min.x + PLAYER_RADIUS, bounds.max.x - PLAYER_RADIUS);
  body.z = clamp(body.z, bounds.min.z + PLAYER_RADIUS, bounds.max.z - PLAYER_RADIUS);
}

function integrate(
  body: MovementBody,
  input: MovementInput,
  world: MovementWorld,
  dt: number,
  result: MovementResult,
): void {
  const forwardX = -Math.sin(input.yaw);
  const forwardZ = -Math.cos(input.yaw);
  let moveX = forwardX * input.forward - forwardZ * input.strafe;
  let moveZ = forwardZ * input.forward + forwardX * input.strafe;
  const moveLength = Math.hypot(moveX, moveZ);
  const hasInput = moveLength > 0;
  if (hasInput) {
    moveX /= moveLength;
    moveZ /= moveLength;
  }

  const support = supportHeightAt(body.x, body.z, body.y, world.colliders);
  const grounded = body.y <= support + GROUND_EPSILON;
  const speed = input.run ? MOVE_SPEED * world.runMultiplier : MOVE_SPEED;
  const rate = (hasInput ? MOVE_ACCEL : MOVE_DECEL) * (grounded ? 1 : AIR_CONTROL) * dt;
  const dvx = moveX * speed - body.vx;
  const dvz = moveZ * speed - body.vz;
  const dvLength = Math.hypot(dvx, dvz);
  const blend = dvLength > rate ? rate / dvLength : 1;
  body.vx += dvx * blend;
  body.vz += dvz * blend;
  body.x += body.vx * dt;
  body.z += body.vz * dt;

  const horizontalSpeed = Math.hypot(body.vx, body.vz);
  if (horizontalSpeed > HEADING_MIN_SPEED) {
    const target = Math.atan2(body.vx, body.vz);
    const turn = ((target - body.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    body.heading += turn * (1 - HEADING_DAMP ** dt);
    if (grounded) {
      body.stepDistance += horizontalSpeed * dt;
      if (body.stepDistance >= STEP_DISTANCE) {
        body.stepDistance = 0;
        result.footstep = true;
      }
    }
  }

  if (input.jump && !body.jumpHeld) body.jumpBufferMs = JUMP_BUFFER_MS;
  if (body.jumpBufferMs > 0 && grounded && body.vy <= 0) {
    body.jumpBufferMs = 0;
    body.vy = JUMP_SPEED;
    result.jumped = true;
  } else {
    body.jumpBufferMs = Math.max(0, body.jumpBufferMs - dt * 1000);
  }
  body.jumpHeld = input.jump;

  let gravity = GRAVITY;
  if (body.vy > 0 && !input.jump) gravity *= JUMP_RELEASE_GRAVITY_MULT;
  else if (body.vy < 0) gravity *= FALL_GRAVITY_MULT;
  body.vy -= gravity * dt;

  const ground = supportHeightAt(body.x, body.z, body.y, world.colliders);
  const airborne = body.y > ground + GROUND_EPSILON;
  const ceiling = ceilingHeightAt(body.x, body.z, body.y, world.colliders);
  body.y += body.vy * dt;
  if (body.y + PLAYER_HEIGHT > ceiling) {
    body.y = ceiling - PLAYER_HEIGHT - GROUND_EPSILON;
    body.vy = Math.min(body.vy, 0);
  }
  if (body.vy <= 0 && body.y <= ground) {
    if (airborne) {
      const impact = Math.min(1, -body.vy / LANDING_REFERENCE_SPEED);
      result.landingImpact = Math.max(result.landingImpact, impact);
    }
    body.y = ground;
    body.vy = 0;
  }

  clampToBounds(body, world.bounds);

  result.support = ground;
  result.speed = horizontalSpeed;
}

/**
 * Advance one body over a rendered frame. Leaves the body inside the map but
 * still overlapping scenery: the caller resolves colliders once, after it has
 * applied whatever else moves the body that frame. The result carries the cues
 * the caller has to turn into sound.
 */
export function advanceMovement(
  body: MovementBody,
  input: MovementInput,
  world: MovementWorld,
  frameSeconds: number,
): MovementResult {
  const result: MovementResult = {
    footstep: false,
    jumped: false,
    landingImpact: 0,
    support: 0,
    speed: 0,
  };
  integrate(body, input, world, cappedFrameSeconds(frameSeconds), result);
  return result;
}

/**
 * Clamp a rendered frame to the span the simulation is willing to advance, so
 * every rate in a frame callback integrates over the same bounded time.
 */
export function cappedFrameSeconds(seconds: number): number {
  return Math.min(Math.max(seconds, 0), MAX_FRAME_SECONDS);
}
