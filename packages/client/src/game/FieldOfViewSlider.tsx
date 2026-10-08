import { useCallback, useEffect, useRef, useState } from "react";
import {
  FIELD_OF_VIEW_MAX,
  FIELD_OF_VIEW_MIN,
  FIELD_OF_VIEW_STEP,
  fieldOfView,
  setFieldOfView,
} from "./prefs";

/**
 * The match camera's vertical field of view as a slider with its value in
 * degrees beside it. The lobby Options slice and the in-game Match menu both
 * render it, writing the one pref the camera reads every frame, so a change
 * applies while playing. `onPreview`, when given, hears the angle while the
 * slider is being dragged and null once the drag ends, however it ends, and
 * when the slider unmounts mid-drag.
 */
export function FieldOfViewSlider({ onPreview }: { onPreview?: (fov: number | null) => void }) {
  const [value, setValue] = useState(() => fieldOfView());
  const dragging = useRef(false);
  const label = `${value}°`;

  const endPreview = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    onPreview?.(null);
  }, [onPreview]);

  useEffect(() => {
    window.addEventListener("pointerup", endPreview);
    window.addEventListener("pointercancel", endPreview);
    window.addEventListener("blur", endPreview);
    return () => {
      window.removeEventListener("pointerup", endPreview);
      window.removeEventListener("pointercancel", endPreview);
      window.removeEventListener("blur", endPreview);
      endPreview();
    };
  }, [endPreview]);

  return (
    <span className="pref-slider">
      <input
        type="range"
        className="menu-slider"
        min={FIELD_OF_VIEW_MIN}
        max={FIELD_OF_VIEW_MAX}
        step={FIELD_OF_VIEW_STEP}
        value={value}
        onPointerDown={() => {
          if (onPreview === undefined) return;
          dragging.current = true;
          onPreview(fieldOfView());
        }}
        onChange={(e) => {
          setFieldOfView(Number(e.target.value));
          const next = fieldOfView();
          setValue(next);
          if (dragging.current) onPreview?.(next);
        }}
        aria-label="Field of view"
        aria-valuetext={`${value} degrees`}
      />
      <output className="pref-slider-value" aria-hidden="true">
        {label}
      </output>
    </span>
  );
}
