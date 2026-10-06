import type { PlayerStatsPayload } from "@morphy/shared";
import { STATS_URL } from "./endpoints";

const STATS_TIMEOUT_MS = 8_000;
const DEVICE_ID_HEADER = "x-device-id";

function isStatsPayload(value: unknown): value is PlayerStatsPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.rounds === "number" &&
    typeof v.wins === "number" &&
    typeof v.kills === "number" &&
    typeof v.survivals === "number"
  );
}

/**
 * Fetch this device's lifetime stats from the game server's HTTP endpoint. The
 * device id travels in a header, never the URL. The URL is derived from the
 * configured Colyseus endpoint, so direct standalone servers work as well as
 * the same-origin Vite/nginx proxy.
 * Throws on network error, non-2xx, timeout, or a malformed body.
 */
export async function fetchStats(deviceId: string): Promise<PlayerStatsPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATS_TIMEOUT_MS);
  try {
    const res = await fetch(STATS_URL, {
      headers: { [DEVICE_ID_HEADER]: deviceId },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`stats request failed: ${res.status}`);
    const body: unknown = await res.json();
    if (!isStatsPayload(body)) throw new Error("stats response malformed");
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Erase this device's lifetime stats on the server. The device id itself is
 * kept. Throws on network error, non-2xx or timeout.
 */
export async function resetStats(deviceId: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATS_TIMEOUT_MS);
  try {
    const res = await fetch(STATS_URL, {
      method: "DELETE",
      headers: { [DEVICE_ID_HEADER]: deviceId },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`stats reset failed: ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}
