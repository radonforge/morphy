import { isMapId, MAP_CATALOG, type MapId, type MapPlayerCount } from "@morphy/shared";

/** The fields of a matchmaker room listing that the player count reads. */
export interface CountedRoom {
  clients: number;
  private?: boolean;
  metadata?: { map?: unknown };
}

/**
 * The humans on each map, one entry per catalog map in catalog order, zero included. Only public
 * rooms count: a party code is its room id, so a private room never shows up here. A locked room
 * counts too, since a room is locked for the whole of a round and an unlocked-only count would
 * report a fraction of the people playing. `clients` is the matchmaker's count of connections,
 * which a server-filled bot never has.
 */
export function countPlayersByMap(rooms: readonly CountedRoom[]): MapPlayerCount[] {
  const counts = new Map<MapId, number>(MAP_CATALOG.map((info) => [info.id, 0]));
  for (const room of rooms) {
    if (room.private) continue;
    const map = room.metadata?.map;
    if (!isMapId(map)) continue;
    counts.set(map, (counts.get(map) ?? 0) + room.clients);
  }
  return [...counts].map(([map, players]) => ({ map, players }));
}

/**
 * Wrap `load` so it runs at most once per window however many callers ask: while a load is in
 * flight every call shares it, a success is kept for `ttlMs` and a failure for `retryMs`, both
 * from when it settled. Keeping the failure bounds how often a broken source is asked again, and
 * every caller in its window sees the same rejection.
 */
export function cachedFor<T>(
  load: () => Promise<T>,
  ttlMs: number,
  retryMs: number,
  now: () => number = Date.now,
): () => Promise<T> {
  let cached: { value: Promise<T>; until: number } | undefined;
  return () => {
    if (cached && now() < cached.until) return cached.value;
    const entry = { value: load(), until: Number.POSITIVE_INFINITY };
    cached = entry;
    entry.value.then(
      () => {
        entry.until = now() + ttlMs;
      },
      () => {
        entry.until = now() + retryMs;
      },
    );
    return entry.value;
  };
}
