import type { AvatarId } from "@morphy/shared";

const SQUAD_MAX = 3;

export const STAGE_MAX_ACTORS = 1 + SQUAD_MAX;

export interface StageActor {
  id: string;
  name: string;
  avatar: AvatarId;
  isHost: boolean;
}

/**
 * The two carousels that take over the stage. Both fade the menu chrome out, move the camera and
 * step their catalog off the same gestures; they differ only in what the stage shows and what a
 * step commits to. Shared with the stage, which frames each one differently.
 */
export type PickerId = "avatar" | "world";
