import assert from "node:assert/strict";
import { test } from "node:test";
import { BotDriver } from "../packages/bot/src/driver.ts";

test("bot decision timeout releases single-flight even when policy ignores abort", async () => {
  const bot = new BotDriver({
    name: "TimeoutTest",
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
  const bot = new BotDriver({
    name: "ThrowTest",
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

const { buildMap } = await import("../packages/server/src/maps/index.ts");

function livePlayer(alive) {
  return {
    id: "self",
    name: "self",
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    aim: 0,
    role: "hunter",
    alive,
    hp: 100,
    kills: 0,
    propType: "",
    ready: true,
  };
}

test("a chat line decided before the bot died is dropped, not saved for later", async () => {
  const driver = new BotDriver({
    name: "Chatty",
    difficulty: 0.5,
    readyAtPlayers: 2,
    policy: {
      name: "chatty",
      decide: (obs) => Promise.resolve({ kind: "chat", text: "look behind you", seq: obs.seq }),
    },
    visibility: "full",
    trace: null,
  });
  driver.setMap(buildMap("station", 1));
  const world = (alive) => ({
    phase: "hunting",
    winner: "",
    self: livePlayer(alive),
    others: [],
    decoys: [],
  });

  driver.tick(world(true), Date.now());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(driver.pendingSay, "look behind you");

  driver.tick(world(false), Date.now());
  assert.equal(driver.pendingSay, null);
  assert.equal(driver.tick(world(true), Date.now()).say, null);
  await driver.stop();
});

/**
 * The room-filling bots run with `"limited"` vision (`MorphyRoom.addBot`). The
 * two modes differ in exactly one thing — whether a contact carries ground
 * truth — and that is what makes a filler bot fair to the humans it pads out.
 */
function worldWithOneContact(selfRole, contactRole, contactPropType) {
  const body = (id, role, propType) => ({
    id,
    name: id,
    x: id === "self" ? 0 : 3,
    y: 0,
    z: 0,
    rot: 0,
    aim: 0,
    role,
    alive: true,
    hp: role === "hunter" ? 100 : 0,
    kills: 0,
    propType,
    ready: true,
  });
  return {
    phase: "hunting",
    self: body("self", selfRole, ""),
    others: [body("contact", contactRole, contactPropType)],
    decoys: [],
  };
}

async function observationSeenBy(visibility) {
  const seen = [];
  const bot = new BotDriver({
    name: `Vision-${visibility}`,
    difficulty: 0.5,
    readyAtPlayers: 2,
    policy: {
      name: "capture",
      decide: (obs) => {
        seen.push(obs);
        return { kind: "patrol", seq: obs.seq };
      },
    },
    visibility,
    trace: null,
  });
  try {
    bot.launchDecide(worldWithOneContact("hunter", "prop", "crate"), Date.now());
    await new Promise((resolve) => setTimeout(resolve, 20));
    return seen[0];
  } finally {
    await bot.stop();
  }
}

test("a limited-vision bot is never told who the props are", async () => {
  const obs = await observationSeenBy("limited");
  assert.equal(obs.visibility, "limited");
  const contact = obs.entities.find((e) => e.id === "contact");
  assert.ok(contact, "a contact in the open and in line of sight is sensed");
  assert.equal(contact.role, undefined, "role is ground truth and must not leak");
  assert.equal(contact.propType, undefined, "nor the disguise it is wearing");
  assert.equal(contact.alive, undefined);
  assert.equal(typeof contact.hasLineOfSight, "boolean", "what a player can see is kept");
  assert.equal(typeof contact.distance, "number");
});

test("the full-vision anchor still reads ground truth", async () => {
  const obs = await observationSeenBy("full");
  const contact = obs.entities.find((e) => e.id === "contact");
  assert.ok(contact);
  assert.equal(contact.role, "prop");
  assert.equal(contact.propType, "crate");
  assert.equal(contact.alive, true);
});
