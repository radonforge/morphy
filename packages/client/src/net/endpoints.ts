import { COLYSEUS_PROXY_PATH, STATS_PATH } from "@morphy/shared";

const configuredServerUrl = (import.meta.env?.VITE_SERVER_URL as string | undefined)?.trim();

export const SERVER_URL = configuredServerUrl || `${window.location.origin}${COLYSEUS_PROXY_PATH}`;

/** Resolve the HTTP stats endpoint beside the configured Colyseus endpoint. */
export function statsUrlFor(serverUrl: string): string {
  const url = new URL(serverUrl, window.location.origin);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  url.pathname = STATS_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export const STATS_URL = statsUrlFor(SERVER_URL);
