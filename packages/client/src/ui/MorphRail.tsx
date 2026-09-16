import { AVATAR_CATALOG, type AvatarId } from "@morphy/shared";
import { playUiHover } from "../game/audio";
import { AVATAR_COUNT, avatarIndex } from "./avatarCarousel";

const STEP_BACK = -1;
const STEP_FORWARD = 1;

export function MorphRail({
  avatar,
  onStep,
  onClose,
}: {
  avatar: AvatarId;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  const info = AVATAR_CATALOG.find((entry) => entry.id === avatar);

  return (
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
      <button
        type="button"
        className="morph-rail-done"
        onClick={onClose}
        onPointerEnter={playUiHover}
      >
        Done
      </button>
    </div>
  );
}
