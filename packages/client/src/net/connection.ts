import { Client, type Room, ServerError } from "@colyseus/sdk";
import {
  MSG_PING,
  MSG_PONG,
  normalizePartyCode,
  type PartyCreateOptions,
  type PongMessage,
  type PublicJoinOptions,
  RECONNECT_WINDOW_MS,
  ROOM_NAME,
  type RoomJoinOptions,
  withTimeout,
} from "@morphy/shared";

const CONNECT_TIMEOUT_MS = 8_000;
const RECONNECT_TIMEOUT_MS = 5_000;
const RECONNECT_BASE_DELAY_MS = 400;
const RECONNECT_MAX_DELAY_MS = 4_000;
const RECONNECT_JITTER_RATIO = 0.3;

export interface Connection {
  room: Room;
  sessionId: string;
}

/**
 * Echo the server's latency probes for the room's whole lifetime, whichever
 * screen (menu stage or game) currently owns the connection.
 */
function registerPingEcho(room: Room): void {
  room.onMessage(MSG_PING, (message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const n = (message as Record<string, unknown>).n;
    if (typeof n !== "number" || !Number.isFinite(n)) return;
    room.send(MSG_PONG, { n } satisfies PongMessage);
  });
}

/**
 * Take ownership of a freshly obtained room, whichever call produced it: echo
 * the latency probes, and turn off the SDK's own reconnection loop. That loop
 * re-enters the *same* room object, and the full state the server replies with
 * on a successful reconnect carries no removals — anyone who left during the
 * outage would linger in the local state as a ghost. {@link reconnectToRoom}
 * builds a new room instead, whose state starts from the handshake.
 */
function adopt(room: Room): Connection {
  room.reconnection.enabled = false;
  registerPingEcho(room);
  return { room, sessionId: room.sessionId };
}

function leaveLateRoom(room: Room): void {
  void room.leave().catch((error: unknown) => {
    console.warn("[morphy] failed to leave a room resolved after connection timeout", error);
  });
}

export async function connectToRoom(
  serverUrl: string,
  options: PublicJoinOptions,
): Promise<Connection> {
  const client = new Client(serverUrl);
  const room = await withTimeout(
    client.joinOrCreate(ROOM_NAME, options),
    CONNECT_TIMEOUT_MS,
    "server connection",
    leaveLateRoom,
  );
  return adopt(room);
}

export async function createPartyRoom(
  serverUrl: string,
  options: PublicJoinOptions,
): Promise<Connection> {
  const client = new Client(serverUrl);
  const room = await withTimeout(
    client.create(ROOM_NAME, { ...options, private: true } satisfies PartyCreateOptions),
    CONNECT_TIMEOUT_MS,
    "party creation",
    leaveLateRoom,
  );
  return adopt(room);
}

/** Server matchmaker error strings for `joinById`, translated to player-facing copy. */
function translatePartyJoinError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("not found")) return new Error("Room not found — check the code");
  if (message.includes("is locked")) return new Error("That room is full");
  return error instanceof Error ? error : new Error(message);
}

export async function joinPartyRoom(
  serverUrl: string,
  code: string,
  options: RoomJoinOptions,
): Promise<Connection> {
  const client = new Client(serverUrl);
  try {
    const room = await withTimeout(
      client.joinById(normalizePartyCode(code), options),
      CONNECT_TIMEOUT_MS,
      "party join",
      leaveLateRoom,
    );
    return adopt(room);
  } catch (error) {
    throw translatePartyJoinError(error);
  }
}

function reconnectDelayMs(attempt: number): number {
  const backoff = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1));
  return backoff * (1 - RECONNECT_JITTER_RATIO * Math.random());
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", settle);
      resolve();
    };
    const timer = setTimeout(settle, ms);
    signal.addEventListener("abort", settle, { once: true });
  });
}

/**
 * Whether the server answered the reconnection request. An answer — an expired
 * token, a disposed room — is final and settles the matter; only a request that
 * never reached the server is worth repeating.
 */
function wasAnswered(error: unknown): boolean {
  return error instanceof ServerError && error.status !== undefined;
}

/**
 * Rejoin the room a dropped connection was playing in, on the same seat and
 * session id. Retries because a network blip is rarely over on the first try,
 * and stops at {@link RECONNECT_WINDOW_MS} because that is exactly how long the
 * server holds the seat: past it the token is gone and another attempt can only
 * fail. Aborting the signal gives up early — the player asked to leave.
 */
export async function reconnectToRoom(
  serverUrl: string,
  reconnectionToken: string,
  signal: AbortSignal,
): Promise<Connection> {
  const client = new Client(serverUrl);
  const deadline = Date.now() + RECONNECT_WINDOW_MS;
  let attempt = 0;
  let lastError: unknown;
  while (!signal.aborted && Date.now() < deadline) {
    if (attempt > 0) await sleep(reconnectDelayMs(attempt), signal);
    if (signal.aborted) break;
    attempt++;
    try {
      const room = await withTimeout(
        client.reconnect(reconnectionToken),
        RECONNECT_TIMEOUT_MS,
        "reconnection",
        leaveLateRoom,
      );
      return adopt(room);
    } catch (error) {
      lastError = error;
      if (wasAnswered(error)) break;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : "the connection stayed down";
  throw new Error(`Lost the match — ${reason}`);
}
