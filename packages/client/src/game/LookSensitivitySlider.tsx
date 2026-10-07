import { useState } from "react";
import {
  LOOK_SENSITIVITY_MAX,
  LOOK_SENSITIVITY_MIN,
  LOOK_SENSITIVITY_STEP,
  lookSensitivity,
  setLookSensitivity,
} from "./prefs";

const VALUE_DECIMALS = 2;

/**
 * The look sensitivity multiplier as a slider with its value beside it. The
 * lobby Options pane and the in-game Match menu both render it, writing the one
 * pref mouse look reads on every move, so a change applies without a reload.
 */
export function LookSensitivitySlider() {
  const [value, setValue] = useState(() => lookSensitivity());
  const label = `${value.toFixed(VALUE_DECIMALS)}x`;

  return (
    <span className="pref-slider">
      <input
        type="range"
        className="menu-slider"
        min={LOOK_SENSITIVITY_MIN}
        max={LOOK_SENSITIVITY_MAX}
        step={LOOK_SENSITIVITY_STEP}
        value={value}
        onChange={(e) => {
          setLookSensitivity(Number(e.target.value));
          setValue(lookSensitivity());
        }}
        aria-label="Look sensitivity"
        aria-valuetext={label}
      />
      <output className="pref-slider-value" aria-hidden="true">
        {label}
      </output>
    </span>
  );
}
