import assert from "node:assert/strict";
import { test } from "node:test";

const { isRefusedReconnection } = await import("../packages/client/src/net/connection.ts");

/**
 * Colyseus reports a matchmaking rejection as an HTTP status that is itself the
 * error code, and the SDK rewraps it into a `MatchMakeError` that keeps only
 * `code`. These are the wire values the predicate has to recognise.
 */
const MATCHMAKE_INVALID_ROOM_ID = 522;
const MATCHMAKE_UNHANDLED = 523;
const MATCHMAKE_EXPIRED = 524;
const FAILED_TO_RECONNECT = 4003;
const MAY_TRY_RECONNECT = 4010;

test("a reconnection the server refused is recognised as final", () => {
  assert.equal(isRefusedReconnection({ code: MATCHMAKE_EXPIRED }), true);
  assert.equal(isRefusedReconnection({ code: MATCHMAKE_INVALID_ROOM_ID }), true);
  assert.equal(isRefusedReconnection({ code: FAILED_TO_RECONNECT }), true);
});

test("a reconnection that never reached the server stays retryable", () => {
  assert.equal(isRefusedReconnection(new Error("Failed to fetch")), false);
  assert.equal(isRefusedReconnection({ code: undefined }), false);
  assert.equal(isRefusedReconnection({ code: "ECONNREFUSED" }), false);
  assert.equal(isRefusedReconnection(undefined), false);
  assert.equal(isRefusedReconnection(null), false);
});

test("an answer that invites another try is not treated as a refusal", () => {
  assert.equal(isRefusedReconnection({ code: MAY_TRY_RECONNECT }), false);
  assert.equal(isRefusedReconnection({ code: MATCHMAKE_UNHANDLED }), false);
});
