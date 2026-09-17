import { AVATAR_CATALOG, type AvatarId } from "@morphy/shared";
import { playUiHover } from "../game/audio";
import { AVATAR_COUNT, avatarIndex } from "./avatarCarousel";

const STEP_BACK = -1;
const STEP_FORWARD = 1;

/**
 * The avatar picker's controls. Every step commits immediately — to localStorage and, in a
 * party, to the other members watching you morph on their own stage — so the rail carries
 * neither a confirm nor a cancel: it only steps. Dismissing is the backdrop or Escape, and the
 * hint below says so; a Close button beside the arrows implied a decision still pending.
 */
export function MorphRail({
  avatar,
  onStep,
}: {
  avatar: AvatarId;
  onStep: (delta: number) => void;
}) {
  const info = AVATAR_CATALOG.find((entry) => entry.id === avatar);

  return (
    <div className="morph-rail-dock">
      <div className="morph-rail panel">
        <button
          type="button"
          className="morph-rail-arrow"
          onClick={() => onStep(STEP_BACK)}
          onPointerEnter={playUiHover}
          aria-label="Previous avatar"
        >
          ◀
        </button>
        <span className="morph-rail-id">
          <span className="morph-rail-name">{info?.name ?? avatar}</span>
          <span className="morph-rail-count">
            {avatarIndex(avatar) + 1} / {AVATAR_COUNT}
          </span>
        </span>
        <button
          type="button"
          className="morph-rail-arrow"
          onClick={() => onStep(STEP_FORWARD)}
          onPointerEnter={playUiHover}
          aria-label="Next avatar"
        >
          ▶
        </button>
      </div>
      <p className="dismiss-hint">Click anywhere to close</p>
    </div>
  );
}
