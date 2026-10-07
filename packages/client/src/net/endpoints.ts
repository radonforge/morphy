import { COLYSEUS_PROXY_PATH, PLAYER_COUNTS_PATH, STATS_PATH } from "@morphy/shared";

const configuredServerUrl = (import.meta.env?.VITE_SERVER_URL as string | undefined)?.trim();

export const SERVER_URL = configuredServerUrl || `${window.location.origin}${COLYSEUS_PROXY_PATH}`;

/** Resolve an HTTP endpoint of the game server at `path`, beside the configured Colyseus endpoint. */
export function httpUrlFor(serverUrl: string, path: string): string {
  const url = new URL(serverUrl, window.location.origin);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export const STATS_URL = httpUrlFor(SERVER_URL, STATS_PATH);
export const PLAYER_COUNTS_URL = httpUrlFor(SERVER_URL, PLAYER_COUNTS_PATH);
