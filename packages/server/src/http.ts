import {
  type MapPlayerCount,
  PLAYER_COUNTS_PATH,
  type PlayerStatsPayload,
  STATS_PATH,
} from "@morphy/shared";
import { parseDeviceId } from "./identity";
import { type PlayerStatsRepository, playerStats } from "./stats/repository";

const DEVICE_ID_HEADER = "x-device-id";
const DEVICE_ID_LOG_PREFIX = 8;

interface StatsRequest {
  header(name: string): string | undefined;
}

interface StatsResponse {
  status(code: number): StatsResponse;
  json(body: unknown): void;
  end(): void;
}

type StatsHandler = (req: StatsRequest, res: StatsResponse) => void;

interface StatsApp {
  get(path: string, handler: StatsHandler): void;
  delete(path: string, handler: StatsHandler): void;
}

/**
 * Serve a device's cumulative lifetime stats so the menu can show them without
 * joining a room. The device id travels in a header, never the URL, so it stays
 * out of access logs. Unknown devices get zeroed totals; a malformed id is a
 * client error. `DELETE` on the same path erases the device's row (204, also for
 * a device with nothing stored). Typed against the minimal Express surface used
 * here, so the server needs no `@types/express`. The repository defaults to the
 * process-wide store and is a parameter so tests can hand in a failing one.
 */
export function registerStatsRoute(
  app: StatsApp,
  repository: PlayerStatsRepository = playerStats,
): void {
  app.get(STATS_PATH, (req, res) => {
    const deviceId = parseDeviceId(req.header(DEVICE_ID_HEADER));
    if (!deviceId) {
      res.status(400).json({ error: "invalid or missing device id" });
      return;
    }
    try {
      const totals: PlayerStatsPayload = repository.get(deviceId);
      res.json(totals);
    } catch (error) {
      const safeId = deviceId.slice(0, DEVICE_ID_LOG_PREFIX);
      console.error(`[morphy] stats query failed for ${safeId}…:`, error);
      res.status(500).json({ error: "stats unavailable" });
    }
  });
  app.delete(STATS_PATH, (req, res) => {
    const deviceId = parseDeviceId(req.header(DEVICE_ID_HEADER));
    if (!deviceId) {
      res.status(400).json({ error: "invalid or missing device id" });
      return;
    }
    try {
      repository.delete(deviceId);
      res.status(204).end();
    } catch (error) {
      const safeId = deviceId.slice(0, DEVICE_ID_LOG_PREFIX);
      console.error(`[morphy] stats delete failed for ${safeId}…:`, error);
      res.status(500).json({ error: "stats unavailable" });
    }
  });
}

interface PlayerCountsApp {
  get(path: string, handler: StatsHandler): void;
}

/**
 * Serve the humans playing on each map, so the menu can show where people are before a pick. The
 * counts come from `counts`, which the caller caches (`cachedFor`) so the rooms are queried once
 * per TTL however many menus poll. A failure is logged once however many requests it answers,
 * since the cache hands every caller in its retry window the same rejection. No room ids leave the
 * server: matchmaking joins by map.
 */
export function registerPlayerCountsRoute(
  app: PlayerCountsApp,
  counts: () => Promise<MapPlayerCount[]>,
): void {
  let lastLogged: Promise<MapPlayerCount[]> | undefined;
  app.get(PLAYER_COUNTS_PATH, (_req, res) => {
    const answer = counts();
    answer.then(
      (body) => res.json(body),
      (error: unknown) => {
        if (answer !== lastLogged) console.error("[morphy] player count query failed:", error);
        lastLogged = answer;
        res.status(500).json({ error: "player counts unavailable" });
      },
    );
  });
}
