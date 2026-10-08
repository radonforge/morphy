import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MIN_PLAYERS_TO_START } from "../packages/shared/src/index.ts";

const SIM = fileURLToPath(new URL("../tools/bot-sim/sim.mjs", import.meta.url));
const SERVER_TSCONFIG = fileURLToPath(new URL("../packages/server/tsconfig.json", import.meta.url));
const EXIT_USAGE = 2;
/** Far longer than one round takes on the sim's virtual clock, and short enough that a sim stuck waiting for a round fails the test instead of hanging it. */
const SIM_DEADLINE_MS = 30_000;

function sim(bots) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", SIM, "--bots", String(bots), "--rounds", "1", "--map", "urban"],
    {
      encoding: "utf8",
      timeout: SIM_DEADLINE_MS,
      env: { ...process.env, TSX_TSCONFIG_PATH: SERVER_TSCONFIG },
    },
  );
}

/**
 * Too few bots for a round to start used to be accepted: the room waited for a
 * round that never came, and the sim spun on its virtual clock forever.
 */
test("the bot sim refuses fewer bots than a round needs to start", () => {
  const result = sim(MIN_PLAYERS_TO_START - 1);
  assert.equal(result.signal, null, "the sim exited on its own");
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /--bots must be at least/);
  assert.equal(result.stdout, "");
});

test("the bot sim plays a round with just enough bots to start one", () => {
  const result = sim(MIN_PLAYERS_TO_START);
  assert.equal(result.signal, null, "the sim exited on its own");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\| urban \| 1 \|/m);
});
