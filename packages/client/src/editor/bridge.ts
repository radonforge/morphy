import type { LevelDocument } from "@morphy/level";
import type { MapId, PropDefinition } from "@morphy/shared";
import {
  type BridgeError,
  LEVEL_BRIDGE_PATH,
  LEVEL_CATALOG_SEGMENT,
  LEVEL_CHANGED_EVENT,
  type LevelChangedPayload,
} from "./bridgeProtocol";

const BRIDGE_TIMEOUT_MS = 10_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS) });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = (body as Partial<BridgeError>).error ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

/** The level document of `id` as the file in the repo holds it, validated by the dev server. */
export function fetchLevel(id: MapId): Promise<LevelDocument> {
  return request(`${LEVEL_BRIDGE_PATH}/${id}`);
}

/** The prop catalog the document's objects are drawn from. */
export function fetchCatalog(id: MapId): Promise<PropDefinition[]> {
  return request(`${LEVEL_BRIDGE_PATH}/${id}/${LEVEL_CATALOG_SEGMENT}`);
}

/** Write the document into the repo; resolves to the document as the server validated it. */
export function saveLevel(doc: LevelDocument): Promise<LevelDocument> {
  return request(`${LEVEL_BRIDGE_PATH}/${doc.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
}

/** Call `listener` whenever the dev server reports a change to a document file made outside this page. */
export function onExternalLevelChange(
  listener: (payload: LevelChangedPayload) => void,
): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => {};
  const handler = (payload: LevelChangedPayload) => listener(payload);
  hot.on(LEVEL_CHANGED_EVENT, handler);
  return () => hot.off(LEVEL_CHANGED_EVENT, handler);
}

const RELOAD_DOWN_WAIT_MS = 2_500;
const RELOAD_UP_WAIT_MS = 20_000;
const RELOAD_POLL_MS = 100;
const PROBE_TIMEOUT_MS = 1_000;
const HEALTHCHECK_SEGMENT = "__healthcheck";

async function gameServerUp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait out the restart `tsx watch` does when a document file the game server
 * imports is written, so a room is not opened on the process about to exit
 * with the old map. Polls the Colyseus healthcheck: once it is seen down, waits
 * for it to answer again; if it never goes down (a server not in watch mode),
 * returns after {@link RELOAD_DOWN_WAIT_MS}. Throws when it does not come back.
 */
export async function waitForGameServerReload(serverUrl: string): Promise<void> {
  const url = `${serverUrl.replace(/^ws/, "http")}/${HEALTHCHECK_SEGMENT}`;
  const downBy = Date.now() + RELOAD_DOWN_WAIT_MS;
  let down = false;
  while (!down && Date.now() < downBy) {
    down = !(await gameServerUp(url));
    if (!down) await pause(RELOAD_POLL_MS);
  }
  if (!down) return;
  const upBy = Date.now() + RELOAD_UP_WAIT_MS;
  while (Date.now() < upBy) {
    if (await gameServerUp(url)) return;
    await pause(RELOAD_POLL_MS);
  }
  throw new Error(`the game server at ${serverUrl} did not come back after the save`);
}
