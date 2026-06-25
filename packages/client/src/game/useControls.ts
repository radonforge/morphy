import { useEffect, useRef } from "react";

export interface MoveKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  jump: boolean;
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
};

const NO_KEYS: MoveKeys = {
  forward: false,
  back: false,
  left: false,
  right: false,
  run: false,
  jump: false,
};

export function useControls(active: boolean) {
  const keys = useRef<MoveKeys>({ ...NO_KEYS });
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) {
      keys.current = { ...NO_KEYS };
    }
  }, [active]);

  useEffect(() => {
    const apply = (e: KeyboardEvent, value: boolean) => {
      if (!activeRef.current) return;
      const key = KEY_MAP[e.code];
      if (key) {
        e.preventDefault();
        keys.current[key] = value;
      }
    };
    const onDown = (e: KeyboardEvent) => apply(e, true);
    const onUp = (e: KeyboardEvent) => apply(e, false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  return keys;
}
