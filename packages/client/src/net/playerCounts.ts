import { isMapId, type MapId } from "@morphy/shared";
import { PLAYER_COUNTS_URL } from "./endpoints";

/**
 * Read a `GET /player-counts` body into the humans on each map. Entries for a map this client does
 * not know are skipped, so a server one map ahead still counts the rest. Throws on any other shape.
 */
export function parsePlayerCounts(body: unknown): Map<MapId, number> {
  if (!Array.isArray(body)) throw new Error("player counts response is not a list");
  const counts = new Map<MapId, number>();
  for (const entry of body) {
    const { map, players } = (entry ?? {}) as { map?: unknown; players?: unknown };
    if (typeof map !== "string" || !Number.isInteger(players) || (players as number) < 0) {
      throw new Error("player counts response malformed");
    }
    if (isMapId(map)) counts.set(map, players as number);
  }
  return counts;
}

/** Fetch the humans on each map. Throws on network error, non-2xx, abort or a malformed body. */
export async function fetchPlayerCounts(signal: AbortSignal): Promise<Map<MapId, number>> {
  const res = await fetch(PLAYER_COUNTS_URL, { signal });
  if (!res.ok) throw new Error(`player counts request failed: ${res.status}`);
  return parsePlayerCounts(await res.json());
}
