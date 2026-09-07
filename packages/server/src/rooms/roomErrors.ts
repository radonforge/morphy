import type { RoomException, RoomMethodName } from "@colyseus/core";

const SESSION_ID_LOG_PREFIX = 6;

/**
 * A one-line, safe description of a room exception.
 *
 * Colyseus hangs the triggering input off these errors — `OnMessageException`
 * carries the raw client payload, `OnJoinException` the join options (which
 * include the device id lifetime stats are keyed on) — so logging the exception
 * object itself would put untrusted payloads and a player identity into the
 * log. This reports what failed, where, and a truncated session id, never the
 * input. The message type is a protocol constant and safe to name.
 */
export function describeRoomException(
  error: RoomException,
  methodName: RoomMethodName,
  roomId: string,
): string {
  const parts = [`room=${roomId}`, `method=${methodName}`];
  if ("type" in error && typeof error.type === "string") parts.push(`msg=${error.type}`);
  if ("client" in error && error.client !== undefined) {
    parts.push(`session=${error.client.sessionId.slice(0, SESSION_ID_LOG_PREFIX)}…`);
  }
  parts.push(`${error.name}: ${error.message}`);
  return parts.join(" ");
}
