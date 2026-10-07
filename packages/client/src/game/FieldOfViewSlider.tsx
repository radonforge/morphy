import { useState } from "react";
import {
  FIELD_OF_VIEW_MAX,
  FIELD_OF_VIEW_MIN,
  FIELD_OF_VIEW_STEP,
  fieldOfView,
  setFieldOfView,
} from "./prefs";

/**
 * The match camera's vertical field of view as a slider with its value in
 * degrees beside it. The lobby Options pane and the in-game Match menu both
 * render it, writing the one pref the camera reads every frame, so a change
 * applies while playing.
 */
export function FieldOfViewSlider() {
  const [value, setValue] = useState(() => fieldOfView());
  const label = `${value}°`;

  return (
    <span className="pref-slider">
      <input
        type="range"
        className="menu-slider"
        min={FIELD_OF_VIEW_MIN}
        max={FIELD_OF_VIEW_MAX}
        step={FIELD_OF_VIEW_STEP}
        value={value}
        onChange={(e) => {
          setFieldOfView(Number(e.target.value));
          setValue(fieldOfView());
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
