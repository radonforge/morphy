import assert from "node:assert/strict";
import { test } from "node:test";
import { Bot } from "../packages/bot/src/bot.ts";

test("bot decision timeout releases single-flight even when policy ignores abort", async () => {
  const bot = new Bot({
    serverUrl: "ws://invalid",
    name: "TimeoutTest",
    map: "station",
    code: null,
    difficulty: 0.5,
    readyAtPlayers: 2,
    policy: { name: "never", decide: () => new Promise(() => {}) },
    visibility: "full",
    trace: null,
  });
  const world = {
    phase: "hunting",
    self: {
      id: "self",
      name: "self",
      x: 0,
      y: 0,
      z: 0,
      rot: 0,
      aim: 0,
      role: "hunter",
      alive: true,
      hp: 100,
      kills: 0,
      propType: "",
      ready: true,
    },
    others: [],
    decoys: [],
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    bot.launchDecide(world, Date.now());
    assert.equal(bot.decideInFlight, true);
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(bot.decideInFlight, false);
  } finally {
    console.error = originalError;
    await bot.stop();
  }
});

test("bot decision scheduler releases single-flight after a synchronous policy throw", async () => {
  const bot = new Bot({
    serverUrl: "ws://invalid",
    name: "ThrowTest",
    map: "station",
    code: null,
    difficulty: 0.5,
    readyAtPlayers: 2,
    policy: {
      name: "throw",
      decide() {
        throw new Error("sync failure");
      },
    },
    visibility: "full",
    trace: null,
  });
  const world = {
    phase: "hunting",
    self: {
      id: "self",
      name: "self",
      x: 0,
      y: 0,
      z: 0,
      rot: 0,
      aim: 0,
      role: "hunter",
      alive: true,
      hp: 100,
      kills: 0,
      propType: "",
      ready: true,
    },
    others: [],
    decoys: [],
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    bot.launchDecide(world, Date.now());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(bot.decideInFlight, false);
  } finally {
    console.error = originalError;
    await bot.stop();
  }
});
