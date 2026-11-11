import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../packages/bot/src/cliArgs.ts";
import { isLoopbackServerUrl } from "../packages/bot/src/config.ts";

const BOT_CLI = fileURLToPath(new URL("../packages/bot/src/index.ts", import.meta.url));
const REMOTE_URL = "wss://morphy.example/colyseus";

test("loopback server URLs are recognised in every form the URL parser normalises", () => {
  for (const url of [
    "ws://127.0.0.1:2567",
    "ws://127.1.2.3:2567",
    "ws://127.1:2567",
    "ws://2130706433:2567",
    "ws://localhost:2567",
    "ws://LOCALHOST:2567",
    "ws://localhost.:2567",
    "ws://127.0.0.1.:2567",
    "ws://[::1]:2567",
    "ws://[0:0:0:0:0:0:0:1]:2567",
  ]) {
    assert.equal(isLoopbackServerUrl(url), true, url);
  }
});

test("remote and malformed server URLs are not loopback", () => {
  for (const url of [
    REMOTE_URL,
    "ws://192.168.1.42:2567",
    "ws://localhost.example:2567",
    "ws://127.0.0.1.example:2567",
    "ws://localhost@morphy.example:2567",
    "not a url",
  ]) {
    assert.equal(isLoopbackServerUrl(url), false, url);
  }
});

test("CLI bots sense what a player sees unless told otherwise", () => {
  assert.equal(parseArgs(["--url", REMOTE_URL]).visibility, "limited");
});

test("full vision is accepted against a local server", () => {
  const args = parseArgs(["--visibility", "full", "--url", "ws://127.0.0.1:2567"]);
  assert.equal(args.visibility, "full");
});

test("full vision is refused against a remote server", () => {
  assert.throws(
    () => parseArgs(["--visibility", "full", "--url", REMOTE_URL]),
    /--visibility full .* refused for wss:\/\/morphy\.example\/colyseus/,
  );
});

test("the bot CLI exits on a refused full vision before connecting", () => {
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", BOT_CLI, "--visibility", "full", "--url", REMOTE_URL],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(run.signal, null);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /refused for wss:\/\/morphy\.example\/colyseus/);
  assert.doesNotMatch(run.stdout, /spawning/);
});
