import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isLoopbackServerUrl } from "../packages/bot/src/config.ts";

const BOT_CLI = fileURLToPath(new URL("../packages/bot/src/index.ts", import.meta.url));

function runBotCli(args) {
  return spawnSync(process.execPath, ["--import", "tsx", BOT_CLI, ...args], {
    encoding: "utf8",
    timeout: 20_000,
  });
}

test("loopback server URLs are recognised and remote ones are not", () => {
  for (const url of [
    "ws://127.0.0.1:2567",
    "ws://localhost:2567",
    "ws://127.1.2.3:2567",
    "ws://[::1]:2567",
  ]) {
    assert.equal(isLoopbackServerUrl(url), true, url);
  }
  for (const url of [
    "wss://morphy.example/colyseus",
    "ws://192.168.1.42:2567",
    "ws://localhost.example:2567",
    "ws://127.0.0.1.example:2567",
    "not a url",
  ]) {
    assert.equal(isLoopbackServerUrl(url), false, url);
  }
});

test("the bot CLI refuses full vision against a remote server before connecting", () => {
  const run = runBotCli(["--visibility", "full", "--url", "wss://morphy.example/colyseus"]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--visibility full .* refused for wss:\/\/morphy\.example\/colyseus/);
  assert.doesNotMatch(run.stdout, /spawning/);
});
