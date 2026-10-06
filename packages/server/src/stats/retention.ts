import type { PlayerStatsRepository } from "./repository";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a device's stats outlive its last round: the twelve months the privacy notice promises. */
export const STATS_RETENTION_MS = 365 * DAY_MS;

/** How often the server sweeps for devices past `STATS_RETENTION_MS`. */
export const STATS_PURGE_INTERVAL_MS = DAY_MS;

/** Erase the stats of every device whose last round is older than the retention window. */
export function purgeInactiveStats(repository: PlayerStatsRepository, nowMs: number): number {
  return repository.deleteInactiveBefore(nowMs - STATS_RETENTION_MS);
}

/**
 * Purge once at startup and then every `STATS_PURGE_INTERVAL_MS`, returning a function that stops
 * the timer. A failed sweep is logged and retried on the next tick rather than taking the process
 * down, since every room shares it; the timer is unref'd so it never keeps the process alive.
 */
export function scheduleStatsPurge(
  repository: PlayerStatsRepository,
  now: () => number = Date.now,
): () => void {
  const sweep = (): void => {
    try {
      const erased = purgeInactiveStats(repository, now());
      if (erased > 0) console.log(`[morphy] erased stats of ${erased} inactive devices`);
    } catch (error) {
      console.error("[morphy] stats retention sweep failed, retrying next interval:", error);
    }
  };
  sweep();
  const timer = setInterval(sweep, STATS_PURGE_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
