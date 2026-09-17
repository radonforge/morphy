import { playUiHover } from "../game/audio";
import { STEP_BACK, STEP_FORWARD } from "./carousel";

/**
 * The controls shared by the lobby's carousels. Every step commits immediately, to
 * localStorage and, in a party, to the other members watching on their own stage, so the rail
 * carries neither a confirm nor a cancel: it only steps. Dismissing is the backdrop or Escape,
 * and the hint below says so; a Close button beside the arrows implied a decision still pending.
 */
export function CarouselRail({
  noun,
  name,
  position,
  total,
  onStep,
}: {
  noun: string;
  name: string;
  position: number;
  total: number;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="morph-rail-dock">
      <div className="morph-rail panel">
        <button
          type="button"
          className="morph-rail-arrow"
          onClick={() => onStep(STEP_BACK)}
          onPointerEnter={playUiHover}
          aria-label={`Previous ${noun}`}
        >
          ◀
        </button>
        <span className="morph-rail-id">
          <span className="morph-rail-name">{name}</span>
          <span className="morph-rail-count">
            {position} / {total}
          </span>
        </span>
        <button
          type="button"
          className="morph-rail-arrow"
          onClick={() => onStep(STEP_FORWARD)}
          onPointerEnter={playUiHover}
          aria-label={`Next ${noun}`}
        >
          ▶
        </button>
      </div>
      <p className="dismiss-hint">Click anywhere to close</p>
    </div>
  );
}
