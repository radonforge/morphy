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

export function useControls() {
  const keys = useRef<MoveKeys>({ forward: false, back: false, left: false, right: false });

  useEffect(() => {
    const apply = (code: string, value: boolean) => {
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
