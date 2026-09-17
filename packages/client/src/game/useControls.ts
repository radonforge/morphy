import { useEffect, useRef } from "react";

export interface MoveKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  jump: boolean;
  turnLeft: boolean;
  turnRight: boolean;
}

const KEY_MAP: Record<string, keyof MoveKeys> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  ShiftLeft: "run",
  ShiftRight: "run",
  Space: "jump",
  KeyQ: "turnLeft",
  KeyE: "turnRight",
};

const NO_KEYS: MoveKeys = {
  forward: false,
  back: false,
  left: false,
  right: false,
  run: false,
  jump: false,
  turnLeft: false,
  turnRight: false,
};

/**
 * Project the set of physically held keys onto the actions they drive.
 *
 * Several codes share an action (W and ArrowUp both move forward, either Shift
 * runs), so an action is held while *any* of its codes is. Tracking the action
 * as one boolean instead loses that: releasing W cleared `forward` while
 * ArrowUp was still down, and the player stopped with a key still pressed.
 */
export function movementFromHeld(held: ReadonlySet<string>): MoveKeys {
  const keys: MoveKeys = { ...NO_KEYS };
  for (const code of held) {
    const action = KEY_MAP[code];
    if (action) keys[action] = true;
  }
  return keys;
}

export function useControls(active: boolean) {
  const keys = useRef<MoveKeys>({ ...NO_KEYS });
  const held = useRef<Set<string>>(new Set());
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) {
      held.current.clear();
      keys.current = { ...NO_KEYS };
    }
  }, [active]);

  useEffect(() => {
    /**
     * A window that loses focus never delivers the matching keyup, so a key
     * held while switching away stays held on return and the player keeps
     * walking. Both events are listened to because neither covers the other:
     * moving to another window fires blur, minimising or switching tab fires
     * visibilitychange.
     */
    const releaseAll = () => {
      held.current.clear();
      keys.current = { ...NO_KEYS };
    };
    const apply = (event: KeyboardEvent, pressed: boolean) => {
      if (!activeRef.current || !KEY_MAP[event.code]) return;
      event.preventDefault();
      if (pressed) held.current.add(event.code);
      else held.current.delete(event.code);
      keys.current = movementFromHeld(held.current);
    };
    const onDown = (event: KeyboardEvent) => apply(event, true);
    const onUp = (event: KeyboardEvent) => apply(event, false);
    const onVisibility = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return keys;
}
