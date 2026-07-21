import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { MSG_SHOT_FIRED } from "../packages/shared/src/index.ts";

const databasePath = join(tmpdir(), `morphy-room-test-${process.pid}.db`);
process.env.MORPHY_DB_PATH = databasePath;

const { MorphyRoom, PlayerState } = await import("../packages/server/src/rooms/MorphyRoom.ts");
const { playerStats } = await import("../packages/server/src/stats/repository.ts");

after(() => {
  playerStats.close();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

function player(id, role) {
  const state = new PlayerState();
  state.id = id;
  state.name = id;
  state.role = role;
  state.alive = true;
  state.hp = role === "hunter" ? 100 : 0;
  return state;
}

test("joining an in-progress round is rejected", () => {
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  assert.throws(() => room.onJoin({ sessionId: "late" }, {}), /round already in progress/);
});

test("disconnecting the last prop immediately awards hunters", () => {
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  room.state.players.set("prop", player("prop", "prop"));
  room.state.players.set("hunter-a", player("hunter-a", "hunter"));
  room.state.players.set("hunter-b", player("hunter-b", "hunter"));
  room.endRound = function endRoundForTest() {
    this.state.phase = "round_end";
  };
  room.onLeave({ sessionId: "prop" });
  assert.equal(room.state.winner, "hunters");
  assert.equal(room.state.phase, "round_end");
});

test("shot origin is derived from the authoritative player position", () => {
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  const shooter = player("shooter", "hunter");
  shooter.x = 4;
  shooter.y = 0;
  shooter.z = 5;
  const target = player("target", "prop");
  target.x = 4;
  target.y = 0;
  target.z = 10;
  room.state.players.set(shooter.id, shooter);
  room.state.players.set(target.id, target);
  room.map = { colliders: [], propCatalog: [] };
  room.propBounds = new Map();
  room.endRound = () => {};
  let fired = null;
  room.broadcast = (type, payload) => {
    if (type === MSG_SHOT_FIRED) fired = payload;
  };
  room.handleShoot(
    { sessionId: shooter.id, send() {} },
    { origin: { x: 999, y: 999, z: 999 }, dir: { x: 0, y: 0, z: 1 } },
  );
  assert.deepEqual(fired.origin, { x: 4, y: 1.6, z: 5 });
});

test("lifetime stats accumulate round outcomes in SQLite", () => {
  const deviceId = "stats-device-test";
  assert.deepEqual(playerStats.get(deviceId), { rounds: 0, wins: 0, kills: 0, survivals: 0 });
  playerStats.recordRound(deviceId, "First name", { won: true, kills: 2, survived: true });
  const totals = playerStats.recordRound(deviceId, "Renamed", {
    won: false,
    kills: 1,
    survived: false,
  });
  assert.deepEqual(totals, { rounds: 2, wins: 1, kills: 3, survivals: 1 });
});
