import { type CSSProperties, useEffect, useState } from "react";
import { optionsSliceGeometry } from "./optionsGeometry";
import { SettingsPanel } from "./SettingsPanel";
import { clipPath } from "./worldSlices";

interface ScreenSize {
  width: number;
  height: number;
}

function screenSize(): ScreenSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

function useScreenSize(): ScreenSize {
  const [size, setSize] = useState(screenSize);
  useEffect(() => {
    const onResize = () => setSize(screenSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/**
 * The menu's Options: a slice cut from the right of the screen along a world slice's edge, the
 * worlds left of it still live and the open one drawing behind its glass. A click on the world
 * outside it, Escape or the gear that opened it closes it; the caller returns focus to the gear.
 * Escape is left to an open dropdown first, which keeps every key to itself while it is open.
 */
export function OptionsSlice({ reduced, onClose }: { reduced: boolean; onClose: () => void }) {
  const { width, height } = useScreenSize();
  const geometry = optionsSliceGeometry(width, height);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const style = {
    clipPath: clipPath(geometry.shape.polygon),
    "--options-edge": `${geometry.edgeMid}px`,
    "--options-lean": `${geometry.leanDeg}deg`,
  } as CSSProperties;

  return (
    <>
      <button
        type="button"
        className="options-backdrop"
        aria-label="Close options"
        tabIndex={-1}
        onClick={onClose}
      />
      <section
        className={`options-slice${reduced ? " reduced" : ""}`}
        style={style}
        role="dialog"
        aria-label="Options"
      >
        <SettingsPanel context="menu" autoFocus />
      </section>
    </>
  );
}
