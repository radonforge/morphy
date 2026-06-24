const TAUNT_START_HZ = 420;
const TAUNT_END_HZ = 640;
const TAUNT_DURATION_S = 0.26;
const MAX_GAIN = 0.3;

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return audioContext;
}

/**
 * Play a short rising "honk" for a prop taunt. `volume` is 0..1 (typically by distance).
 * Uses a synthesized oscillator so no audio asset is required.
 */
export function playTaunt(volume: number): void {
  const ctx = getContext();
  if (!ctx || volume <= 0) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(TAUNT_START_HZ, now);
  osc.frequency.exponentialRampToValueAtTime(TAUNT_END_HZ, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.min(MAX_GAIN, volume * MAX_GAIN), now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + TAUNT_DURATION_S);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + TAUNT_DURATION_S);
}
