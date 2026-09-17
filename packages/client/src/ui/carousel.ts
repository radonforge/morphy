import {
  AVATAR_CATALOG,
  type AvatarId,
  DEFAULT_AVATAR_ID,
  DEFAULT_MAP_ID,
  MAP_CATALOG,
  type MapId,
} from "@morphy/shared";

export const STEP_BACK = -1;
export const STEP_FORWARD = 1;

export interface Neighbors<T> {
  prev: T;
  next: T;
}

/** Position of `current` in `ids`, 0-based, or -1 when it is not in the catalog. */
export function catalogIndex<T extends string>(ids: readonly T[], current: T): number {
  return ids.indexOf(current);
}

/**
 * Move `delta` places along `ids`, wrapping past either end. An id absent from the catalog
 * steps from `fallback`'s position, so a stale stored preference rejoins the carousel on the
 * first press instead of pinning it.
 */
export function catalogStep<T extends string>(
  ids: readonly T[],
  current: T,
  delta: number,
  fallback: T,
): T {
  const from = ids.indexOf(current);
  const origin = from === -1 ? ids.indexOf(fallback) : from;
  const count = ids.length;
  const to = (((origin + delta) % count) + count) % count;
  return ids[to] ?? fallback;
}

/** The entries either side of `current`, which the stage renders as unformed matter. */
export function catalogNeighbors<T extends string>(
  ids: readonly T[],
  current: T,
  fallback: T,
): Neighbors<T> {
  return {
    prev: catalogStep(ids, current, STEP_BACK, fallback),
    next: catalogStep(ids, current, STEP_FORWARD, fallback),
  };
}

export const AVATAR_IDS: readonly AvatarId[] = AVATAR_CATALOG.map((entry) => entry.id);

/** Entries on the avatar carousel, which is the avatar catalog in catalog order. */
export const AVATAR_COUNT: number = AVATAR_IDS.length;

export function avatarIndex(avatar: AvatarId): number {
  return catalogIndex(AVATAR_IDS, avatar);
}

export function stepAvatar(avatar: AvatarId, delta: number): AvatarId {
  return catalogStep(AVATAR_IDS, avatar, delta, DEFAULT_AVATAR_ID);
}

export function avatarNeighbors(avatar: AvatarId): Neighbors<AvatarId> {
  return catalogNeighbors(AVATAR_IDS, avatar, DEFAULT_AVATAR_ID);
}

export const MAP_IDS: readonly MapId[] = MAP_CATALOG.map((entry) => entry.id);

/** Entries on the world carousel, which is the map catalog in catalog order. */
export const MAP_COUNT: number = MAP_IDS.length;

export function mapIndex(map: MapId): number {
  return catalogIndex(MAP_IDS, map);
}

export function stepMap(map: MapId, delta: number): MapId {
  return catalogStep(MAP_IDS, map, delta, DEFAULT_MAP_ID);
}

export function mapNeighbors(map: MapId): Neighbors<MapId> {
  return catalogNeighbors(MAP_IDS, map, DEFAULT_MAP_ID);
}
