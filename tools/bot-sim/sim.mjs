import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { MOVED_RECENTLY_MIN_DIST, MOVED_RECENTLY_MS } from "../../packages/bot/src/config.ts";
import {
  BOT_FILL_TARGET,
  INPUT_SEND_RATE_MS,
  isMapId,
  MAP_CATALOG,
  MIN_PLAYERS_TO_START,
  MOVE_SPEED,
  MSG_KILL,
  MSG_SHOT_FIRED,
  makeRng,
} from "../../packages/shared/src/index.ts";

const MS_PER_SECOND = 1_000;
const P90 = 0.9;
const PERCENT = 100;
const DEFAULT_ROUNDS = 60;
const DEFAULT_SEED = 1;
const START_EPOCH_MS = Date.UTC(2026, 0, 1);
/** A prop whose latest input carried it at least this fast is moving; slower is a crowd nudge. */
const MOVING_MIN_SPEED = MOVE_SPEED / 2;

const USAGE = `pnpm bot:sim [--rounds N] [--map urban|station] [--seed N] [--bots N]

Plays bot-only rounds in a real MorphyRoom on a virtual clock: server-filled
bots at DEFAULT_DIFFICULTY with limited vision, as a quiet public room runs them.
Prints one row per map: prop win rate, median and p90 hunt (hunt start to round
end), shots per capture, the share of captures on a prop moving when the shot
landed (its latest input carried it at half walking pace or more), the share on
one that had moved within ${MOVED_RECENTLY_MS} ms, which also counts a prop that had just
stopped, and how often a hunter ran its HP out. Needs at least
${MIN_PLAYERS_TO_START} bots, the players a round needs to start. Same seed, same rounds.`;

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: String(DEFAULT_ROUNDS) },
    map: { type: "string", multiple: true },
    seed: { type: "string", default: String(DEFAULT_SEED) },
    bots: { type: "string", default: String(BOT_FILL_TARGET) },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const rounds = Number(values.rounds);
const seed = Number(values.seed);
const botCount = Number(values.bots);
const maps = values.map ?? MAP_CATALOG.map((entry) => entry.id);
for (const [name, value] of [
  ["rounds", rounds],
  ["seed", seed],
  ["bots", botCount],
]) {
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--${name} must be a positive integer, got ${value}\n\n${USAGE}`);
    process.exit(2);
  }
}
if (botCount < MIN_PLAYERS_TO_START) {
  console.error(
    `--bots must be at least ${MIN_PLAYERS_TO_START}, the players a round needs to start, got ${botCount}\n\n${USAGE}`,
  );
  process.exit(2);
}
for (const id of maps) {
  if (!isMapId(id)) {
    console.error(`unknown map "${id}"\n\n${USAGE}`);
    process.exit(2);
  }
}

/**
 * The room's `clock`, run on virtual time: timers fire in order of due time
 * and `Date.now` reads the time of the one firing, so a three-minute round
 * takes as long as its ticks take to compute.
 */
class VirtualClock {
  now = START_EPOCH_MS;
  timers = [];
  seq = 0;

  setTimeout(fn, ms) {
    return this.add(fn, ms, null);
  }

  setInterval(fn, ms) {
    return this.add(fn, ms, ms);
  }

  add(fn, ms, every) {
    const timer = { fn, at: this.now + ms, every, seq: ++this.seq, cleared: false };
    this.timers.push(timer);
    return {
      clear() {
        timer.cleared = true;
      },
    };
  }

  /** Fire the next due timer; false once nothing is scheduled. */
  step() {
    this.timers = this.timers.filter((timer) => !timer.cleared);
    let next = null;
    for (const timer of this.timers) {
      if (!next || timer.at < next.at || (timer.at === next.at && timer.seq < next.seq)) {
        next = timer;
      }
    }
    if (!next) return false;
    this.now = next.at;
    if (next.every === null) next.cleared = true;
    else next.at += next.every;
    next.fn();
    return true;
  }
}

let clock = new VirtualClock();
Date.now = () => clock.now;

const databasePath = join(tmpdir(), `morphy-bot-sim-${process.pid}.db`);
process.env.MORPHY_DB_PATH = databasePath;
const { MorphyRoom } = await import("../../packages/server/src/rooms/MorphyRoom.ts");
const { buildMap } = await import("../../packages/server/src/maps/index.ts");
const { playerStats } = await import("../../packages/server/src/stats/repository.ts");

const flushDecisions = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A public room filled with bots only. It reports one human present, which is
 * what keeps a real room playing back-to-back rounds and what the bot fill
 * would otherwise seat bots around; the seats are taken here instead, so every
 * player in the room is a bot.
 */
function botRoom(mapId) {
  const room = new MorphyRoom();
  room.clock = clock;
  room._listing = { metadata: {} };
  room.clients = [];
  room.lock = async () => {};
  room.unlock = async () => {};
  room.humanCount = () => 1;
  room.syncBots = () => {};
  room.fillBots = () => {};
  room.applyMap(buildMap(mapId, seed));
  for (let k = 0; k < botCount; k++) room.addBot();
  return room;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * One map's rounds, on a clock and a random stream of its own, so a map plays
 * the same rounds for a seed whichever maps run before it.
 */
async function simulate(mapId) {
  clock = new VirtualClock();
  Math.random = makeRng(seed);
  const room = botRoom(mapId);
  const motion = new Map();
  const played = [];
  let current = null;
  let huntStart = 0;
  let phase = room.state.phase;

  const handleInput = room.handleInput.bind(room);
  room.handleInput = (actor, payload) => {
    const player = room.state.players.get(actor.sessionId);
    if (!player) return handleInput(actor, payload);
    const from = { x: player.x, z: player.z };
    handleInput(actor, payload);
    const step = Math.hypot(player.x - from.x, player.z - from.z);
    const last = motion.get(actor.sessionId);
    const anchor = last?.anchor ?? from;
    const drifted = Math.hypot(player.x - anchor.x, player.z - anchor.z) > MOVED_RECENTLY_MIN_DIST;
    motion.set(actor.sessionId, {
      inputAt: clock.now,
      speed: (step * MS_PER_SECOND) / (last ? clock.now - last.inputAt : INPUT_SEND_RATE_MS),
      anchor: drifted ? { x: player.x, z: player.z } : anchor,
      movedAt: drifted ? clock.now : (last?.movedAt ?? null),
    });
  };
  const movingAtCapture = (id) => {
    const last = motion.get(id);
    return (
      last !== undefined &&
      clock.now - last.inputAt <= INPUT_SEND_RATE_MS &&
      last.speed >= MOVING_MIN_SPEED
    );
  };
  const movedRecently = (id) => {
    const at = motion.get(id)?.movedAt;
    return at !== undefined && at !== null && clock.now - at <= MOVED_RECENTLY_MS;
  };
  room.broadcast = (type, payload) => {
    if (!current) return;
    if (type === MSG_SHOT_FIRED) current.shots++;
    if (type !== MSG_KILL) return;
    if (payload.reason === "converted") {
      current.captures++;
      if (movingAtCapture(payload.victimId)) current.movingCaptures++;
      if (movedRecently(payload.victimId)) current.recentlyMovedCaptures++;
    } else if (payload.reason === "self") {
      current.hunterOuts++;
    }
  };

  room.maybeStartRound();
  while (played.length < rounds) {
    if (!clock.step())
      throw new Error(`the ${mapId} room went quiet after ${played.length} rounds`);
    await flushDecisions();
    if (room.state.phase === phase) continue;
    phase = room.state.phase;
    if (phase === "hunting") {
      huntStart = clock.now;
      current = {
        shots: 0,
        captures: 0,
        movingCaptures: 0,
        recentlyMovedCaptures: 0,
        hunterOuts: 0,
      };
    } else if (phase === "round_end" && current) {
      played.push({ ...current, winner: room.state.winner, huntMs: clock.now - huntStart });
      current = null;
    } else if (phase === "lobby") {
      throw new Error(`the ${mapId} room fell back to its lobby after ${played.length} rounds`);
    }
  }
  return summarize(mapId, played);
}

function summarize(mapId, played) {
  const hunts = played.map((round) => round.huntMs / MS_PER_SECOND).sort((a, b) => a - b);
  const sum = (key) => played.reduce((total, round) => total + round[key], 0);
  const captures = sum("captures");
  return {
    map: mapId,
    rounds: played.length,
    propWinPct: (PERCENT * played.filter((r) => r.winner === "props").length) / played.length,
    medianHuntS: quantile(hunts, 0.5),
    p90HuntS: quantile(hunts, P90),
    shotsPerCapture: captures === 0 ? Number.NaN : sum("shots") / captures,
    movingCapturePct: captures === 0 ? Number.NaN : (PERCENT * sum("movingCaptures")) / captures,
    recentlyMovedCapturePct:
      captures === 0 ? Number.NaN : (PERCENT * sum("recentlyMovedCaptures")) / captures,
    capturesPerRound: captures / played.length,
    hunterOutsPerRound: sum("hunterOuts") / played.length,
  };
}

const fixed = (value, digits) => (Number.isFinite(value) ? value.toFixed(digits) : "n/a");

try {
  const rows = [];
  for (const mapId of maps) rows.push(await simulate(mapId));
  console.log(
    `${botCount} bots, ${rounds} rounds per map, seed ${seed}\n\n` +
      `| Map | Rounds | Prop wins | Median hunt | p90 hunt | Shots per capture | Captures on a prop moving at capture | Captures on a prop that moved within ${MOVED_RECENTLY_MS} ms | Captures per round | Hunter HP outs per round |\n` +
      "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const row of rows) {
    console.log(
      `| ${row.map} | ${row.rounds} | ${fixed(row.propWinPct, 0)}% | ${fixed(row.medianHuntS, 1)} s | ${fixed(row.p90HuntS, 1)} s | ${fixed(row.shotsPerCapture, 1)} | ${fixed(row.movingCapturePct, 0)}% | ${fixed(row.recentlyMovedCapturePct, 0)}% | ${fixed(row.capturesPerRound, 2)} | ${fixed(row.hunterOutsPerRound, 2)} |`,
    );
  }
} finally {
  playerStats.close();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
}
process.exit(0);
