import { KILL_CAM_WINDOW_MS, MAX_PLAYERS, type WeaponId } from "@morphy/shared";

/** How often the recorder samples every player's pose while the local player is a prop. */
export const KILL_CAM_SAMPLE_MS = 33;
/** How long before the killing shot the replay drops into slow motion. */
export const KILL_CAM_SLOWMO_MS = 400;
/** Playback rate of the slow-motion stretch: half speed. */
export const KILL_CAM_SLOWMO_RATE = 0.5;
/** How long the replay holds on the shot before handing over to the caught card. */
export const KILL_CAM_TAIL_MS = 350;
/** How long before a shot the hunter's view swings onto the line it fired along. */
export const KILL_CAM_AIM_LEAD_MS = 450;
/** A pose gap longer than this means the player was not in play (dead, or not yet joined). */
export const KILL_CAM_MAX_GAP_MS = KILL_CAM_SAMPLE_MS * 4;

const POSE_FIELDS = 6;
const FIELD_X = 0;
const FIELD_Y = 1;
const FIELD_Z = 2;
const FIELD_ROT = 3;
const FIELD_AIM = 4;
const FIELD_PROP_ROT = 5;
const RING_MARGIN_MS = 500;
const SHOT_KEEP_MS = KILL_CAM_WINDOW_MS + RING_MARGIN_MS;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Preallocated ring of pose samples: one frame per sample, up to {@link MAX_PLAYERS}
 * poses per frame. Writing a sample allocates nothing, so recording costs a few stores
 * per player at {@link KILL_CAM_SAMPLE_MS}.
 */
export interface PoseRing {
  readonly frames: number;
  readonly perFrame: number;
  readonly times: Float64Array;
  readonly counts: Uint8Array;
  readonly ids: string[];
  readonly propTypes: string[];
  readonly hunters: Uint8Array;
  readonly poses: Float64Array;
  head: number;
  size: number;
  current: number;
}

/** A ring holding `frames` samples of up to `perFrame` players. */
export function createPoseRing(frames: number, perFrame: number = MAX_PLAYERS): PoseRing {
  return {
    frames,
    perFrame,
    times: new Float64Array(frames),
    counts: new Uint8Array(frames),
    ids: new Array<string>(frames * perFrame).fill(""),
    propTypes: new Array<string>(frames * perFrame).fill(""),
    hunters: new Uint8Array(frames * perFrame),
    poses: new Float64Array(frames * perFrame * POSE_FIELDS),
    head: 0,
    size: 0,
    current: -1,
  };
}

/** Whether a sample is due at `now`: the first one always is, then one per {@link KILL_CAM_SAMPLE_MS}. */
export function sampleDue(ring: PoseRing, now: number): boolean {
  if (ring.current < 0) return true;
  return now - (ring.times[ring.current] ?? 0) >= KILL_CAM_SAMPLE_MS;
}

/** Opens a new sample at `now`, overwriting the oldest once the ring is full. */
export function beginSample(ring: PoseRing, now: number): void {
  const frame = ring.head;
  ring.times[frame] = now;
  ring.counts[frame] = 0;
  ring.current = frame;
  ring.head = (frame + 1) % ring.frames;
  ring.size = Math.min(ring.size + 1, ring.frames);
}

/** Adds one player's pose to the open sample; ignored once the sample holds `perFrame` players. */
export function pushPose(
  ring: PoseRing,
  id: string,
  hunter: boolean,
  propType: string,
  x: number,
  y: number,
  z: number,
  rot: number,
  aim: number,
  propRot: number,
): void {
  const frame = ring.current;
  if (frame < 0) return;
  const count = ring.counts[frame] ?? 0;
  if (count >= ring.perFrame) return;
  const slot = frame * ring.perFrame + count;
  ring.ids[slot] = id;
  ring.propTypes[slot] = propType;
  ring.hunters[slot] = hunter ? 1 : 0;
  const base = slot * POSE_FIELDS;
  ring.poses[base + FIELD_X] = x;
  ring.poses[base + FIELD_Y] = y;
  ring.poses[base + FIELD_Z] = z;
  ring.poses[base + FIELD_ROT] = rot;
  ring.poses[base + FIELD_AIM] = aim;
  ring.poses[base + FIELD_PROP_ROT] = propRot;
  ring.counts[frame] = count + 1;
}

/** A shot the room broadcast, stamped with when it arrived. */
export interface ShotRecord {
  at: number;
  shooterId: string;
  weapon: WeaponId;
  origin: Vec3;
  ends: Vec3[];
}

/** A decoy and the span it stood on the map, `to` being infinite while it still stands. */
export interface DecoyRecord {
  id: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  propType: string;
  from: number;
  to: number;
}

/** Everything a kill cam replays: the pose ring plus the shots and decoys of the last moments. */
export interface KillCamLog {
  readonly ring: PoseRing;
  readonly shots: ShotRecord[];
  readonly decoys: DecoyRecord[];
}

/** A log whose ring covers the replay window with a margin to interpolate from. */
export function createKillCamLog(): KillCamLog {
  const frames = Math.ceil((KILL_CAM_WINDOW_MS + RING_MARGIN_MS) / KILL_CAM_SAMPLE_MS);
  return { ring: createPoseRing(frames), shots: [], decoys: [] };
}

/** Records a shot and forgets the ones too old to be replayed. */
export function logShot(log: KillCamLog, shot: ShotRecord): void {
  log.shots.push(shot);
  const cutoff = shot.at - SHOT_KEEP_MS;
  let stale = 0;
  while (stale < log.shots.length && (log.shots[stale]?.at ?? 0) < cutoff) stale++;
  if (stale > 0) log.shots.splice(0, stale);
}

/** Records a decoy placed at `at`. */
export function logDecoyAdded(
  log: KillCamLog,
  decoy: Omit<DecoyRecord, "from" | "to">,
  at: number,
): void {
  log.decoys.push({ ...decoy, from: at, to: Number.POSITIVE_INFINITY });
}

/** Marks a decoy gone at `at` and forgets the decoys gone for longer than a replay reaches. */
export function logDecoyRemoved(log: KillCamLog, id: string, at: number): void {
  for (const decoy of log.decoys) {
    if (decoy.id === id && decoy.to === Number.POSITIVE_INFINITY) decoy.to = at;
  }
  const cutoff = at - SHOT_KEEP_MS;
  for (let i = log.decoys.length - 1; i >= 0; i--) {
    if ((log.decoys[i]?.to ?? 0) < cutoff) log.decoys.splice(i, 1);
  }
}

/** One player's poses through the replay window, in time order. */
export interface ReplayTrack {
  id: string;
  times: number[];
  x: number[];
  y: number[];
  z: number[];
  rot: number[];
  aim: number[];
  propRot: number[];
  hunter: boolean[];
  propType: string[];
}

/** Where the hunter's eye was and the way it looked when a shot left it. */
export interface ShotLook {
  at: number;
  origin: Vec3;
  yaw: number;
  pitch: number;
}

/** A frozen copy of the last moments before the local player was caught. */
export interface KillReplay {
  start: number;
  end: number;
  shotAt: number;
  hunterId: string;
  victimId: string;
  weapon: WeaponId;
  tracks: ReplayTrack[];
  shots: ShotRecord[];
  looks: ShotLook[];
  decoys: DecoyRecord[];
}

/** What the capture was: when it landed, who fired, who was hit, and the hunter's weapon. */
export interface CaptureMoment {
  now: number;
  hunterId: string;
  victimId: string;
  weapon: WeaponId;
}

/**
 * Copies the log's last {@link KILL_CAM_WINDOW_MS} into a replay ending at the capture,
 * or null when the hunter was never sampled twice (it just joined, or the local player was
 * not recording), in which case the caught card shows as it did before the kill cam.
 */
export function freezeKillCam(log: KillCamLog, capture: CaptureMoment): KillReplay | null {
  const { ring } = log;
  const from = capture.now - KILL_CAM_WINDOW_MS;
  const keepFrom = from - KILL_CAM_MAX_GAP_MS;
  const tracks = new Map<string, ReplayTrack>();
  for (let n = 0; n < ring.size; n++) {
    const frame = (ring.head - ring.size + n + ring.frames) % ring.frames;
    const t = ring.times[frame] ?? 0;
    if (t < keepFrom || t > capture.now) continue;
    const count = ring.counts[frame] ?? 0;
    for (let i = 0; i < count; i++) {
      const slot = frame * ring.perFrame + i;
      const id = ring.ids[slot] ?? "";
      let track = tracks.get(id);
      if (!track) {
        track = {
          id,
          times: [],
          x: [],
          y: [],
          z: [],
          rot: [],
          aim: [],
          propRot: [],
          hunter: [],
          propType: [],
        };
        tracks.set(id, track);
      }
      const base = slot * POSE_FIELDS;
      track.times.push(t);
      track.x.push(ring.poses[base + FIELD_X] ?? 0);
      track.y.push(ring.poses[base + FIELD_Y] ?? 0);
      track.z.push(ring.poses[base + FIELD_Z] ?? 0);
      track.rot.push(ring.poses[base + FIELD_ROT] ?? 0);
      track.aim.push(ring.poses[base + FIELD_AIM] ?? 0);
      track.propRot.push(ring.poses[base + FIELD_PROP_ROT] ?? 0);
      track.hunter.push(ring.hunters[slot] === 1);
      track.propType.push(ring.propTypes[slot] ?? "");
    }
  }
  const hunter = tracks.get(capture.hunterId);
  if (!hunter || hunter.times.length < 2) return null;
  const start = Math.max(from, hunter.times[0] ?? from);
  const shots = log.shots.filter((shot) => shot.at >= start && shot.at <= capture.now);
  const looks: ShotLook[] = [];
  let weapon = capture.weapon;
  for (const shot of shots) {
    if (shot.shooterId !== capture.hunterId) continue;
    weapon = shot.weapon;
    looks.push(shotLook(shot));
  }
  const decoys = log.decoys
    .filter((decoy) => decoy.from <= capture.now && decoy.to >= start)
    .map((decoy) => ({ ...decoy }));
  return {
    start,
    end: capture.now,
    shotAt: looks[looks.length - 1]?.at ?? capture.now,
    hunterId: capture.hunterId,
    victimId: capture.victimId,
    weapon,
    tracks: [...tracks.values()],
    shots,
    looks,
    decoys,
  };
}

/** The look a shot reveals: the yaw (in the `aim` convention) and elevation of its mean pellet. */
export function shotLook(shot: ShotRecord): ShotLook {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (const end of shot.ends) {
    dx += end.x - shot.origin.x;
    dy += end.y - shot.origin.y;
    dz += end.z - shot.origin.z;
  }
  return {
    at: shot.at,
    origin: shot.origin,
    yaw: Math.atan2(dx, dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
  };
}

function slowStart(replay: KillReplay): number {
  return Math.max(replay.start, replay.shotAt - KILL_CAM_SLOWMO_MS);
}

/** How long the replay plays: real time up to the slow motion, the slowed shot, then the hold. */
export function replayDurationMs(replay: KillReplay): number {
  const slow = slowStart(replay);
  return slow - replay.start + (replay.shotAt - slow) / KILL_CAM_SLOWMO_RATE + KILL_CAM_TAIL_MS;
}

/** The moment of the recorded hunt shown `playbackMs` into the replay. */
export function sourceTimeAt(replay: KillReplay, playbackMs: number): number {
  const slow = slowStart(replay);
  const realSpan = slow - replay.start;
  if (playbackMs <= realSpan) return replay.start + Math.max(0, playbackMs);
  const slowed = replay.start + realSpan + (playbackMs - realSpan) * KILL_CAM_SLOWMO_RATE;
  return Math.min(slowed, replay.end);
}

/** Whether `playbackMs` into the replay the killing shot has already been fired. */
export function replayReachedShot(replay: KillReplay, playbackMs: number): boolean {
  return sourceTimeAt(replay, playbackMs) >= replay.shotAt;
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function lerpAngle(from: number, to: number, f: number): number {
  return from + wrapAngle(to - from) * f;
}

/** A player's interpolated pose; written in place so playback allocates nothing per frame. */
export interface PoseOut {
  x: number;
  y: number;
  z: number;
  rot: number;
  aim: number;
  propRot: number;
}

/** A fresh pose to sample into. */
export function createPoseOut(): PoseOut {
  return { x: 0, y: 0, z: 0, rot: 0, aim: 0, propRot: 0 };
}

function lerpAt(values: number[], lo: number, hi: number, f: number): number {
  const from = values[lo] ?? 0;
  return from + ((values[hi] ?? 0) - from) * f;
}

function copySample(track: ReplayTrack, i: number, out: PoseOut): void {
  out.x = track.x[i] ?? 0;
  out.y = track.y[i] ?? 0;
  out.z = track.z[i] ?? 0;
  out.rot = track.rot[i] ?? 0;
  out.aim = track.aim[i] ?? 0;
  out.propRot = track.propRot[i] ?? 0;
}

/**
 * Writes the track's pose at `t` into `out`, interpolating between the samples around it,
 * and returns whether the player was in play then: false before its first sample, after its
 * last, or inside a gap longer than {@link KILL_CAM_MAX_GAP_MS}.
 */
export function samplePose(track: ReplayTrack, t: number, out: PoseOut): boolean {
  const { times } = track;
  const last = times.length - 1;
  if (last < 0) return false;
  const first = times[0] ?? 0;
  const final = times[last] ?? 0;
  if (t <= first) {
    if (first - t > KILL_CAM_MAX_GAP_MS) return false;
    copySample(track, 0, out);
    return true;
  }
  if (t >= final) {
    if (t - final > KILL_CAM_MAX_GAP_MS) return false;
    copySample(track, last, out);
    return true;
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? 0) <= t) lo = mid;
    else hi = mid;
  }
  const t0 = times[lo] ?? 0;
  const t1 = times[hi] ?? 0;
  if (t1 - t0 > KILL_CAM_MAX_GAP_MS) return false;
  const f = (t - t0) / (t1 - t0);
  out.x = lerpAt(track.x, lo, hi, f);
  out.y = lerpAt(track.y, lo, hi, f);
  out.z = lerpAt(track.z, lo, hi, f);
  out.rot = lerpAngle(track.rot[lo] ?? 0, track.rot[hi] ?? 0, f);
  out.aim = lerpAngle(track.aim[lo] ?? 0, track.aim[hi] ?? 0, f);
  out.propRot = lerpAngle(track.propRot[lo] ?? 0, track.propRot[hi] ?? 0, f);
  return true;
}

/** How a replayed player looks: a hunter's avatar, or the disguise a prop wore. */
export interface Appearance {
  hunter: boolean;
  propType: string;
}

/**
 * The look a player is replayed in. The victim keeps the last disguise it wore, since its
 * final samples may already show it converted; everyone else looks as they did at the end.
 */
export function appearanceOf(track: ReplayTrack, victimId: string): Appearance {
  const last = track.times.length - 1;
  if (track.id === victimId) {
    for (let i = last; i >= 0; i--) {
      const propType = track.propType[i] ?? "";
      if (!track.hunter[i] && propType !== "") return { hunter: false, propType };
    }
  }
  return { hunter: track.hunter[last] ?? false, propType: track.propType[last] ?? "" };
}

/** Where the replay camera stands and looks: yaw in the `aim` convention, pitch up positive. */
export interface EyeOut {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** A fresh eye to sample into. */
export function createEyeOut(): EyeOut {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
}

function smoothstep(f: number): number {
  const c = Math.min(1, Math.max(0, f));
  return c * c * (3 - 2 * c);
}

/**
 * The hunter's eye at `t`, `eyeHeight` above its synced pose. The room never sends a pitch,
 * so the view is level except around a shot: over {@link KILL_CAM_AIM_LEAD_MS} it swings onto
 * the exact eye and line the shot left along, and after the last shot it holds there. Returns
 * false when the hunter was not in play at `t`.
 */
export function hunterEyeAt(
  replay: KillReplay,
  track: ReplayTrack,
  t: number,
  eyeHeight: number,
  pose: PoseOut,
  out: EyeOut,
): boolean {
  if (!samplePose(track, t, pose)) return false;
  let weight = 0;
  let look: ShotLook | null = null;
  const lastIndex = replay.looks.length - 1;
  for (let i = 0; i <= lastIndex; i++) {
    const candidate = replay.looks[i];
    if (!candidate) continue;
    const w =
      t <= candidate.at
        ? 1 - (candidate.at - t) / KILL_CAM_AIM_LEAD_MS
        : i === lastIndex
          ? 1
          : 1 - (t - candidate.at) / KILL_CAM_AIM_LEAD_MS;
    if (w > weight) {
      weight = w;
      look = candidate;
    }
  }
  const eyeY = pose.y + eyeHeight;
  if (!look) {
    out.x = pose.x;
    out.y = eyeY;
    out.z = pose.z;
    out.yaw = pose.aim;
    out.pitch = 0;
    return true;
  }
  const f = smoothstep(weight);
  out.x = pose.x + (look.origin.x - pose.x) * f;
  out.y = eyeY + (look.origin.y - eyeY) * f;
  out.z = pose.z + (look.origin.z - pose.z) * f;
  out.yaw = lerpAngle(pose.aim, look.yaw, f);
  out.pitch = look.pitch * f;
  return true;
}

/** Whether a replayed decoy stands at `t`. */
export function decoyStandsAt(decoy: DecoyRecord, t: number): boolean {
  return t >= decoy.from && t < decoy.to;
}
