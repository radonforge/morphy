import assert from "node:assert/strict";
import { test } from "node:test";
import {
  huntGoesOn,
  KILL_CAM_COPY,
  KILL_CAM_SKIP_CODE,
  killCamViewLine,
} from "../packages/client/src/game/caught.ts";
import {
  appearanceOf,
  beginSample,
  createEyeOut,
  createKillCamLog,
  createPoseOut,
  createPoseRing,
  decoyStandsAt,
  freezeKillCam,
  hunterEyeAt,
  KILL_CAM_AIM_LEAD_MS,
  KILL_CAM_MAX_GAP_MS,
  KILL_CAM_SAMPLE_MS,
  KILL_CAM_SLOWMO_MS,
  KILL_CAM_SLOWMO_RATE,
  KILL_CAM_TAIL_MS,
  logDecoyAdded,
  logDecoyRemoved,
  logShot,
  pushPose,
  replayDurationMs,
  replayReachedShot,
  sampleDue,
  samplePose,
  shotLook,
  sourceTimeAt,
} from "../packages/client/src/game/killCam.ts";
import { KILL_CAM_WINDOW_MS } from "../packages/shared/src/constants.ts";

const EYE = 1.6;
const NOW = 100_000;

function record(log, t, poses) {
  beginSample(log.ring, t);
  for (const p of poses) {
    pushPose(
      log.ring,
      p.id,
      p.hunter ?? false,
      p.propType ?? "",
      p.x ?? 0,
      p.y ?? 0,
      p.z ?? 0,
      p.rot ?? 0,
      p.aim ?? 0,
      p.propRot ?? 0,
    );
  }
}

function huntLog({ until = NOW, hunterX = (t) => (t - (NOW - KILL_CAM_WINDOW_MS)) / 1000 } = {}) {
  const log = createKillCamLog();
  for (let t = NOW - KILL_CAM_WINDOW_MS - 1000; t <= until; t += KILL_CAM_SAMPLE_MS) {
    record(log, t, [
      { id: "h", hunter: true, x: hunterX(t), z: 0, aim: Math.PI / 2 },
      { id: "me", propType: "crate", x: 5, z: 0, propRot: 0.3 },
    ]);
  }
  return log;
}

function shotAt(at, shooterId = "h") {
  return {
    at,
    shooterId,
    weapon: "pistol",
    origin: { x: 2, y: EYE, z: 0 },
    ends: [{ x: 5, y: 0.6, z: 0 }],
  };
}

const CAPTURE = { now: NOW, hunterId: "h", victimId: "me", weapon: "pistol" };

test("the ring overwrites its oldest sample once full and never grows", () => {
  const ring = createPoseRing(3, 2);
  for (let i = 0; i < 5; i++) {
    beginSample(ring, i * 100);
    pushPose(ring, "a", false, "", i, 0, 0, 0, 0, 0);
  }
  assert.equal(ring.size, 3);
  assert.equal(ring.times.length, 3);
  assert.deepEqual(
    [...ring.times].sort((a, b) => a - b),
    [200, 300, 400],
  );
});

test("a sample holds at most perFrame players", () => {
  const ring = createPoseRing(2, 2);
  beginSample(ring, 0);
  for (const id of ["a", "b", "c"]) pushPose(ring, id, false, "", 0, 0, 0, 0, 0, 0);
  assert.equal(ring.counts[ring.current], 2);
});

test("a sample is due first, then once per sample interval", () => {
  const ring = createPoseRing(4, 1);
  assert.equal(sampleDue(ring, 0), true);
  beginSample(ring, 0);
  assert.equal(sampleDue(ring, KILL_CAM_SAMPLE_MS - 1), false);
  assert.equal(sampleDue(ring, KILL_CAM_SAMPLE_MS), true);
});

test("freezing keeps only the window before the capture", () => {
  const replay = freezeKillCam(huntLog({ until: NOW + 500 }), CAPTURE);
  assert.ok(replay);
  assert.equal(replay.start, NOW - KILL_CAM_WINDOW_MS);
  assert.equal(replay.end, NOW);
  for (const track of replay.tracks) {
    assert.ok(track.times.every((t) => t <= NOW && t >= replay.start - KILL_CAM_MAX_GAP_MS));
  }
});

test("there is no replay when the hunter was never recorded", () => {
  const log = createKillCamLog();
  record(log, NOW - 10, [{ id: "me", propType: "crate" }]);
  assert.equal(freezeKillCam(log, CAPTURE), null);
});

test("a hunter seen only lately starts the replay where it was first seen", () => {
  const log = createKillCamLog();
  for (let t = NOW - 600; t <= NOW; t += KILL_CAM_SAMPLE_MS) {
    record(log, t, [{ id: "h", hunter: true }]);
  }
  const replay = freezeKillCam(log, CAPTURE);
  assert.equal(replay?.start, NOW - 600);
});

test("poses interpolate between samples, angles the short way round", () => {
  const ring = createPoseRing(4, 1);
  const log = { ring, shots: [], decoys: [] };
  record(log, NOW - 100, [{ id: "h", hunter: true, x: 0, aim: Math.PI - 0.1 }]);
  record(log, NOW, [{ id: "h", hunter: true, x: 2, aim: -Math.PI + 0.1 }]);
  const replay = freezeKillCam(log, CAPTURE);
  const pose = createPoseOut();
  assert.equal(samplePose(replay.tracks[0], NOW - 50, pose), true);
  assert.equal(pose.x, 1);
  assert.ok(Math.abs(Math.abs(pose.aim) - Math.PI) < 1e-9);
});

test("a player absent for longer than the gap limit is not drawn there", () => {
  const ring = createPoseRing(4, 1);
  const log = { ring, shots: [], decoys: [] };
  record(log, NOW - 1000, [{ id: "h", hunter: true }]);
  record(log, NOW, [{ id: "h", hunter: true }]);
  const replay = freezeKillCam(log, CAPTURE);
  const pose = createPoseOut();
  assert.equal(samplePose(replay.tracks[0], NOW - 500, pose), false);
  assert.equal(samplePose(replay.tracks[0], NOW, pose), true);
});

test("the timeline plays in real time, slows into the shot, then holds", () => {
  const log = huntLog();
  logShot(log, shotAt(NOW - 20));
  const replay = freezeKillCam(log, CAPTURE);
  const realSpan = replay.shotAt - KILL_CAM_SLOWMO_MS - replay.start;
  assert.equal(sourceTimeAt(replay, 0), replay.start);
  assert.equal(sourceTimeAt(replay, realSpan), replay.shotAt - KILL_CAM_SLOWMO_MS);
  assert.equal(
    sourceTimeAt(replay, realSpan + KILL_CAM_SLOWMO_MS / KILL_CAM_SLOWMO_RATE),
    replay.shotAt,
  );
  assert.equal(sourceTimeAt(replay, 1e9), replay.end);
  assert.equal(
    replayDurationMs(replay),
    realSpan + KILL_CAM_SLOWMO_MS / KILL_CAM_SLOWMO_RATE + KILL_CAM_TAIL_MS,
  );
});

test("the replay is short: it never runs past five seconds", () => {
  const log = huntLog();
  logShot(log, shotAt(NOW));
  assert.ok(replayDurationMs(freezeKillCam(log, CAPTURE)) <= 5_000);
});

test("the killing shot is reached only once its moment plays", () => {
  const log = huntLog();
  logShot(log, shotAt(NOW - 20));
  const replay = freezeKillCam(log, CAPTURE);
  assert.equal(replayReachedShot(replay, 0), false);
  assert.equal(replayReachedShot(replay, replayDurationMs(replay)), true);
});

test("the replay ends on the hunter's last shot, not on someone else's", () => {
  const log = huntLog();
  logShot(log, shotAt(NOW - 900));
  logShot(log, shotAt(NOW - 300));
  logShot(log, shotAt(NOW - 100, "other"));
  const replay = freezeKillCam(log, CAPTURE);
  assert.equal(replay.shotAt, NOW - 300);
  assert.equal(replay.shots.length, 3);
  assert.equal(replay.looks.length, 2);
});

test("shots older than a replay reaches are forgotten", () => {
  const log = createKillCamLog();
  logShot(log, shotAt(0));
  logShot(log, shotAt(KILL_CAM_WINDOW_MS * 10));
  assert.equal(log.shots.length, 1);
});

test("a shot's look is the yaw and elevation of its mean pellet", () => {
  const look = shotLook({
    ...shotAt(0),
    origin: { x: 0, y: 1, z: 0 },
    ends: [
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: -1 },
    ],
  });
  assert.ok(Math.abs(look.yaw - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(look.pitch - -Math.PI / 4) < 1e-9);
});

test("away from any shot the hunter's eye is level along its synced aim", () => {
  const replay = freezeKillCam(huntLog(), CAPTURE);
  const eye = createEyeOut();
  assert.equal(
    hunterEyeAt(
      replay,
      replay.tracks.find((t) => t.id === "h"),
      NOW - 2000,
      EYE,
      createPoseOut(),
      eye,
    ),
    true,
  );
  assert.equal(eye.pitch, 0);
  assert.ok(Math.abs(eye.yaw - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(eye.y - EYE) < 1e-9);
});

test("on the shot the eye is exactly where the shot left from, looking along it", () => {
  const log = huntLog();
  const shot = shotAt(NOW - 20);
  logShot(log, shot);
  const replay = freezeKillCam(log, CAPTURE);
  const track = replay.tracks.find((t) => t.id === "h");
  const eye = createEyeOut();
  hunterEyeAt(replay, track, replay.shotAt, EYE, createPoseOut(), eye);
  const look = shotLook(shot);
  assert.deepEqual([eye.x, eye.y, eye.z], [shot.origin.x, shot.origin.y, shot.origin.z]);
  assert.ok(Math.abs(eye.pitch - look.pitch) < 1e-9);
  hunterEyeAt(replay, track, replay.end, EYE, createPoseOut(), eye);
  assert.ok(Math.abs(eye.pitch - look.pitch) < 1e-9);
});

test("the eye swings onto a shot only within the aim lead", () => {
  const log = huntLog();
  logShot(log, shotAt(NOW - 20));
  const replay = freezeKillCam(log, CAPTURE);
  const track = replay.tracks.find((t) => t.id === "h");
  const eye = createEyeOut();
  hunterEyeAt(replay, track, NOW - 20 - KILL_CAM_AIM_LEAD_MS - 1, EYE, createPoseOut(), eye);
  assert.equal(eye.pitch, 0);
  hunterEyeAt(replay, track, NOW - 20 - KILL_CAM_AIM_LEAD_MS / 2, EYE, createPoseOut(), eye);
  assert.ok(eye.pitch < 0 && eye.pitch > shotLook(shotAt(0)).pitch);
});

test("the victim is replayed in the disguise it wore, even once samples show it converted", () => {
  const log = huntLog();
  record(log, NOW, [
    { id: "me", hunter: true, propType: "" },
    { id: "h", hunter: true },
  ]);
  const replay = freezeKillCam(log, CAPTURE);
  const me = replay.tracks.find((t) => t.id === "me");
  assert.deepEqual(appearanceOf(me, "me"), { hunter: false, propType: "crate" });
  assert.deepEqual(appearanceOf(me, "someone-else"), { hunter: true, propType: "" });
});

test("decoys keep the span they stood, and the replay keeps those it overlaps", () => {
  const log = huntLog();
  const decoy = { id: "d1", x: 1, y: 0, z: 1, rot: 0, propType: "crate" };
  logDecoyAdded(log, decoy, NOW - 5_000);
  logDecoyRemoved(log, "d1", NOW - 1_000);
  logDecoyAdded(log, { ...decoy, id: "d2" }, NOW - 500);
  const replay = freezeKillCam(log, CAPTURE);
  assert.deepEqual(
    replay.decoys.map((d) => d.id),
    ["d1", "d2"],
  );
  const [d1, d2] = replay.decoys;
  assert.equal(decoyStandsAt(d1, NOW - 2_000), true);
  assert.equal(decoyStandsAt(d1, NOW - 1_000), false);
  assert.equal(decoyStandsAt(d2, NOW - 600), false);
  assert.equal(decoyStandsAt(d2, NOW), true);
});

test("decoys gone long before any replay are forgotten", () => {
  const log = createKillCamLog();
  const decoy = { id: "d1", x: 0, y: 0, z: 0, rot: 0, propType: "crate" };
  logDecoyAdded(log, decoy, 0);
  logDecoyRemoved(log, "d1", 10);
  logDecoyAdded(log, { ...decoy, id: "d2" }, KILL_CAM_WINDOW_MS * 10);
  logDecoyRemoved(log, "d2", KILL_CAM_WINDOW_MS * 10 + 1);
  assert.deepEqual(
    log.decoys.map((d) => d.id),
    ["d2"],
  );
});

test("the weapon falls back to the hunter's when it fired nothing in the window", () => {
  const replay = freezeKillCam(huntLog(), { ...CAPTURE, weapon: "shotgun" });
  assert.equal(replay.weapon, "shotgun");
  assert.equal(replay.shotAt, NOW);
});

test("the kill cam copy names the hunter and the skip key", () => {
  assert.equal(killCamViewLine("Rex"), "Rex's view");
  assert.equal(killCamViewLine(""), "The hunter's view");
  assert.equal(KILL_CAM_SKIP_CODE, "Space");
  assert.match(KILL_CAM_COPY.skip, /Space/);
});

test("the kill cam plays only while another prop is still in play", () => {
  const prop = { role: "prop", alive: true };
  const hunter = { role: "hunter", alive: true };
  const dead = { role: "prop", alive: false };
  assert.equal(
    huntGoesOn(
      new Map([
        ["me", prop],
        ["p2", prop],
        ["h", hunter],
      ]),
      "me",
    ),
    true,
  );
  assert.equal(
    huntGoesOn(
      new Map([
        ["me", prop],
        ["h", hunter],
      ]),
      "me",
    ),
    false,
  );
  assert.equal(
    huntGoesOn(
      new Map([
        ["me", prop],
        ["p2", dead],
      ]),
      "me",
    ),
    false,
  );
});
