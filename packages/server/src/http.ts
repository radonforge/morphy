import { type PlayerStatsPayload, STATS_PATH } from "@morphy/shared";
import { parseDeviceId } from "./identity";
import { playerStats } from "./stats/repository";

const DEVICE_ID_HEADER = "x-device-id";
const DEVICE_ID_LOG_PREFIX = 8;

interface StatsRequest {
  header(name: string): string | undefined;
}

interface StatsResponse {
  status(code: number): StatsResponse;
  json(body: unknown): void;
}

interface StatsApp {
  get(path: string, handler: (req: StatsRequest, res: StatsResponse) => void): void;
}

/**
 * Serve a device's cumulative lifetime stats so the menu can show them without
 * joining a room. The device id travels in a header, never the URL, so it stays
 * out of access logs. Unknown devices get zeroed totals; a malformed id is a
 * client error. Typed against the minimal Express surface used here, so the
 * server needs no `@types/express`.
 */
export function registerStatsRoute(app: StatsApp): void {
  app.get(STATS_PATH, (req, res) => {
    const deviceId = parseDeviceId(req.header(DEVICE_ID_HEADER));
    if (!deviceId) {
      res.status(400).json({ error: "invalid or missing device id" });
      return;
    }
    try {
      const totals: PlayerStatsPayload = playerStats.get(deviceId);
      res.json(totals);
    } catch (error) {
      const safeId = deviceId.slice(0, DEVICE_ID_LOG_PREFIX);
      console.error(`[morphy] stats query failed for ${safeId}…:`, error);
      res.status(500).json({ error: "stats unavailable" });
    }
  });
}
