import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { buildObstacles, buildWalls } from "../../packages/bot/src/collision.ts";
import {
  BOT_EYE_HEIGHT,
  BOT_VISION_RANGE,
  HUNTER_VIEW_HALF_ANGLE_RAD,
  MOVED_RECENTLY_MIN_DIST,
  MOVED_RECENTLY_MS,
} from "../../packages/bot/src/config.ts";
import { buildNavGrid, isBlocked, worldToCell } from "../../packages/bot/src/nav/grid.ts";
import { inscribedExtent, SightIndex, sightOf } from "../../packages/bot/src/perception.ts";
import {
  ASSET_CARDS,
  ASSET_TAGS,
  BOT_FILL_TARGET,
  computePropBounds,
  fittedExtent,
  INPUT_SEND_RATE_MS,
  isMapId,
  MAP_CATALOG,
  MIN_PLAYERS_TO_START,
  MOVE_SPEED,
  MSG_DECOY_BREAK,
  MSG_KILL,
  MSG_SHOT_FIRED,
  MSG_TAUNT,
  makeRng,
} from "../../packages/shared/src/index.ts";

const MS_PER_SECOND = 1_000;
const P90 = 0.9;
const P99 = 0.99;
const PERCENT = 100;
const MICROS_PER_MS = 1_000;
const DEFAULT_ROUNDS = 60;
const DEFAULT_SEED = 1;
const START_EPOCH_MS = Date.UTC(2026, 0, 1);
/** A prop whose latest input carried it at least this fast is moving; slower is a crowd nudge. */
const MOVING_MIN_SPEED = MOVE_SPEED / 2;
/** A prop still for this long when the hunt opens finished hiding in time. */
const SETTLED_MS = 1_000;
/** How close a placed object of the prop's own type stands to count as one it hides among. */
const SAME_TYPE_RADIUS = 3;
/** The yaw within which a disguise matches a same-type object beside it, its symmetry allowed for. */
const ALIGNED_RAD = (10 * Math.PI) / 180;
/** How long after a honk a prop must last to count as having survived it. */
const HONK_SURVIVAL_MS = 10_000;
/** The rings of open ground round a hidden prop it is judged from, and the bearings on each. */
const EXPOSURE_RADII = [4, 8, 12];
const EXPOSURE_BEARINGS = 12;
/** A hunter this close that sees a prop is on its heels: a chase starts, or goes on. */
const CHASE_RADIUS = 10;
/** A chase is over once no hunter has been on the prop's heels for this long. */
const CHASE_END_MS = 2_000;

const USAGE = `pnpm bot:sim [--rounds N] [--map urban|station] [--seed N] [--bots N]

Plays bot-only rounds in a real MorphyRoom on a virtual clock: server-filled
bots at DEFAULT_DIFFICULTY with limited vision, as a quiet public room runs them.
Prints two tables, one row per map. Balance: prop win rate, median and p90 hunt
(hunt start to round end), shots per capture, the share of captures on a prop
moving when the shot landed (its latest input carried it at half walking pace or
more), the share on one that had moved within ${MOVED_RECENTLY_MS} ms, which also counts a prop
that had just stopped, how often a hunter ran its HP out, and the wall time one
bot tick costs during the hunt (mean and p99, in microseconds). Props: the share
of props no hunter spawn sees as the hunt opens, the share of the open ground
within ${EXPOSURE_RADII.at(-1)} m that sees them then, the share still for the last
${SETTLED_MS} ms of the hide, objects of the prop's own type within ${SAME_TYPE_RADIUS} m of it then and
the share turned like one of them, the median time to a prop's first taunt of
its own, the share of honks a prop outlives by ${HONK_SURVIVAL_MS / MS_PER_SECOND} s, decoys hunters shot, and
chases (a hunter within ${CHASE_RADIUS} m seeing the prop) with the times per chase the prop
went from running to standing or back. Needs at least ${MIN_PLAYERS_TO_START} bots, the players a
round needs to start. Same seed, same rounds.`;

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

/** The yaw difference between two turns, folded by a model's symmetry: 4 means every quarter turn looks the same. */
function yawGap(a, b, symmetry) {
  const period = (2 * Math.PI) / symmetry;
  const d = (((a - b) % period) + period) % period;
  return Math.min(d, period - d);
}

/**
 * What the scorer needs of a map to judge a hiding prop from ground truth:
 * what blocks sight, the extent each shape renders at, each type's symmetry
 * and where the hunters are released from. Never handed to a bot.
 */
function mapJudge(map) {
  const extents = new Map(
    map.propCatalog.map((def) => [
      def.id,
      fittedExtent(def, ASSET_CARDS) ?? inscribedExtent(computePropBounds(def)),
    ]),
  );
  const symmetry = new Map(
    map.propCatalog.map((def) => [def.id, ASSET_TAGS[def.model ?? ""]?.symmetry ?? 1]),
  );
  const grid = buildNavGrid(map.bounds, buildWalls(map), buildObstacles(map));
  return { map, sight: new SightIndex(map), grid, extents, symmetry };
}

function bodyOf(judge, player) {
  return {
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.propRot,
    extent: judge.extents.get(player.propType),
  };
}

/** Whether any hunter spawn sees the prop, looking all round from a hunter's eye. */
function seenFromHunterSpawn(judge, player) {
  const body = bodyOf(judge, player);
  return judge.map.spawnPoints.hunters.some((spawn) =>
    sightOf(
      judge.sight,
      {
        x: spawn.x,
        y: BOT_EYE_HEIGHT,
        z: spawn.z,
        heading: 0,
        halfAngle: null,
        range: BOT_VISION_RANGE,
      },
      body,
    ),
  );
}

/**
 * The share of the open ground round a prop, on rings out to the last of
 * {@link EXPOSURE_RADII}, that sees it: how exposed the spot is to a hunter
 * walking by, wherever the hunters were released.
 */
function exposure(judge, player) {
  const body = bodyOf(judge, player);
  let views = 0;
  let seen = 0;
  for (const radius of EXPOSURE_RADII) {
    for (let k = 0; k < EXPOSURE_BEARINGS; k++) {
      const bearing = (2 * Math.PI * k) / EXPOSURE_BEARINGS;
      const x = player.x + Math.sin(bearing) * radius;
      const z = player.z + Math.cos(bearing) * radius;
      const cell = worldToCell(judge.grid, x, z);
      if (isBlocked(judge.grid, cell.i, cell.j)) continue;
      views++;
      const viewer = { x, y: BOT_EYE_HEIGHT, z, heading: 0, halfAngle: null, range: radius + 1 };
      if (sightOf(judge.sight, viewer, body)) seen++;
    }
  }
  return views === 0 ? 0 : seen / views;
}

/** Placed objects of the prop's own type within {@link SAME_TYPE_RADIUS}, and whether one is turned as it is. */
function sameTypeAround(judge, player) {
  let count = 0;
  let aligned = false;
  const symmetry = judge.symmetry.get(player.propType) ?? 1;
  for (const prop of judge.map.props) {
    if (prop.type !== player.propType) continue;
    if (Math.hypot(prop.position.x - player.x, prop.position.z - player.z) > SAME_TYPE_RADIUS) {
      continue;
    }
    count++;
    if (yawGap(prop.rotation, player.propRot, symmetry) <= ALIGNED_RAD) aligned = true;
  }
  return { count, aligned };
}

/** Whether a live hunter within {@link CHASE_RADIUS} has the prop in the cone it faces. */
function onItsHeels(judge, prop, hunters) {
  const body = bodyOf(judge, prop);
  return hunters.some(
    (hunter) =>
      Math.hypot(hunter.x - prop.x, hunter.z - prop.z) <= CHASE_RADIUS &&
      sightOf(
        judge.sight,
        {
          x: hunter.x,
          y: BOT_EYE_HEIGHT,
          z: hunter.z,
          heading: hunter.aim,
          halfAngle: HUNTER_VIEW_HALF_ANGLE_RAD,
          range: CHASE_RADIUS,
        },
        body,
      ) !== null,
  );
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
  const judge = mapJudge(room.map);
  const motion = new Map();
  const chases = new Map();
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
    if (type === MSG_DECOY_BREAK) current.decoyShots++;
    if (type === MSG_TAUNT) {
      current.honks.push({ id: payload.playerId, at: clock.now });
      if (!payload.forced && !current.firstTaunt.has(payload.playerId)) {
        current.firstTaunt.set(payload.playerId, clock.now - huntStart);
      }
    }
    if (type !== MSG_KILL) return;
    if (payload.reason === "converted") {
      current.capturedAt.set(payload.victimId, clock.now);
      endChase(payload.victimId);
      current.captures++;
      if (movingAtCapture(payload.victimId)) current.movingCaptures++;
      if (movedRecently(payload.victimId)) current.recentlyMovedCaptures++;
    } else if (payload.reason === "self") {
      current.hunterOuts++;
    }
  };

  const endChase = (id) => {
    const chase = chases.get(id);
    if (!chase) return;
    chases.delete(id);
    current.chases++;
    current.chaseSwitches += chase.switches;
  };
  const followChases = () => {
    const hunters = [];
    const props = [];
    room.state.players.forEach((player, id) => {
      if (!player.alive) return;
      if (player.role === "hunter") hunters.push(player);
      else if (player.role === "prop") props.push([id, player]);
    });
    for (const [id, prop] of props) {
      const moving = movingAtCapture(id);
      const pressed = onItsHeels(judge, prop, hunters);
      const chase = chases.get(id);
      if (!chase) {
        if (pressed) chases.set(id, { lastPressedAt: clock.now, moving, switches: 0 });
        continue;
      }
      if (pressed) chase.lastPressedAt = clock.now;
      else if (clock.now - chase.lastPressedAt > CHASE_END_MS) {
        endChase(id);
        continue;
      }
      if (moving !== chase.moving) {
        chase.switches++;
        chase.moving = moving;
      }
    }
  };
  const judgeHiding = () => {
    room.state.players.forEach((player, id) => {
      if (player.role !== "prop" || !player.alive) return;
      const around = sameTypeAround(judge, player);
      const movedAt = motion.get(id)?.movedAt;
      current.hidden.push({
        concealed: !seenFromHunterSpawn(judge, player),
        exposure: exposure(judge, player),
        settled: movedAt === undefined || movedAt === null || clock.now - movedAt >= SETTLED_MS,
        sameType: around.count,
        aligned: around.aligned,
      });
    });
  };

  const tickBots = room.tickBots.bind(room);
  room.tickBots = () => {
    if (!current) return tickBots();
    const started = performance.now();
    tickBots();
    const perBot = (performance.now() - started) / room.bots.size;
    current.tickCosts.push(perBot * MICROS_PER_MS);
    followChases();
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
        tickCosts: [],
        hidden: [],
        firstTaunt: new Map(),
        honks: [],
        capturedAt: new Map(),
        decoyShots: 0,
        chases: 0,
        chaseSwitches: 0,
      };
      judgeHiding();
    } else if (phase === "round_end" && current) {
      for (const id of [...chases.keys()]) endChase(id);
      played.push({ ...current, winner: room.state.winner, huntMs: clock.now - huntStart });
      current = null;
    } else if (phase === "lobby") {
      throw new Error(`the ${mapId} room fell back to its lobby after ${played.length} rounds`);
    }
  }
  return summarize(mapId, played);
}

/** Whether a prop that honked at `at` was still uncaptured {@link HONK_SURVIVAL_MS} later. */
function outlived(round, honk) {
  const capturedAt = round.capturedAt.get(honk.id);
  return capturedAt === undefined || capturedAt - honk.at > HONK_SURVIVAL_MS;
}

function summarize(mapId, played) {
  const hunts = played.map((round) => round.huntMs / MS_PER_SECOND).sort((a, b) => a - b);
  const sum = (key) => played.reduce((total, round) => total + round[key], 0);
  const captures = sum("captures");
  const ticks = played.flatMap((round) => round.tickCosts).sort((a, b) => a - b);
  const hidden = played.flatMap((round) => round.hidden);
  const share = (list, keep) =>
    list.length === 0 ? Number.NaN : (PERCENT * list.filter(keep).length) / list.length;
  const firstTaunts = played
    .flatMap((round) => [...round.firstTaunt.values()])
    .map((ms) => ms / MS_PER_SECOND)
    .sort((a, b) => a - b);
  const honks = played.flatMap((round) => round.honks.map((honk) => outlived(round, honk)));
  const chases = sum("chases");
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
    tickMeanUs: ticks.reduce((total, cost) => total + cost, 0) / ticks.length,
    tickP99Us: quantile(ticks, P99),
    concealedPct: share(hidden, (prop) => prop.concealed),
    settledPct: share(hidden, (prop) => prop.settled),
    exposurePct:
      hidden.length === 0
        ? Number.NaN
        : (PERCENT * hidden.reduce((total, prop) => total + prop.exposure, 0)) / hidden.length,
    sameTypeMean:
      hidden.length === 0
        ? Number.NaN
        : hidden.reduce((total, prop) => total + prop.sameType, 0) / hidden.length,
    alignedPct: share(hidden, (prop) => prop.aligned),
    firstTauntMedianS: quantile(firstTaunts, 0.5),
    honkSurvivalPct: share(honks, (survived) => survived),
    decoyShotsPerRound: sum("decoyShots") / played.length,
    chasesPerRound: chases / played.length,
    switchesPerChase: chases === 0 ? Number.NaN : sum("chaseSwitches") / chases,
  };
}

const fixed = (value, digits) => (Number.isFinite(value) ? value.toFixed(digits) : "n/a");

try {
  const rows = [];
  for (const mapId of maps) rows.push(await simulate(mapId));
  console.log(
    `${botCount} bots, ${rounds} rounds per map, seed ${seed}\n\n` +
      `| Map | Rounds | Prop wins | Median hunt | p90 hunt | Shots per capture | Captures on a prop moving at capture | Captures on a prop that moved within ${MOVED_RECENTLY_MS} ms | Captures per round | Hunter HP outs per round | Bot tick, mean / p99 |\n` +
      "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const row of rows) {
    console.log(
      `| ${row.map} | ${row.rounds} | ${fixed(row.propWinPct, 0)}% | ${fixed(row.medianHuntS, 1)} s | ${fixed(row.p90HuntS, 1)} s | ${fixed(row.shotsPerCapture, 1)} | ${fixed(row.movingCapturePct, 0)}% | ${fixed(row.recentlyMovedCapturePct, 0)}% | ${fixed(row.capturesPerRound, 2)} | ${fixed(row.hunterOutsPerRound, 2)} | ${fixed(row.tickMeanUs, 0)} / ${fixed(row.tickP99Us, 0)} µs |`,
    );
  }
  console.log(
    `\n| Map | Hidden from every hunter spawn at release | Open ground within ${EXPOSURE_RADII.at(-1)} m that sees it | Still for the last ${SETTLED_MS / MS_PER_SECOND} s of the hide | Same type within ${SAME_TYPE_RADIUS} m | Turned like one of them | First own taunt, median | Honks outlived by ${HONK_SURVIVAL_MS / MS_PER_SECOND} s | Decoys shot per round | Chases per round | Run/stand switches per chase |\n` +
      "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const row of rows) {
    console.log(
      `| ${row.map} | ${fixed(row.concealedPct, 0)}% | ${fixed(row.exposurePct, 0)}% | ${fixed(row.settledPct, 0)}% | ${fixed(row.sameTypeMean, 2)} | ${fixed(row.alignedPct, 0)}% | ${fixed(row.firstTauntMedianS, 1)} s | ${fixed(row.honkSurvivalPct, 0)}% | ${fixed(row.decoyShotsPerRound, 2)} | ${fixed(row.chasesPerRound, 2)} | ${fixed(row.switchesPerChase, 2)} |`,
    );
  }
} finally {
  playerStats.close();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
}
process.exit(0);
