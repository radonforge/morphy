import type { WeaponId } from "@morphy/shared";
import { storageGet, storageSet } from "../safeStorage";

const DEFAULT_VOLUME = 0.6;
const MUTE_STORAGE_KEY = "morphy:muted";
const VOLUME_STORAGE_KEY = "morphy:volume";
const UI_SOUNDS_STORAGE_KEY = "morphy:ui-sounds";
const MUTE_FADE_S = 0.05;
const NOISE_SECONDS = 0.2;

const SAMPLE_BASE = "/sounds/";
const SAMPLE_FETCH_TIMEOUT_MS = 10_000;
const WEAPON_SAMPLE_LEVEL = 0.5;
const HIT_SAMPLE_LEVEL = 0.35;

const WEAPON_SAMPLES: Record<WeaponId, readonly string[]> = {
  pistol: ["sci-fi/laserSmall_000.ogg", "sci-fi/laserSmall_001.ogg", "sci-fi/laserSmall_002.ogg"],
  shotgun: ["sci-fi/laserLarge_000.ogg", "sci-fi/laserLarge_001.ogg", "sci-fi/laserLarge_002.ogg"],
  rifle: ["sci-fi/laserRetro_000.ogg", "sci-fi/laserRetro_001.ogg", "sci-fi/laserRetro_002.ogg"],
};
const HIT_SAMPLES: readonly string[] = ["sci-fi/impactMetal_000.ogg", "sci-fi/impactMetal_001.ogg"];
const DECOY_BREAK_SAMPLES: readonly string[] = [
  "sci-fi/explosionCrunch_000.ogg",
  "sci-fi/explosionCrunch_001.ogg",
];
const DECOY_BREAK_SAMPLE_LEVEL = 0.4;

const UI_HOVER_SAMPLE = "ui/rollover1.ogg";
const UI_CLICK_SAMPLE = "ui/click1.ogg";
const UI_OPEN_SAMPLE = "ui/switch2.ogg";
const UI_CLOSE_SAMPLE = "ui/switch3.ogg";

const UI_HOVER_LEVEL = 0.12;
const UI_CLICK_LEVEL = 0.3;
const UI_SHEET_LEVEL = 0.3;
const UI_HOVER_MIN_INTERVAL_MS = 70;

const MUSIC_SAMPLE = "music/lobby-theme.ogg";
const MUSIC_STORAGE_KEY = "morphy:music";
const MUSIC_VOLUME_STORAGE_KEY = "morphy:music-volume";
const MUSIC_DEFAULT_VOLUME = 0.4;
const MUSIC_FADE_IN_S = 1.2;
const MUSIC_FADE_OUT_S = 0.4;
const MUSIC_STOP_DELAY_FACTOR = 4;

interface ToneSpec {
  type: OscillatorType;
  f0: number;
  f1?: number;
  fTime?: number;
  peak: number;
  attack?: number;
  dur: number;
  delay?: number;
}

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = readMuted();
let volume = readVolume();
let uiSoundsEnabled = readUiSoundsEnabled();
let noiseBuffer: AudioBuffer | null = null;
let lastUiHoverAt = 0;
let musicEnabled = readMusicEnabled();
let musicVolume = readMusicVolume();
let musicGain: GainNode | null = null;
let musicSource: AudioBufferSourceNode | null = null;
let musicWanted = false;

function readMuted(): boolean {
  return storageGet(MUTE_STORAGE_KEY) === "1";
}

function readMusicEnabled(): boolean {
  return storageGet(MUSIC_STORAGE_KEY) !== "0";
}

function readMusicVolume(): number {
  const raw = storageGet(MUSIC_VOLUME_STORAGE_KEY);
  if (raw === null) return MUSIC_DEFAULT_VOLUME;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : MUSIC_DEFAULT_VOLUME;
}

function readVolume(): number {
  const raw = storageGet(VOLUME_STORAGE_KEY);
  if (raw === null) return DEFAULT_VOLUME;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : DEFAULT_VOLUME;
}

function readUiSoundsEnabled(): boolean {
  return storageGet(UI_SOUNDS_STORAGE_KEY) !== "0";
}

function ensure(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = muted ? 0 : volume;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") void audioContext.resume();
  return { ctx: audioContext, master: masterGain! };
}

function tone(ctx: AudioContext, master: AudioNode, spec: ToneSpec): OscillatorNode {
  const start = ctx.currentTime + (spec.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.f0, start);
  if (spec.f1 !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(spec.f1, start + (spec.fTime ?? 0.08));
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(spec.peak, start + (spec.attack ?? 0.01));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.dur);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + spec.dur + 0.02);
  return osc;
}

/**
 * A stereo panner feeding `master`, for a sound placed left or right of the
 * listener (`pan` -1..1). The caller disconnects it once its source ends.
 */
function stereo(ctx: AudioContext, master: GainNode, pan: number): StereoPannerNode {
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(master);
  return panner;
}

function noiseBurst(
  ctx: AudioContext,
  master: AudioNode,
  opts: { peak: number; dur: number; filterHz: number },
): AudioBufferSourceNode {
  if (!noiseBuffer) {
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = opts.filterHz;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(opts.peak, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(now);
  src.stop(now + opts.dur + 0.02);
  return src;
}

const sampleCache = new Map<string, Promise<AudioBuffer | null>>();

function loadSample(ctx: AudioContext, name: string): Promise<AudioBuffer | null> {
  let cached = sampleCache.get(name);
  if (!cached) {
    cached = fetch(`${SAMPLE_BASE}${name}`, {
      signal: AbortSignal.timeout(SAMPLE_FETCH_TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .catch((error: unknown) => {
        sampleCache.delete(name);
        console.warn(`[audio] sample unavailable, will retry on next play: ${name}`, error);
        return null;
      });
    sampleCache.set(name, cached);
  }
  return cached;
}

function playSample(name: string, volume: number): void {
  const e = ensure();
  if (!e || volume <= 0) return;
  void loadSample(e.ctx, name).then((buffer) => {
    if (!buffer) return;
    const src = e.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = e.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(e.master);
    src.start();
  });
}

function pickSample(names: readonly string[]): string {
  return names[Math.floor(Math.random() * names.length)] ?? names[0]!;
}

/** Kick off sample downloads/decodes so the first shot isn't delayed. */
export function preloadSamples(): void {
  const e = ensure();
  if (!e) return;
  for (const names of Object.values(WEAPON_SAMPLES)) {
    for (const name of names) void loadSample(e.ctx, name);
  }
  for (const name of HIT_SAMPLES) void loadSample(e.ctx, name);
  for (const name of DECOY_BREAK_SAMPLES) void loadSample(e.ctx, name);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  storageSet(MUTE_STORAGE_KEY, value ? "1" : "0");
  if (masterGain && audioContext) {
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(value ? 0 : volume, now, MUTE_FADE_S);
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

export function getVolume(): number {
  return volume;
}

/** Set master volume (0..1), persisted; a live context ramps smoothly unless muted. */
export function setVolume(value: number): void {
  volume = Math.min(1, Math.max(0, value));
  storageSet(VOLUME_STORAGE_KEY, String(volume));
  if (masterGain && audioContext && !muted) {
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(volume, now, MUTE_FADE_S);
  }
}

export function areUiSoundsEnabled(): boolean {
  return uiSoundsEnabled;
}

/** Toggle menu interface cues, persisted. Game sounds are unaffected. */
export function setUiSoundsEnabled(value: boolean): void {
  uiSoundsEnabled = value;
  storageSet(UI_SOUNDS_STORAGE_KEY, value ? "1" : "0");
}

/** Create/resume the context and warm the UI sample cache; call on the first user gesture. */
export function unlockAudio(): void {
  const e = ensure();
  if (!e) return;
  const names = [UI_HOVER_SAMPLE, UI_CLICK_SAMPLE, UI_OPEN_SAMPLE, UI_CLOSE_SAMPLE];
  for (const name of names) void loadSample(e.ctx, name);
}

/** Faint tick on button/tab hover, throttled so cursor sweeps don't machine-gun. */
export function playUiHover(): void {
  if (!uiSoundsEnabled) return;
  const now = performance.now();
  if (now - lastUiHoverAt < UI_HOVER_MIN_INTERVAL_MS) return;
  lastUiHoverAt = now;
  playSample(UI_HOVER_SAMPLE, UI_HOVER_LEVEL);
}

/** Soft press for generic buttons and toggles. */
export function playUiClick(): void {
  if (!uiSoundsEnabled) return;
  playSample(UI_CLICK_SAMPLE, UI_CLICK_LEVEL);
}

/** Drawer/sheet opening. */
export function playUiOpen(): void {
  if (!uiSoundsEnabled) return;
  playSample(UI_OPEN_SAMPLE, UI_SHEET_LEVEL);
}

/** Drawer/sheet closing. */
export function playUiClose(): void {
  if (!uiSoundsEnabled) return;
  playSample(UI_CLOSE_SAMPLE, UI_SHEET_LEVEL);
}

/** Soft rising two-tone confirm when the player hits Play / Start match. */
export function playUiDeploy(): void {
  if (!uiSoundsEnabled) return;
  const e = ensure();
  if (!e) return;
  tone(e.ctx, e.master, { type: "triangle", f0: 440, f1: 660, fTime: 0.08, peak: 0.18, dur: 0.16 });
  tone(e.ctx, e.master, {
    type: "triangle",
    f0: 660,
    f1: 880,
    fTime: 0.08,
    peak: 0.16,
    dur: 0.22,
    delay: 0.12,
  });
}

export function isMusicEnabled(): boolean {
  return musicEnabled;
}

/** Persist the music preference; the caller starts/stops playback to match. */
export function setMusicEnabled(value: boolean): void {
  musicEnabled = value;
  storageSet(MUSIC_STORAGE_KEY, value ? "1" : "0");
}

export function getMusicVolume(): number {
  return musicVolume;
}

/** Set music level (0..1) relative to the master volume, persisted; ramps live playback. */
export function setMusicVolume(value: number): void {
  musicVolume = Math.min(1, Math.max(0, value));
  storageSet(MUSIC_VOLUME_STORAGE_KEY, String(musicVolume));
  if (musicGain && audioContext && musicSource) {
    const now = audioContext.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setTargetAtTime(musicVolume, now, MUTE_FADE_S);
  }
}

/**
 * Start the looped lobby theme with a fade-in; idempotent while playing or loading.
 * Each start gets its own gain node so a restart during a previous fade-out
 * crossfades cleanly instead of fighting over one shared gain curve.
 */
export function startLobbyMusic(): void {
  if (!musicEnabled || musicWanted) return;
  const e = ensure();
  if (!e) return;
  musicWanted = true;
  void loadSample(e.ctx, MUSIC_SAMPLE).then((buffer) => {
    if (!buffer) {
      musicWanted = false;
      return;
    }
    if (!musicWanted || musicSource) return;
    try {
      const gain = e.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(e.master);
      const src = e.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(gain);
      src.onended = () => gain.disconnect();
      const now = e.ctx.currentTime;
      gain.gain.setTargetAtTime(musicVolume, now, MUSIC_FADE_IN_S);
      src.start(now);
      musicSource = src;
      musicGain = gain;
    } catch {
      musicWanted = false;
    }
  });
}

/** Fade out and stop the lobby theme; call when leaving the menu. */
export function stopLobbyMusic(): void {
  musicWanted = false;
  if (!musicSource || !musicGain || !audioContext) {
    musicSource = null;
    musicGain = null;
    return;
  }
  const now = audioContext.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setTargetAtTime(0, now, MUSIC_FADE_OUT_S);
  musicSource.stop(now + MUSIC_FADE_OUT_S * MUSIC_STOP_DELAY_FACTOR);
  musicSource = null;
  musicGain = null;
}

/**
 * Play a short rising "honk" for a prop taunt. `volume` is 0..1 (typically by
 * distance) and `pan` -1..1 places it left or right, so a hunter hears which
 * way it came from.
 */
export function playTaunt(volume: number, pan = 0): void {
  const e = ensure();
  if (!e || volume <= 0) return;
  const panner = stereo(e.ctx, e.master, pan);
  const osc = tone(e.ctx, panner, {
    type: "square",
    f0: 420,
    f1: 640,
    fTime: 0.12,
    peak: Math.min(0.3, volume * 0.3),
    attack: 0.02,
    dur: 0.26,
  });
  osc.onended = () => panner.disconnect();
}

/**
 * Low falling sweep with a faint ping on top for a hunter's sonar pulse.
 * `volume` is 0..1 (typically by distance) and `pan` -1..1 places it, so a
 * prop hears which side the hunter sounded from.
 */
export function playSonar(volume: number, pan = 0): void {
  const e = ensure();
  if (!e || volume <= 0) return;
  const panner = stereo(e.ctx, e.master, pan);
  const level = Math.min(1, volume);
  const sweep = tone(e.ctx, panner, {
    type: "sine",
    f0: 260,
    f1: 90,
    fTime: 0.55,
    peak: 0.22 * level,
    attack: 0.02,
    dur: 0.6,
  });
  tone(e.ctx, panner, {
    type: "triangle",
    f0: 1320,
    peak: 0.05 * level,
    dur: 0.18,
    delay: 0.05,
  });
  sweep.onended = () => panner.disconnect();
}

/**
 * Papery pop with a bright rising chirp for a confetti puff. `volume` is 0..1
 * (typically by distance) and `pan` -1..1 places it.
 */
export function playPuff(volume: number, pan = 0): void {
  const e = ensure();
  if (!e || volume <= 0) return;
  const panner = stereo(e.ctx, e.master, pan);
  const level = Math.min(1, volume);
  const pop = noiseBurst(e.ctx, panner, { peak: 0.3 * level, dur: 0.28, filterHz: 1800 });
  tone(e.ctx, panner, {
    type: "triangle",
    f0: 520,
    f1: 1560,
    fTime: 0.16,
    peak: 0.1 * level,
    dur: 0.2,
  });
  pop.onended = () => panner.disconnect();
}

/** Clean two-tone materialize sweep when a player morphs into a prop. `volume` is 0..1. */
export function playMorph(volume = 1): void {
  const e = ensure();
  if (!e || volume <= 0) return;
  const level = Math.min(1, volume);
  tone(e.ctx, e.master, {
    type: "sine",
    f0: 300,
    f1: 900,
    fTime: 0.22,
    peak: 0.12 * level,
    attack: 0.03,
    dur: 0.3,
  });
  tone(e.ctx, e.master, {
    type: "sine",
    f0: 600,
    f1: 1800,
    fTime: 0.22,
    peak: 0.05 * level,
    attack: 0.03,
    dur: 0.3,
  });
  tone(e.ctx, e.master, {
    type: "triangle",
    f0: 1200,
    peak: 0.05 * level,
    dur: 0.12,
    delay: 0.2,
  });
}

/** Crunchy shatter when a decoy breaks. `volume` is 0..1 (typically by distance). */
export function playDecoyBreak(volume = 1): void {
  playSample(pickSample(DECOY_BREAK_SAMPLES), DECOY_BREAK_SAMPLE_LEVEL * Math.min(1, volume));
}

/** Metallic impact layered under a rising chime confirming a hunter's shot caught a prop. */
export function playHitConfirm(): void {
  const e = ensure();
  if (!e) return;
  playSample(pickSample(HIT_SAMPLES), HIT_SAMPLE_LEVEL);
  tone(e.ctx, e.master, { type: "triangle", f0: 880, f1: 1320, peak: 0.25, dur: 0.16 });
}

/**
 * Weapon-specific blaster report from the Kenney sci-fi sample set.
 * `volume` is 0..1 (1 for the local shooter, by distance for others).
 */
export function playWeaponShot(weapon: WeaponId, volume = 1): void {
  playSample(pickSample(WEAPON_SAMPLES[weapon]), WEAPON_SAMPLE_LEVEL * Math.min(1, volume));
}

/** Soft low thud for a footstep. `volume` is 0..1 (1 for the local player, by distance for others). */
export function playStep(volume = 1): void {
  const e = ensure();
  if (!e || volume <= 0) return;
  tone(e.ctx, e.master, {
    type: "sine",
    f0: 120,
    f1: 70,
    fTime: 0.05,
    peak: 0.08 * Math.min(1, volume),
    dur: 0.07,
  });
}

/** Quick rising whoosh as the local player leaves the ground. */
export function playJump(): void {
  const e = ensure();
  if (!e) return;
  tone(e.ctx, e.master, { type: "sine", f0: 160, f1: 250, fTime: 0.09, peak: 0.06, dur: 0.12 });
}

/** Weighty thud when the local player lands; `intensity` is 0..1 and scales the impact. */
export function playLand(intensity: number): void {
  const e = ensure();
  if (!e) return;
  const level = Math.min(1, Math.max(0, intensity));
  if (level <= 0) return;
  noiseBurst(e.ctx, e.master, { peak: 0.04 + 0.12 * level, dur: 0.08, filterHz: 320 });
  tone(e.ctx, e.master, {
    type: "sine",
    f0: 110,
    f1: 60,
    fTime: 0.06,
    peak: 0.04 + 0.1 * level,
    dur: 0.1,
  });
}

/** Low thunk for a wasted shot (hunter took the wrong-shot penalty). */
export function playMiss(): void {
  const e = ensure();
  if (!e) return;
  tone(e.ctx, e.master, { type: "sawtooth", f0: 180, f1: 90, fTime: 0.12, peak: 0.18, dur: 0.18 });
}

/** Distant blip when another player is eliminated. */
export function playKill(): void {
  const e = ensure();
  if (!e) return;
  tone(e.ctx, e.master, { type: "triangle", f0: 520, f1: 660, fTime: 0.05, peak: 0.1, dur: 0.1 });
}

/** Descending power-down when the local player is eliminated. */
export function playDeath(): void {
  const e = ensure();
  if (!e) return;
  tone(e.ctx, e.master, { type: "sawtooth", f0: 320, f1: 70, fTime: 0.5, peak: 0.22, dur: 0.6 });
}

/** Two ascending beeps marking the start of the round. */
export function playRoundStart(): void {
  const e = ensure();
  if (!e) return;
  tone(e.ctx, e.master, { type: "square", f0: 520, peak: 0.16, dur: 0.12 });
  tone(e.ctx, e.master, { type: "square", f0: 780, peak: 0.16, dur: 0.16, delay: 0.14 });
}

/** Rising triad on win, falling tones on loss, at round end. */
export function playRoundEnd(won: boolean): void {
  const e = ensure();
  if (!e) return;
  const notes = won ? [523, 659, 784] : [494, 392, 311];
  notes.forEach((f, i) => {
    tone(e.ctx, e.master, { type: "triangle", f0: f, peak: 0.2, dur: 0.3, delay: i * 0.14 });
  });
}
