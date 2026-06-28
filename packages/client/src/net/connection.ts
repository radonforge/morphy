import { Client, type Room } from "@colyseus/sdk";
import { type AvatarId, type MapId, ROOM_NAME } from "@webhunt/shared";

const CONNECT_TIMEOUT_MS = 8_000;

export interface Connection {
  room: Room;
  sessionId: string;
}

/** Options sent with `joinOrCreate`; the contract lobby pickers extend (avatar, …). */
export interface JoinOptions {
  name: string;
  map: MapId;
  avatar: AvatarId;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout dopo ${ms}ms`)), ms);
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

export async function connectToRoom(serverUrl: string, options: JoinOptions): Promise<Connection> {
  const client = new Client(serverUrl);
  const room = await withTimeout(
    client.joinOrCreate(ROOM_NAME, options),
    CONNECT_TIMEOUT_MS,
    "connessione al server",
  );
  return { room, sessionId: room.sessionId };
}
