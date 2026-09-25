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
 * two modes differ in exactly one thing, whether a contact carries ground
 * truth, and that is what makes a filler bot fair to the humans it pads out.
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
  assert.equal(obs.entities.length, 1, "a contact in the open and in line of sight is sensed");
  const [contact] = obs.entities;
  assert.notEqual(contact.id, "contact", "and it is named by a handle, not its session id");
  assert.equal(contact.role, undefined, "role is ground truth and must not leak");
  assert.equal(contact.propType, undefined, "nor the disguise it is wearing");
  assert.equal(contact.alive, undefined);
  assert.equal(typeof contact.hasLineOfSight, "boolean", "what a player can see is kept");
  assert.equal(typeof contact.distance, "number");
  assert.equal(contact.disguised, true, "and so is whether it is wearing a disguise at all");
});

test("a limited-vision bot reads a hunter as undisguised, which is what a player sees", async () => {
  const seen = [];
  const bot = new BotDriver({
    name: "Shape",
    difficulty: 0.5,
    readyAtPlayers: 2,
    policy: {
      name: "capture",
      decide: (obs) => {
        seen.push(obs);
        return { kind: "patrol", seq: obs.seq };
      },
    },
    visibility: "limited",
    trace: null,
  });
  try {
    bot.launchDecide(worldWithOneContact("hunter", "hunter", ""), Date.now());
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(seen[0].entities.length, 1);
    const [contact] = seen[0].entities;
    assert.equal(contact.disguised, false);
    assert.equal(contact.role, undefined, "the shape is sensed, the role still is not");
  } finally {
    await bot.stop();
  }
});

test("the full-vision anchor still reads ground truth", async () => {
  const obs = await observationSeenBy("full");
  const contact = obs.entities.find((e) => e.id === "contact");
  assert.ok(contact);
  assert.equal(contact.role, "prop");
  assert.equal(contact.propType, "crate");
  assert.equal(contact.alive, true);
  assert.equal(contact.disguised, true);
});

/**
 * The wake-up detector used to filter on `other.role`, so a bot slept through a
 * teammate and woke the instant an enemy appeared: a reaction time no player
 * has, decided before the policy had been shown anything.
 */
test("a bot wakes its policy for any contact that comes into view, not just enemies", async () => {
  const calls = [];
  const bot = new BotDriver({
    name: "WakeTest",
    difficulty: 0.5,
    readyAtPlayers: 2,
    policy: {
      name: "counter",
      decide: (obs) => {
        calls.push(obs.seq);
        return { kind: "patrol", seq: obs.seq };
      },
    },
    visibility: "limited",
    trace: null,
  });
  const body = (id, role, x) => ({
    id,
    name: id,
    x,
    y: 0,
    z: 0,
    rot: 0,
    aim: 0,
    role,
    alive: true,
    hp: role === "hunter" ? 100 : 0,
    kills: 0,
    propType: role === "prop" ? "crate" : "",
    ready: true,
  });
  const self = body("self", "hunter", 0);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

  // An open map with no colliders: `canSee` needs a map at all (it answers
  // false without one), and no walls means line of sight is purely a matter of
  // distance, which is what this test is about.
  bot.setMap({
    id: "open",
    bounds: { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 10, z: 20 } },
    spawnPoints: { props: [{ x: 0, y: 0, z: 0 }] },
    colliders: [],
    tiles: [],
    scenery: [],
    props: [],
    propCatalog: [],
  });
  bot.syncPosition(0, 0);

  try {
    // First kick establishes the baseline: nobody in view, and the phase change
    // itself is the event that fires it.
    bot.maybeKickDecide({ phase: "hunting", self, others: [], decoys: [] }, 1_000);
    await settle();
    const baseline = calls.length;
    assert.ok(baseline > 0, "the first kick fires on the phase change");

    // 1 ms later the decide interval is nowhere near due, so anything that
    // fires now fires because a contact was noticed, and the contact is a
    // fellow hunter, which the old role filter skipped.
    bot.maybeKickDecide(
      { phase: "hunting", self, others: [body("mate", "hunter", 3)], decoys: [] },
      1_001,
    );
    await settle();
    assert.equal(calls.length, baseline + 1, "a hunter walking into view is noticed too");
  } finally {
    await bot.stop();
  }
});

test("a decided action is pressed on the next tick and only once", async () => {
  let decisions = 0;
  const driver = new BotDriver({
    name: "Presser",
    difficulty: 0.5,
    readyAtPlayers: 2,
    policy: {
      name: "press-once",
      decide: (obs) => {
        decisions++;
        return decisions === 1
          ? { kind: "idle", act: "decoy", seq: obs.seq }
          : { kind: "idle", seq: obs.seq };
      },
    },
    visibility: "limited",
    trace: null,
  });
  driver.setMap(buildMap("station", 1));
  const world = { phase: "hunting", winner: "", self: livePlayer(true), others: [], decoys: [] };

  assert.equal(driver.tick(world, Date.now()).act, null, "nothing is decided yet");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(driver.tick(world, Date.now()).act, "decoy");
  assert.equal(driver.tick(world, Date.now()).act, null, "a key press is not held down");
  await driver.stop();
});

test("a heard taunt wakes the policy", async () => {
  const calls = [];
  const bot = new BotDriver({
    name: "Ears",
    difficulty: 0.5,
    readyAtPlayers: 2,
    policy: {
      name: "counter",
      decide: (obs) => {
        calls.push(obs);
        return { kind: "patrol", seq: obs.seq };
      },
    },
    visibility: "limited",
    trace: null,
  });
  bot.setMap(buildMap("station", 1));
  const self = livePlayer(true);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
  try {
    bot.maybeKickDecide({ phase: "hunting", self, others: [], decoys: [] }, 1_000);
    await settle();
    const baseline = calls.length;
    bot.hear({ kind: "taunt", x: self.x + 3, z: self.z }, 1_001);
    bot.maybeKickDecide({ phase: "hunting", self, others: [], decoys: [] }, 1_002);
    await settle();
    assert.equal(calls.length, baseline + 1, "a honk is reacted to at once, as a player would");
    assert.equal(calls.at(-1).sounds.length, 1);
  } finally {
    await bot.stop();
  }
});

test("a bot's taunt cools down on its own HUD once pressed", async () => {
  const seen = [];
  const driver = new BotDriver({
    name: "Honker",
    difficulty: 0.5,
    readyAtPlayers: 2,
    policy: {
      name: "honk",
      decide: (obs) => {
        seen.push(obs);
        return seen.length === 1
          ? { kind: "idle", act: "taunt", seq: obs.seq }
          : { kind: "idle", seq: obs.seq };
      },
    },
    visibility: "limited",
    trace: null,
  });
  driver.setMap(buildMap("station", 1));
  const world = { phase: "hunting", winner: "", self: livePlayer(true), others: [], decoys: [] };
  const start = Date.now();
  driver.tick(world, start);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(seen[0].self.canTauntNow, true);
  assert.equal(driver.tick(world, start + 50).act, "taunt");
  driver.launchDecide(world, start + 60);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(seen.at(-1).self.canTauntNow, false);
  await driver.stop();
});
