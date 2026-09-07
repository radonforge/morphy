import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  BOT_FILL_DELAY_MS,
  BOT_FILL_TARGET,
  LOBBY_AUTOSTART_MS,
  MSG_SHOT_FIRED,
} from "../packages/shared/src/index.ts";

const databasePath = join(tmpdir(), `morphy-room-test-${process.pid}.db`);
process.env.MORPHY_DB_PATH = databasePath;

const { MorphyRoom, PlayerState } = await import("../packages/server/src/rooms/MorphyRoom.ts");
const { buildMap } = await import("../packages/server/src/maps/index.ts");
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

function fakeClock() {
  const scheduled = [];
  const schedule = (fn, ms) => {
    const entry = { fn, ms, cleared: false };
    scheduled.push(entry);
    return {
      clear() {
        entry.cleared = true;
      },
    };
  };
  return { scheduled, setTimeout: schedule, setInterval: schedule };
}

function publicRoom() {
  const room = new MorphyRoom();
  room.clock = fakeClock();
  room.map = buildMap("station", 1);
  room.propBounds = new Map();
  room.lock = async () => {};
  return room;
}

function joinRoom(room, id) {
  room.onJoin({ sessionId: id }, { name: id });
}

function timersOf(room, ms) {
  return room.clock.scheduled.filter((entry) => entry.ms === ms && !entry.cleared);
}

function fireBotFill(room) {
  const fill = timersOf(room, BOT_FILL_DELAY_MS).at(-1);
  assert.ok(fill, "expected a pending bot-fill timer");
  fill.fn();
}

function botCount(room) {
  let bots = 0;
  room.state.players.forEach((_player, id) => {
    if (id.startsWith("bot:")) bots++;
  });
  return bots;
}

test("a public lobby arms the auto-start clock at the minimum player count", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  assert.equal(room.state.phaseEndsAt, 0);
  joinRoom(room, "b");
  assert.equal(room.state.phase, "lobby");
  assert.ok(room.state.phaseEndsAt > Date.now());
});

test("a later joiner does not push the auto-start further out", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  const armedAt = room.state.phaseEndsAt;
  joinRoom(room, "c");
  assert.equal(room.state.phaseEndsAt, armedAt);
  assert.equal(timersOf(room, LOBBY_AUTOSTART_MS).length, 1);
});

test("the auto-start clock starts the round when it expires", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  const armed = timersOf(room, LOBBY_AUTOSTART_MS).at(-1);
  assert.ok(armed);
  armed.fn();
  assert.equal(room.state.phase, "starting");
});

test("everyone ready starts the round without waiting out the clock", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  room.handleReady({ sessionId: "a" }, { ready: true });
  assert.equal(room.state.phase, "lobby");
  room.handleReady({ sessionId: "b" }, { ready: true });
  assert.equal(room.state.phase, "starting");
});

test("dropping below the minimum player count disarms the auto-start", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  const armed = timersOf(room, LOBBY_AUTOSTART_MS).at(-1);
  assert.ok(armed);
  room.onLeave({ sessionId: "b" });
  assert.equal(room.state.phaseEndsAt, 0);
  assert.equal(armed.cleared, true);
});

test("a private room waits for its host instead of auto-starting", () => {
  const room = publicRoom();
  room.state.isPrivate = true;
  joinRoom(room, "a");
  joinRoom(room, "b");
  assert.equal(room.state.phase, "lobby");
  assert.equal(room.state.phaseEndsAt, 0);
});

test("a lone player is given bots once the fill delay expires", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  assert.equal(botCount(room), 0);
  fireBotFill(room);
  assert.equal(room.state.players.size, BOT_FILL_TARGET);
  assert.equal(botCount(room), BOT_FILL_TARGET - 1);
});

test("an arriving human takes a bot's seat rather than adding to it", () => {
  const room = publicRoom();
  joinRoom(room, "first");
  fireBotFill(room);
  joinRoom(room, "second");
  assert.equal(room.state.players.size, BOT_FILL_TARGET);
  assert.equal(botCount(room), BOT_FILL_TARGET - 2);
});

test("a round in progress keeps its roster when a player leaves", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  fireBotFill(room);
  joinRoom(room, "b");
  const bots = botCount(room);
  room.state.phase = "hunting";
  room.onLeave({ sessionId: "b" });
  assert.equal(botCount(room), bots);
});

test("the last human leaving takes every bot with them", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  room.onLeave({ sessionId: "human" });
  assert.equal(botCount(room), 0);
  assert.equal(room.state.players.size, 0);
});

test("the host seat passes to a human, never to a bot", () => {
  const room = publicRoom();
  joinRoom(room, "alice");
  fireBotFill(room);
  joinRoom(room, "bob");
  assert.equal(room.state.hostId, "alice");
  room.onLeave({ sessionId: "alice" });
  assert.equal(room.state.hostId, "bob");
});

test("a private room is never filled with bots", () => {
  const room = publicRoom();
  room.state.isPrivate = true;
  joinRoom(room, "host");
  assert.equal(timersOf(room, BOT_FILL_DELAY_MS).length, 0);
  assert.equal(botCount(room), 0);
});

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

test("a round aborted for lack of players awards the survivor", () => {
  const deviceId = "abort-survivor-device";
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  const survivor = player("survivor", "hunter");
  survivor.kills = 3;
  room.state.players.set(survivor.id, survivor);
  room.state.players.set("quitter", player("quitter", "prop"));
  room.roundRoster = new Set(["survivor", "quitter"]);
  room.deviceIds.set("survivor", deviceId);
  room.onLeave({ sessionId: "quitter" });
  assert.equal(room.state.phase, "lobby");
  assert.deepEqual(playerStats.get(deviceId), { rounds: 1, wins: 1, kills: 3, survivals: 0 });
});

test("a surviving prop is credited with the survival", () => {
  const deviceId = "abort-prop-device";
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  room.state.players.set("survivor", player("survivor", "prop"));
  room.state.players.set("quitter", player("quitter", "hunter"));
  room.roundRoster = new Set(["survivor", "quitter"]);
  room.deviceIds.set("survivor", deviceId);
  room.onLeave({ sessionId: "quitter" });
  assert.deepEqual(playerStats.get(deviceId), { rounds: 1, wins: 1, kills: 0, survivals: 1 });
});

test("a round aborted during the start countdown records nothing", () => {
  const deviceId = "abort-countdown-device";
  const room = new MorphyRoom();
  room.state.phase = "starting";
  room.state.players.set("survivor", player("survivor", "hunter"));
  room.state.players.set("quitter", player("quitter", "prop"));
  room.roundRoster = new Set(["survivor", "quitter"]);
  room.deviceIds.set("survivor", deviceId);
  room.onLeave({ sessionId: "quitter" });
  assert.equal(room.state.phase, "lobby");
  assert.deepEqual(playerStats.get(deviceId), { rounds: 0, wins: 0, kills: 0, survivals: 0 });
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
