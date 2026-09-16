/**
 * Acquire pointer lock on the game canvas, tolerating a refusal.
 *
 * `requestPointerLock` returns `void` on older browsers and a promise on newer
 * ones, and the browser refuses the lock routinely — too soon after an exit, or
 * without a fresh user gesture. Unhandled, that refusal surfaces as a bare
 * `Uncaught (in promise)` that says nothing about which call failed, so every
 * caller goes through here. Swallowing it loses nothing: the player's next click
 * on the canvas locks again through this same path.
 */
export function lockPointer(canvas: HTMLCanvasElement | null): void {
  const pending: unknown = canvas?.requestPointerLock();
  if (pending instanceof Promise) pending.catch(() => undefined);
}
