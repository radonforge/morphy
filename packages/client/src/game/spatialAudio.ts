/**
 * Where the local player hears from: their position, and the direction the
 * camera faces on the ground plane. Refreshed every frame by the game, read by
 * whatever plays a positional sound.
 */
export interface ListenerPose {
  x: number;
  z: number;
  forwardX: number;
  forwardZ: number;
}

export type ListenerRef = { readonly current: ListenerPose };

const MIN_BEARING = 1e-6;

/**
 * Stereo position of a sound at (x, z) for the listener: -1 hard left, 1 hard
 * right, 0 dead ahead, behind or on top of the listener. Right is the camera's
 * forward turned a quarter clockwise seen from above, the way three.js lays out
 * a camera looking down -Z with +X to its right.
 */
export function stereoPan(listener: ListenerPose, x: number, z: number): number {
  const dx = x - listener.x;
  const dz = z - listener.z;
  const distance = Math.hypot(dx, dz);
  const facing = Math.hypot(listener.forwardX, listener.forwardZ);
  if (distance < MIN_BEARING || facing < MIN_BEARING) return 0;
  const rightX = -listener.forwardZ / facing;
  const rightZ = listener.forwardX / facing;
  return Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / distance));
}

/** Linear falloff to silence at `radius`: the loudness a sound at (x, z) plays at, 0..1. */
export function falloff(listener: ListenerPose, x: number, z: number, radius: number): number {
  return Math.max(0, 1 - Math.hypot(x - listener.x, z - listener.z) / radius);
}
