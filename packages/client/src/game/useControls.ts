import { useEffect, useRef } from "react";

export interface MoveKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
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
};

const NO_KEYS: MoveKeys = { forward: false, back: false, left: false, right: false };

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
    const apply = (code: string, value: boolean) => {
      if (!activeRef.current) return;
      const key = KEY_MAP[code];
      if (key) {
        keys.current[key] = value;
      }
    };
    const onDown = (e: KeyboardEvent) => apply(e.code, true);
    const onUp = (e: KeyboardEvent) => apply(e.code, false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  return keys;
}
