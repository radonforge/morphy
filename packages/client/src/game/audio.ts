import type { WeaponId } from "@webhunt/shared";

const MASTER_VOLUME = 0.6;
const MUTE_STORAGE_KEY = "webhunt:muted";
const MUTE_FADE_S = 0.05;
const NOISE_SECONDS = 0.2;

const AMBIENT_GAIN = 0.007;
const AMBIENT_FREQS = [48, 72];
const AMBIENT_FILTER_HZ = 160;
const AMBIENT_FADE_IN_S = 1.5;
const AMBIENT_FADE_OUT_S = 0.8;

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
let noiseBuffer: AudioBuffer | null = null;
let ambient: { stop: () => void } | null = null;

function readMuted(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(MUTE_STORAGE_KEY) === "1";
}

function ensure(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = muted ? 0 : MASTER_VOLUME;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") void audioContext.resume();
  return { ctx: audioContext, master: masterGain! };
}

function tone(ctx: AudioContext, master: GainNode, spec: ToneSpec): void {
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
}

function noiseBurst(
  ctx: AudioContext,
  master: GainNode,
  opts: { peak: number; dur: number; filterHz: number },
): void {
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
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(MUTE_STORAGE_KEY, value ? "1" : "0");
  }
  if (masterGain && audioContext) {
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(value ? 0 : MASTER_VOLUME, now, MUTE_FADE_S);
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/** Play a short rising "honk" for a prop taunt. `volume` is 0..1 (typically by distance). */
export function playTaunt(volume: number): void {
  const e = ensure();
  if (!e || volume <= 0) return;
  tone(e.ctx, e.master, {
    type: "square",
    f0: 420,
    f1: 640,
    fTime: 0.12,
    peak: Math.min(0.3, volume * 0.3),
    attack: 0.02,
    dur: 0.26,
  });
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

/** Rising chime confirming a hunter's shot caught a prop. */
export function playHitConfirm(): void {
  const e = ensure();
  if (!e) return;
  tone(e.ctx, e.master, { type: "triangle", f0: 880, f1: 1320, peak: 0.25, dur: 0.16 });
}

/**
 * Weapon-specific blaster report: pistol crack, shotgun boom, rifle snap.
 * `volume` is 0..1 (1 for the local shooter, by distance for others).
 */
export function playWeaponShot(weapon: WeaponId, volume = 1): void {
  const e = ensure();
  if (!e || volume <= 0) return;
  const level = Math.min(1, volume);
  switch (weapon) {
    case "shotgun":
      noiseBurst(e.ctx, e.master, { peak: 0.42 * level, dur: 0.13, filterHz: 850 });
      tone(e.ctx, e.master, {
        type: "square",
        f0: 300,
        f1: 85,
        fTime: 0.11,
        peak: 0.26 * level,
        dur: 0.17,
      });
      break;
    case "rifle":
      noiseBurst(e.ctx, e.master, { peak: 0.3 * level, dur: 0.05, filterHz: 2600 });
      tone(e.ctx, e.master, {
        type: "square",
        f0: 1150,
        f1: 220,
        fTime: 0.05,
        peak: 0.2 * level,
        dur: 0.09,
      });
      break;
    default:
      noiseBurst(e.ctx, e.master, { peak: 0.35 * level, dur: 0.06, filterHz: 1800 });
      tone(e.ctx, e.master, {
        type: "square",
        f0: 700,
        f1: 160,
        fTime: 0.08,
        peak: 0.22 * level,
        dur: 0.1,
      });
  }
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

/** Start a faint low sine pad, routed through the master (mute applies). */
export function startAmbient(): void {
  const e = ensure();
  if (!e || ambient) return;
  const { ctx, master } = e;
  const ambGain = ctx.createGain();
  ambGain.gain.value = 0.0001;
  ambGain.gain.setTargetAtTime(AMBIENT_GAIN, ctx.currentTime, AMBIENT_FADE_IN_S);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = AMBIENT_FILTER_HZ;
  const oscs = AMBIENT_FREQS.map((f) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    osc.connect(filter);
    osc.start();
    return osc;
  });
  filter.connect(ambGain).connect(master);
  ambient = {
    stop: () => {
      const now = ctx.currentTime;
      ambGain.gain.setTargetAtTime(0.0001, now, AMBIENT_FADE_OUT_S);
      oscs.forEach((osc) => {
        osc.stop(now + AMBIENT_FADE_OUT_S * 4);
      });
    },
  };
}

export function stopAmbient(): void {
  ambient?.stop();
  ambient = null;
}
