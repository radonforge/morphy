/**
 * A field of view the lobby stage borrows for its open world while the Options slider is being
 * dragged, so the player sees the angle they are choosing; null the rest of the time, when the
 * stage keeps its own fixed lens. The stage reads it every frame, so it is a plain module value
 * rather than React state, and the menu never has to import the lazily loaded stage to set it.
 */
let preview: number | null = null;

export function setStageLensPreview(fov: number | null): void {
  preview = fov;
}

/** The lens the open world draws with this frame: the preview while there is one, else `base`. */
export function stageLens(base: number): number {
  return preview ?? base;
}
