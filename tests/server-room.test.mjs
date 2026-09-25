import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  BOT_FILL_DELAY_MS,
  BOT_FILL_TARGET,
  CONVERTED_HUNTER_HP,
  DECOY_BUDGET,
  DECOY_MISS_DAMAGE_FACTOR,
  HIDE_DURATION_MS,
  HUNTER_CAPTURE_HEAL,
  HUNTER_MAX_HP,
  LOBBY_AUTOSTART_MS,
  MSG_SHOT_FIRED,
  MSG_SONAR_PING,
  MSG_TAUNT,
  RECONNECT_WINDOW_MS,
  ROUND_END_MS,
  SONAR_RADIUS,
  START_COUNTDOWN_MS,
  TAUNT_CHECK_MS,
  TAUNT_DARING_POINTS,
  TAUNT_DARING_RADIUS,
  TAUNT_FORCED_STAGGER_MS,
  TAUNT_INTERVAL_MS,
  TAUNT_POINTS,
  WEAPONS,
} from "../packages/shared/src/index.ts";

const MS_PER_SECOND = 1_000;

const databasePath = join(tmpdir(), `morphy-room-test-${process.pid}.db`);
process.env.MORPHY_DB_PATH = databasePath;

const { DecoyState, MorphyRoom, PlayerState } = await import(
  "../packages/server/src/rooms/MorphyRoom.ts"
);
const { buildMap } = await import("../packages/server/src/maps/index.ts");
const { describeRoomException } = await import("../packages/server/src/rooms/roomErrors.ts");
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

/** Run the real lobby -> starting -> hiding -> hunting transitions so roles are assigned. */
function startRound(room) {
  room.startCountdown();
  room.clock.scheduled
    .filter((e) => e.ms === START_COUNTDOWN_MS)
    .at(-1)
    .fn();
  room.clock.scheduled
    .filter((e) => e.ms === HIDE_DURATION_MS)
    .at(-1)
    .fn();
  assert.equal(room.state.phase, "hunting");
}

/**
 * Pin the hunter on a bot so a departing human is always a prop. `assignRoles`
 * shuffles, so without this a test that needs the round to survive a departure
 * fails whenever the leaver happens to draw the only hunter.
 */
function pinHunterOnABot(room) {
  let hunter = null;
  room.state.players.forEach((_player, id) => {
    if (hunter === null && id.startsWith("bot:")) hunter = id;
  });
  assert.ok(hunter, "expected at least one bot to pin the hunter on");
  room.state.players.forEach((player, id) => {
    player.role = id === hunter ? "hunter" : "prop";
    player.alive = true;
    player.hp = id === hunter ? HUNTER_MAX_HP : 0;
  });
}

/**
 * Stand in for Colyseus's seat holding, which needs a real transport. The
 * returned array records every seat the room asked to hold; the promise never
 * settles, so the window stays open until a test runs `onLeave` itself, which
 * is what Colyseus does once the window lapses.
 */
function trackReconnections(room) {
  const held = [];
  room.allowReconnection = (client, seconds) => {
    held.push({ sessionId: client.sessionId, seconds });
    return new Promise(() => {});
  };
  return held;
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

test("a lone player is told when the bots are due", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  assert.equal(room.state.phaseEndsAt, 0);
  assert.ok(room.state.fillAt > Date.now());
  assert.ok(room.state.fillAt <= Date.now() + BOT_FILL_DELAY_MS);
});

test("the bot-fill deadline clears once the bots land", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  assert.equal(room.state.fillAt, 0);
});

test("a round starting cancels the bot fill it no longer needs", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  const armed = timersOf(room, BOT_FILL_DELAY_MS).at(-1);
  assert.ok(armed);
  room.handleReady({ sessionId: "a" }, { ready: true });
  room.handleReady({ sessionId: "b" }, { ready: true });
  assert.equal(room.state.phase, "starting");
  assert.equal(room.state.fillAt, 0);
  assert.equal(armed.cleared, true);
});

test("an arriving human takes a bot's seat rather than adding to it", () => {
  const room = publicRoom();
  joinRoom(room, "first");
  fireBotFill(room);
  joinRoom(room, "second");
  assert.equal(room.state.players.size, BOT_FILL_TARGET);
  assert.equal(botCount(room), BOT_FILL_TARGET - 2);
});

test("a live round keeps its roster when one of several humans leaves", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  fireBotFill(room);
  joinRoom(room, "b");
  const bots = botCount(room);
  startRound(room);
  pinHunterOnABot(room);
  const pendingFills = timersOf(room, BOT_FILL_DELAY_MS).length;
  room.onLeave({ sessionId: "b" });
  assert.equal(room.state.phase, "hunting");
  assert.equal(botCount(room), bots);
  assert.equal(timersOf(room, BOT_FILL_DELAY_MS).length, pendingFills);
});

test("a bot-filled round ends when its last human walks out", () => {
  const deviceId = "abandoned-round-device";
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  room.deviceIds.set("human", deviceId);
  startRound(room);
  room.onLeave({ sessionId: "human" });
  assert.equal(room.state.phase, "lobby");
  assert.equal(botCount(room), 0);
  assert.equal(room.state.players.size, 0);
  assert.deepEqual(playerStats.get(deviceId), { rounds: 0, wins: 0, kills: 0, survivals: 0 });
});

test("the last human leaving takes every bot with them", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  room.onLeave({ sessionId: "human" });
  assert.equal(botCount(room), 0);
  assert.equal(room.state.players.size, 0);
});

test("a bot that cannot take the map is reported as unseated, not seated", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  room.map = { ...room.map, propCatalog: null };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(room.addBot(), false);
  } finally {
    console.error = originalError;
  }
  assert.equal(botCount(room), 0);
  assert.equal(room.state.players.size, 1);
});

test("the bot fill stops at the first bot it cannot seat", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  let attempts = 0;
  room.addBot = () => {
    attempts++;
    if (attempts > BOT_FILL_TARGET) throw new Error("fillBots never stopped asking");
    return false;
  };
  assert.doesNotThrow(() => room.fillBots());
  assert.equal(attempts, 1);
});

test("a bot whose brain throws is dropped instead of taking the room with it", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  const before = botCount(room);
  assert.ok(before > 0);
  const [victim] = room.bots.keys();
  room.bots.get(victim).driver.tick = () => {
    throw new Error("simulated bot-brain failure");
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => room.tickBots());
  } finally {
    console.error = originalError;
  }
  assert.equal(botCount(room), before - 1);
  assert.equal(room.state.players.has(victim), false);
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

test("a drop mid-round holds the player's seat instead of releasing it", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  fireBotFill(room);
  joinRoom(room, "b");
  startRound(room);
  pinHunterOnABot(room);
  const held = trackReconnections(room);
  room.onDrop({ sessionId: "b" });
  const dropped = room.state.players.get("b");
  assert.equal(room.state.phase, "hunting");
  assert.ok(dropped, "the dropped player keeps its seat for the whole window");
  assert.equal(dropped.connected, false);
  assert.deepEqual(held, [{ sessionId: "b", seconds: RECONNECT_WINDOW_MS / MS_PER_SECOND }]);
});

test("a drop in the lobby gives the seat straight back", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  const held = trackReconnections(room);
  room.onDrop({ sessionId: "b" });
  assert.deepEqual(held, [], "a lobby seat is worth nothing to come back to");
  assert.equal(room.state.players.get("b").connected, true);
});

test("a reconnected player resumes the round it dropped out of", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  fireBotFill(room);
  joinRoom(room, "b");
  startRound(room);
  pinHunterOnABot(room);
  trackReconnections(room);
  const before = room.state.players.get("b");
  const role = before.role;
  const position = { x: before.x, y: before.y, z: before.z };
  room.onDrop({ sessionId: "b" });
  assert.equal(room.state.players.get("b").connected, false, "dropped, seat held");
  room.onReconnect({ sessionId: "b" });
  const after = room.state.players.get("b");
  assert.equal(after.connected, true);
  assert.equal(after.role, role);
  assert.deepEqual({ x: after.x, y: after.y, z: after.z }, position);
});

test("a reconnect window that lapses still awards the round to whoever is left", () => {
  const deviceId = "lapsed-window-device";
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  const survivor = player("survivor", "hunter");
  survivor.kills = 2;
  room.state.players.set(survivor.id, survivor);
  room.state.players.set("dropped", player("dropped", "prop"));
  room.roundRoster = new Set(["survivor", "dropped"]);
  room.deviceIds.set("survivor", deviceId);
  trackReconnections(room);

  room.onDrop({ sessionId: "dropped" });
  assert.equal(room.state.phase, "hunting", "the round runs on while the seat is held");

  room.onLeave({ sessionId: "dropped" });
  assert.equal(room.state.phase, "lobby");
  assert.deepEqual(playerStats.get(deviceId), { rounds: 1, wins: 1, kills: 2, survivals: 0 });
});

test("a held seat is not a survivor when the round is abandoned", () => {
  const deviceId = "held-seat-device";
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  const dropped = player("dropped", "prop");
  room.state.players.set(dropped.id, dropped);
  room.state.players.set("quitter", player("quitter", "hunter"));
  room.roundRoster = new Set(["dropped", "quitter"]);
  room.deviceIds.set("dropped", deviceId);
  trackReconnections(room);

  room.onDrop({ sessionId: "dropped" });
  room.onLeave({ sessionId: "quitter" });

  assert.equal(room.state.phase, "lobby");
  assert.deepEqual(
    playerStats.get(deviceId),
    { rounds: 0, wins: 0, kills: 0, survivals: 0 },
    "a player still inside their window has not outlasted the round",
  );
});

test("a round deals no role to a player inside their reconnect window", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  fireBotFill(room);
  joinRoom(room, "b");
  trackReconnections(room);
  startRound(room);
  pinHunterOnABot(room);
  room.onDrop({ sessionId: "b" });
  room.resetToLobby();
  startRound(room);

  const held = room.state.players.get("b");
  assert.equal(held.alive, false, "a held seat takes no part in the round");
  assert.equal(held.propType, "");
  assert.equal(room.roundRoster.has("b"), false, "and cannot be credited for it");
  let hunters = 0;
  room.state.players.forEach((p, id) => {
    if (p.role === "hunter" && id !== "b") hunters++;
  });
  assert.ok(hunters > 0, "the hunter slot went to someone who is present");
});

test("a lobby does not start a round on the strength of an absent player", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  assert.ok(room.state.phaseEndsAt > 0, "two present players arm the clock");
  trackReconnections(room);
  room.state.phase = "hunting";
  room.onDrop({ sessionId: "b" });
  room.state.phase = "lobby";
  room.cancelAutoStart();

  room.maybeStartRound();
  assert.equal(room.state.phaseEndsAt, 0, "one player and one held seat is not two players");
});

test("a room-filling bot is given a player's view, not ground truth", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  fireBotFill(room);
  const bot = [...room.bots.values()][0];
  assert.ok(bot, "expected a bot to have been added");
  // Reaching into the driver's options: the vision mode has no observable
  // effect until a bot ticks, and this is the decision worth pinning.
  assert.equal(bot.driver.options.visibility, "limited");
});

test("a logged room exception never carries the payload or the device id", () => {
  const error = Object.assign(new Error("boom"), {
    name: "OnMessageException",
    client: { sessionId: "abcdef123456" },
    payload: { deviceId: "device-must-not-leak", dir: { x: 0, y: 0, z: 1 } },
    type: "shoot",
  });
  const line = describeRoomException(error, "onMessage", "ROOM1");

  assert.match(line, /room=ROOM1/);
  assert.match(line, /method=onMessage/);
  assert.match(line, /msg=shoot/);
  assert.match(line, /session=abcdef…/);
  assert.match(line, /OnMessageException: boom/);
  assert.doesNotMatch(line, /device-must-not-leak/);
  assert.doesNotMatch(line, /deviceId/);
  assert.equal(line.includes("abcdef123456"), false, "full session id must be truncated");
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

/**
 * A hunter at the origin looking down +z at a prop five metres away, nothing in
 * between, and a second prop well off the line so a capture does not end the round.
 */
function lineOfFire() {
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  const shooter = player("shooter", "hunter");
  const target = player("target", "prop");
  target.z = 5;
  room.state.players.set(shooter.id, shooter);
  room.state.players.set(target.id, target);
  const bystander = player("bystander", "prop");
  bystander.x = -20;
  room.state.players.set(bystander.id, bystander);
  room.map = { colliders: [], propCatalog: [] };
  room.propBounds = new Map();
  room.broadcast = () => {};
  return { room, shooter, target };
}

const shootAhead = (room, shooter) =>
  room.handleShoot({ sessionId: shooter.id, send() {} }, { dir: { x: 0, y: 0, z: 1 } });

test("a captured prop joins the hunt below full health", () => {
  const { room, shooter, target } = lineOfFire();
  shootAhead(room, shooter);
  assert.equal(target.role, "hunter");
  assert.equal(target.hp, CONVERTED_HUNTER_HP);
});

test("a capture heals the hunter who made it", () => {
  const { room, shooter } = lineOfFire();
  shooter.hp = HUNTER_MAX_HP / 2;
  shootAhead(room, shooter);
  assert.equal(shooter.hp, HUNTER_MAX_HP / 2 + HUNTER_CAPTURE_HEAL);
});

test("a capture never heals a hunter past full health", () => {
  const { room, shooter } = lineOfFire();
  shooter.hp = HUNTER_MAX_HP - 1;
  shootAhead(room, shooter);
  assert.equal(shooter.hp, HUNTER_MAX_HP);
});

test("a shot that breaks only a decoy costs half the miss damage", () => {
  const { room, shooter, target } = lineOfFire();
  target.x = 30;
  const decoy = new DecoyState();
  decoy.id = "d0";
  decoy.z = 5;
  decoy.propType = "crate";
  decoy.owner = target.id;
  room.state.decoys.set(decoy.id, decoy);
  shootAhead(room, shooter);
  assert.equal(room.state.decoys.size, 0, "the decoy took the shot");
  const missDamage = WEAPONS[shooter.weapon].missDamage;
  assert.equal(shooter.hp, HUNTER_MAX_HP - Math.floor(missDamage * DECOY_MISS_DAMAGE_FACTOR));
});

test("a shot that hits nothing still costs the full miss damage", () => {
  const { room, shooter, target } = lineOfFire();
  target.x = 30;
  shootAhead(room, shooter);
  assert.equal(shooter.hp, HUNTER_MAX_HP - WEAPONS[shooter.weapon].missDamage);
});

/** Replace a room-filling bot's brain with one that presses a single key once. */
function pressOnce(room, sessionId, act) {
  let pressed = false;
  room.bots.get(sessionId).driver.tick = () => {
    const action = { ready: false, input: null, shoot: null, say: null, act: pressed ? null : act };
    pressed = true;
    return action;
  };
}

function botWithRole(room, role) {
  for (const id of room.bots.keys()) {
    if (room.state.players.get(id).role === role) return id;
  }
  assert.fail(`expected a bot playing ${role}`);
}

test("a room-filling prop bot drops a decoy where it stands", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  startRound(room);
  pinHunterOnABot(room);
  const prop = botWithRole(room, "prop");
  const body = room.state.players.get(prop);
  body.propType = room.map.propCatalog[0].id;
  body.decoysLeft = DECOY_BUDGET;
  pressOnce(room, prop, "decoy");
  room.tickBots();
  assert.equal(room.state.decoys.size, 1);
  const [decoy] = [...room.state.decoys.values()];
  assert.deepEqual({ x: decoy.x, z: decoy.z }, { x: body.x, z: body.z });
});

test("a hunter bot's decoy press is refused like a hunter's", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  startRound(room);
  pinHunterOnABot(room);
  pressOnce(room, botWithRole(room, "hunter"), "decoy");
  room.tickBots();
  assert.equal(room.state.decoys.size, 0);
});

/** A hunt with one prop at the origin and a hunter `hunterAt` metres down +x. */
function tauntRoom(hunterAt) {
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  const prop = player("prop", "prop");
  const hunter = player("hunter", "hunter");
  hunter.x = hunterAt;
  room.state.players.set(prop.id, prop);
  room.state.players.set(hunter.id, hunter);
  const taunts = [];
  room.broadcast = (type, payload) => {
    if (type === MSG_TAUNT) taunts.push(payload);
  };
  return { room, prop, hunter, taunts };
}

const tauntAs = (room, id) => room.handleTaunt({ sessionId: id, send() {} });

test("a taunt scores a point and is heard from where the prop stands", () => {
  const { room, prop, taunts } = tauntRoom(TAUNT_DARING_RADIUS * 3);
  tauntAs(room, prop.id);
  assert.equal(prop.score, TAUNT_POINTS);
  assert.deepEqual(taunts, [{ playerId: prop.id, x: 0, z: 0, forced: false }]);
});

test("a taunt under a hunter's nose scores the daring points", () => {
  const { room, prop } = tauntRoom(TAUNT_DARING_RADIUS - 1);
  tauntAs(room, prop.id);
  assert.equal(prop.score, TAUNT_DARING_POINTS);
});

test("a taunt still cooling down is refused", () => {
  const { room, prop, taunts } = tauntRoom(TAUNT_DARING_RADIUS * 3);
  tauntAs(room, prop.id);
  tauntAs(room, prop.id);
  assert.equal(prop.score, TAUNT_POINTS);
  assert.equal(taunts.length, 1);
});

test("only a live prop taunts, and only while the hunt is on", () => {
  const { room, prop, hunter, taunts } = tauntRoom(TAUNT_DARING_RADIUS * 3);
  tauntAs(room, hunter.id);
  room.state.phase = "hiding";
  tauntAs(room, prop.id);
  room.state.phase = "hunting";
  prop.alive = false;
  tauntAs(room, prop.id);
  assert.deepEqual(taunts, []);
  assert.equal(prop.score, 0);
});

test("a prop overdue a taunt is made to honk, for nothing", () => {
  const { room, prop, taunts } = tauntRoom(TAUNT_DARING_RADIUS * 3);
  room.tauntClockAt.set(prop.id, Date.now() - TAUNT_INTERVAL_MS);
  room.sweepForcedTaunts();
  assert.deepEqual(taunts, [{ playerId: prop.id, x: 0, z: 0, forced: true }]);
  assert.equal(prop.score, 0);
});

test("a prop that taunts on its own is never made to", () => {
  const { room, prop, taunts } = tauntRoom(TAUNT_DARING_RADIUS * 3);
  room.tauntClockAt.set(prop.id, Date.now() - TAUNT_INTERVAL_MS);
  tauntAs(room, prop.id);
  room.sweepForcedTaunts();
  assert.equal(taunts.length, 1);
  assert.equal(taunts[0].forced, false);
});

test("forced taunts are spread out instead of fired in unison", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  joinRoom(room, "second");
  startRound(room);
  const sweep = timersOf(room, TAUNT_CHECK_MS).at(-1);
  assert.ok(sweep, "the hunt sweeps for overdue props");
  const starts = [];
  room.state.players.forEach((p, id) => {
    if (p.role === "prop") starts.push(room.tauntClockAt.get(id));
  });
  assert.ok(starts.length > 1);
  assert.equal(new Set(starts).size, starts.length, "no two props share a clock");
  const now = Date.now();
  for (const at of starts) assert.ok(at >= now - 1_000 && at <= now + TAUNT_FORCED_STAGGER_MS);
});

test("a room-filling bot hears a taunt, and the taunter does not hear itself", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  startRound(room);
  pinHunterOnABot(room);
  const taunter = botWithRole(room, "prop");
  const heard = new Map();
  for (const [id, bot] of room.bots) {
    heard.set(id, []);
    bot.driver.hear = (sound) => heard.get(id).push(sound);
  }
  tauntAs(room, taunter);
  const body = room.state.players.get(taunter);
  for (const [id, sounds] of heard) {
    const expected = id === taunter ? [] : [{ kind: "taunt", x: body.x, z: body.z }];
    assert.deepEqual(sounds, expected);
  }
});

test("a round starts every prop's score from nothing", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  startRound(room);
  room.state.players.forEach((p) => {
    p.score = 7;
  });
  room.resetToLobby();
  startRound(room);
  room.state.players.forEach((p) => {
    assert.equal(p.score, 0);
  });
});

/** A hunter at the origin with one prop inside its sonar, one outside, and a decoy inside. */
function sonarRoom() {
  const room = new MorphyRoom();
  room.state.phase = "hunting";
  const hunter = player("hunter", "hunter");
  const near = player("near", "prop");
  near.x = SONAR_RADIUS - 1;
  const far = player("far", "prop");
  far.x = SONAR_RADIUS * 3;
  for (const p of [hunter, near, far]) room.state.players.set(p.id, p);
  const decoy = new DecoyState();
  decoy.id = "d0";
  decoy.z = 2;
  decoy.owner = far.id;
  room.state.decoys.set(decoy.id, decoy);
  const sent = [];
  room.broadcast = (type, payload) => sent.push({ type, payload });
  return { room, hunter, near, far, sent };
}

const sonarAs = (room, id) => room.handleSonar({ sessionId: id, send() {} });

test("a sonar makes the props within reach honk, and only them", () => {
  const { room, hunter, near, sent } = sonarRoom();
  sonarAs(room, hunter.id);
  assert.deepEqual(sent, [
    { type: MSG_SONAR_PING, payload: { playerId: hunter.id, x: 0, z: 0 } },
    { type: MSG_TAUNT, payload: { playerId: near.id, x: near.x, z: 0, forced: true } },
  ]);
});

test("a honk drawn out by a sonar scores nothing and leaves the prop's clock alone", () => {
  const { room, hunter, near } = sonarRoom();
  const clock = Date.now() - 1_000;
  room.tauntClockAt.set(near.id, clock);
  sonarAs(room, hunter.id);
  assert.equal(near.score, 0);
  assert.equal(room.tauntClockAt.get(near.id), clock);
});

test("a sonar still cooling down is refused", () => {
  const { room, hunter, sent } = sonarRoom();
  sonarAs(room, hunter.id);
  const once = sent.length;
  sonarAs(room, hunter.id);
  assert.equal(sent.length, once);
});

test("only a live hunter sounds a sonar, and only while the hunt is on", () => {
  const { room, hunter, near, sent } = sonarRoom();
  sonarAs(room, near.id);
  room.state.phase = "hiding";
  sonarAs(room, hunter.id);
  room.state.phase = "hunting";
  hunter.alive = false;
  sonarAs(room, hunter.id);
  assert.deepEqual(sent, []);
});

test("a room-filling bot hears a sonar pulse, and the hunter does not hear its own", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  startRound(room);
  pinHunterOnABot(room);
  const hunter = botWithRole(room, "hunter");
  const heard = new Map();
  for (const [id, bot] of room.bots) {
    heard.set(id, []);
    bot.driver.hear = (sound) => heard.get(id).push(sound);
  }
  sonarAs(room, hunter);
  const body = room.state.players.get(hunter);
  for (const [id, sounds] of heard) {
    const pulses = sounds.filter((sound) => sound.kind === "sonar");
    const expected = id === hunter ? [] : [{ kind: "sonar", x: body.x, z: body.z }];
    assert.deepEqual(pulses, expected);
  }
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

test("a dead player cannot switch weapon", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  room.handleSetWeapon({ sessionId: "a" }, { weapon: "rifle" });
  assert.equal(room.state.players.get("a").weapon, "rifle");

  room.state.players.get("a").alive = false;
  room.handleSetWeapon({ sessionId: "a" }, { weapon: "shotgun" });
  assert.equal(room.state.players.get("a").weapon, "rifle");
});

test("the weapon a player chose survives the round it was chosen in", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  room.handleSetWeapon({ sessionId: "a" }, { weapon: "shotgun" });
  startRound(room);
  assert.equal(room.state.players.get("a").weapon, "shotgun");

  room.resetToLobby();
  assert.equal(room.state.players.get("a").weapon, "shotgun");
});

/** Close the round the way the room does, then let its result card run out. */
function finishRound(room) {
  room.state.winner = "hunters";
  room.endRound();
  const card = timersOf(room, ROUND_END_MS).at(-1);
  assert.ok(card, "expected the result card's timer");
  card.fn();
}

test("a public round goes straight from its result card to the next countdown", () => {
  const room = publicRoom();
  joinRoom(room, "human");
  fireBotFill(room);
  startRound(room);
  finishRound(room);
  assert.equal(room.state.phase, "starting");
  room.state.players.forEach((player) => {
    assert.equal(player.role, "prop", "every role is taken back before the next deal");
    assert.equal(player.propType, "");
  });
});

test("a private round returns to its lobby, where the host starts the next", () => {
  const room = publicRoom();
  room.state.isPrivate = true;
  joinRoom(room, "a");
  joinRoom(room, "b");
  startRound(room);
  finishRound(room);
  assert.equal(room.state.phase, "lobby");
});

test("a public room left too thin to play on returns to its lobby", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  startRound(room);
  room.state.players.get("b").connected = false;
  finishRound(room);
  assert.equal(room.state.phase, "lobby");
});

test("a player arriving at the result card is dealt into the next round", () => {
  const room = publicRoom();
  joinRoom(room, "a");
  joinRoom(room, "b");
  startRound(room);
  room.state.winner = "hunters";
  room.endRound();
  joinRoom(room, "late");
  timersOf(room, ROUND_END_MS).at(-1).fn();
  startRound(room);
  assert.ok(room.roundRoster.has("late"));
});

test("a human arriving between rounds takes a bot's seat", () => {
  const room = publicRoom();
  joinRoom(room, "first");
  fireBotFill(room);
  startRound(room);
  room.state.winner = "hunters";
  room.endRound();
  joinRoom(room, "second");
  assert.equal(room.state.players.size, BOT_FILL_TARGET);
  assert.equal(botCount(room), BOT_FILL_TARGET - 2);
});

test("a round locks the room as roles are dealt, not as the countdown starts", () => {
  const room = publicRoom();
  let locks = 0;
  room.lock = async () => {
    locks++;
  };
  joinRoom(room, "a");
  joinRoom(room, "b");
  room.startCountdown();
  assert.equal(locks, 0, "the countdown is still a window to join in");
  timersOf(room, START_COUNTDOWN_MS).at(-1).fn();
  assert.equal(locks, 1);
});
