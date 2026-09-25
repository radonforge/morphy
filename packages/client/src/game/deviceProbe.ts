import { type GpuInfo, gpuInfo } from "./diagnostics";
import type { DeviceHints } from "./graphicsTier";

interface NavigatorMemory {
  deviceMemory?: number;
}

let cached: DeviceHints | null = null;

function probeGpu(): GpuInfo {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!context) return { renderer: "no WebGL", software: true };
  const debug = context.getExtension("WEBGL_debug_renderer_info");
  const unmasked = debug ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null;
  const info = gpuInfo(unmasked, String(context.getParameter(context.RENDERER)));
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return info;
}

/**
 * What Auto chooses a tier from, read once per page. The GPU name has to come from
 * a throwaway context: antialiasing is fixed when the game's own context is
 * created, so the tier must be known before that one exists.
 */
export function deviceHints(): DeviceHints {
  if (!cached) {
    cached = {
      gpu: probeGpu(),
      cores: navigator.hardwareConcurrency || null,
      memoryGb: (navigator as Navigator & NavigatorMemory).deviceMemory ?? null,
    };
  }
  return cached;
}
