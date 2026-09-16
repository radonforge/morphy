import { AVATAR_CATALOG, type AvatarId, DEFAULT_AVATAR_ID } from "@morphy/shared";

/** Entries on the carousel, which is the avatar catalog in catalog order. */
export const AVATAR_COUNT: number = AVATAR_CATALOG.length;

/** Position of `avatar` in the catalog, 0-based. */
export function avatarIndex(avatar: AvatarId): number {
  return AVATAR_CATALOG.findIndex((entry) => entry.id === avatar);
}

/** Move `delta` places along the catalog, wrapping past either end. */
export function stepAvatar(avatar: AvatarId, delta: number): AvatarId {
  const from = avatarIndex(avatar);
  const to = (((from + delta) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  return AVATAR_CATALOG[to]?.id ?? DEFAULT_AVATAR_ID;
}

export interface AvatarNeighbors {
  prev: AvatarId;
  next: AvatarId;
}

/** The entries either side of `avatar`, which the stage renders as unformed matter. */
export function avatarNeighbors(avatar: AvatarId): AvatarNeighbors {
  return { prev: stepAvatar(avatar, -1), next: stepAvatar(avatar, 1) };
}
