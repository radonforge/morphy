import type { AvatarId } from "@morphy/shared";

const SQUAD_MAX = 3;

export const STAGE_MAX_ACTORS = 1 + SQUAD_MAX;

export interface StageActor {
  id: string;
  name: string;
  avatar: AvatarId;
  isHost: boolean;
}
