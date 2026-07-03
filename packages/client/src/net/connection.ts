import { Client, type Room } from "@colyseus/sdk";
import {
  normalizePartyCode,
  type PartyCreateOptions,
  type PublicJoinOptions,
  ROOM_NAME,
  type RoomJoinOptions,
} from "@webhunt/shared";

const CONNECT_TIMEOUT_MS = 8_000;

export interface Connection {
  room: Room;
  sessionId: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
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
  );
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
  );
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
    );
    return { room, sessionId: room.sessionId };
  } catch (error) {
    throw translatePartyJoinError(error);
  }
}
