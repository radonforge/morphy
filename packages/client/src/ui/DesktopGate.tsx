import { type ReactNode, useSyncExternalStore } from "react";

/**
 * Morphy needs a mouse: aiming locks the pointer, which no mobile browser
 * grants, and movement is on WASD. The gate is a capability test rather than a
 * width breakpoint — a desktop window dragged narrow is still playable, and a
 * tablet held wide is not — so it asks whether the *primary* pointing device is
 * fine. A phone, a tablet, and an iPad with a trackpad (no pointer lock in
 * iPadOS Safari) all fail it; every desktop and laptop passes.
 */
const FINE_POINTER_QUERY = "(pointer: fine)";

function subscribeToPointer(onChange: () => void): () => void {
  const query = window.matchMedia(FINE_POINTER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function hasFinePointer(): boolean {
  return window.matchMedia(FINE_POINTER_QUERY).matches;
}

function DesktopOnly() {
  return (
    <div className="lobby">
      <div className="lobby-card panel">
        <span className="eyebrow">Desktop only</span>
        <h1>Open Morphy on a PC</h1>
        <p className="desktop-only-note">
          Morphy is a mouse-and-keyboard game: you aim with the mouse and move with WASD, and
          browsers only hand a page the pointer on a desktop. Open this page on a computer to play.
        </p>
      </div>
    </div>
  );
}

/**
 * Renders the app on a machine that can play it, and a "come back on a PC"
 * notice on one that cannot. Wrapping the app rather than returning early
 * inside it keeps the hook order stable when a mouse is plugged in mid-session:
 * the app mounts fresh instead of growing hooks on a later render.
 */
export function DesktopGate({ children }: { children: ReactNode }): ReactNode {
  const finePointer = useSyncExternalStore(subscribeToPointer, hasFinePointer);
  return finePointer ? children : <DesktopOnly />;
}
