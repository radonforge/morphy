import { type MapId, PLAYER_COUNTS_POLL_MS } from "@morphy/shared";
import { useEffect, useState } from "react";
import { fetchPlayerCounts } from "./playerCounts";

const PLAYER_COUNTS_TIMEOUT_MS = 5_000;
const NO_COUNTS: ReadonlyMap<MapId, number> = new Map();

function sameCounts(a: ReadonlyMap<MapId, number>, b: ReadonlyMap<MapId, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [map, players] of a) if (b.get(map) !== players) return false;
  return true;
}

/**
 * The humans on each map, polled every `PLAYER_COUNTS_POLL_MS` while the calling component is
 * mounted and the tab is visible: a hidden tab stops polling and asks again as it comes back. A
 * request that fails or outlasts `PLAYER_COUNTS_TIMEOUT_MS` empties the counts, so the menu shows
 * nothing rather than a stale or wrong number. An answer equal to the one shown keeps the same map,
 * so an idle menu does not re-render.
 */
export function usePlayerCounts(): ReadonlyMap<MapId, number> {
  const [counts, setCounts] = useState(NO_COUNTS);

  useEffect(() => {
    let controller: AbortController | undefined;
    let timeout = 0;
    let next = 0;

    const stop = () => {
      controller?.abort();
      controller = undefined;
      window.clearTimeout(timeout);
      window.clearTimeout(next);
    };

    const poll = () => {
      stop();
      const request = new AbortController();
      controller = request;
      timeout = window.setTimeout(() => request.abort(), PLAYER_COUNTS_TIMEOUT_MS);
      fetchPlayerCounts(request.signal)
        .then(
          (fresh) => {
            if (controller === request)
              setCounts((shown) => (sameCounts(shown, fresh) ? shown : fresh));
          },
          () => {
            if (controller === request) setCounts(NO_COUNTS);
          },
        )
        .finally(() => {
          if (controller !== request) return;
          window.clearTimeout(timeout);
          next = window.setTimeout(poll, PLAYER_COUNTS_POLL_MS);
        });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
      else stop();
    };

    if (document.visibilityState === "visible") poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);

  return counts;
}
