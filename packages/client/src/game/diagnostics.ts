/** Frame times kept for the percentiles: about five seconds at 60 fps. */
export const FRAME_RING_SIZE = 300;

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const MS_PER_S = 1000;
const P50 = 0.5;
const P95 = 0.95;

/** Fixed-size ring of recent frame durations in milliseconds; recording never allocates. */
export interface FrameRing {
  samples: Float32Array;
  count: number;
  next: number;
}

export interface FrameStats {
  fps: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface GpuInfo {
  renderer: string;
  software: boolean;
}

/** Everything the "Copy diagnostics" text reports. Local only: nothing here identifies the device. */
export interface DiagnosticsReport {
  version: string;
  build: string;
  userAgent: string;
  gpu: GpuInfo;
  antialias: boolean;
  pixelRatio: number;
  bufferWidth: number;
  bufferHeight: number;
  cores: number | null;
  memoryGb: number | null;
  frames: FrameStats;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  heapMb: number | null;
  longTasks: number;
  longestTaskMs: number;
  contextLosses: number;
  map: string;
  phase: string;
  players: number;
  graphics: string;
}

export function createFrameRing(size: number = FRAME_RING_SIZE): FrameRing {
  return { samples: new Float32Array(size), count: 0, next: 0 };
}

export function recordFrame(ring: FrameRing, ms: number): void {
  ring.samples[ring.next] = ms;
  ring.next = (ring.next + 1) % ring.samples.length;
  ring.count = Math.min(ring.count + 1, ring.samples.length);
}

function percentile(sorted: Float32Array, fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

export function frameStats(ring: FrameRing): FrameStats {
  const recent = ring.samples.slice(0, ring.count).sort();
  let total = 0;
  for (const ms of recent) total += ms;
  return {
    fps: total > 0 ? (recent.length * MS_PER_S) / total : 0,
    p50Ms: percentile(recent, P50),
    p95Ms: percentile(recent, P95),
    maxMs: recent.length > 0 ? (recent[recent.length - 1] ?? 0) : 0,
  };
}

/** The unmasked GPU name, and whether the browser is rendering WebGL on the CPU instead. */
export function gpuInfo(unmaskedRenderer: string | null, fallbackRenderer: string): GpuInfo {
  const renderer = unmaskedRenderer || fallbackRenderer;
  return { renderer, software: SOFTWARE_RENDERER.test(renderer) };
}

function fixed(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function formatDiagnostics(r: DiagnosticsReport): string {
  const f = r.frames;
  return [
    `Morphy ${r.version} (${r.build})`,
    `GPU: ${r.gpu.renderer}`,
    `Hardware acceleration: ${r.gpu.software ? "OFF (software renderer)" : "on"}`,
    `Canvas: ${r.bufferWidth}x${r.bufferHeight} @ ${fixed(r.pixelRatio, 2)}x, antialias ${r.antialias ? "on" : "off"}`,
    `CPU cores: ${r.cores ?? "?"}, memory: ${r.memoryGb === null ? "?" : `${r.memoryGb} GB`}`,
    `Frames: ${fixed(f.fps)} fps, p50 ${fixed(f.p50Ms)} ms, p95 ${fixed(f.p95Ms)} ms, max ${fixed(f.maxMs)} ms`,
    `Draw calls: ${r.drawCalls}, triangles: ${r.triangles}`,
    `GPU memory: ${r.geometries} geometries, ${r.textures} textures, ${r.programs} programs`,
    `JS heap: ${r.heapMb === null ? "?" : `${fixed(r.heapMb)} MB`}`,
    `Long tasks: ${r.longTasks}, longest ${fixed(r.longestTaskMs, 0)} ms`,
    `WebGL context losses: ${r.contextLosses}`,
    `Graphics: ${r.graphics}`,
    `Map: ${r.map}, phase: ${r.phase}, players: ${r.players}`,
    `Browser: ${r.userAgent}`,
  ].join("\n");
}
