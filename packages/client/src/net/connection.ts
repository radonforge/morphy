import { Client, type Room } from "@colyseus/sdk";
import {
  MSG_PING,
  MSG_PONG,
  normalizePartyCode,
  type PartyCreateOptions,
  type PongMessage,
  type PublicJoinOptions,
  ROOM_NAME,
  type RoomJoinOptions,
  withTimeout,
} from "@morphy/shared";

const CONNECT_TIMEOUT_MS = 8_000;

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
  registerPingEcho(room);
  return { room, sessionId: room.sessionId };
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
  registerPingEcho(room);
  return { room, sessionId: room.sessionId };
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
    registerPingEcho(room);
    return { room, sessionId: room.sessionId };
  } catch (error) {
    throw translatePartyJoinError(error);
  }
}
