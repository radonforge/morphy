import {
  type MapDefinition,
  MINIMAP_MOVE_WINDOW_MS,
  MINIMAP_RADIUS,
  type Role,
} from "@morphy/shared";
import { useEffect, useMemo, useRef } from "react";
import { useGuardedFrame } from "./guardedFrame";
import {
  arrowRotation,
  type MotionTrack,
  minimapBlips,
  minimapPlan,
  type PlanKind,
  trackMotion,
  worldToMinimap,
} from "./radar";
import type { LookRef, PlayersRef } from "./types";

const VOID_COLOR = "#080e1c";
const PLAN_COLORS: Record<PlanKind, string> = {
  floor: "#121b31",
  paving: "#162039",
  yard: "#172238",
  grass: "#1f4a39",
  block: "#2a3557",
};
const HUNTER_COLOR = "#ffb24a";
const HUNTER_INK = "#3a2203";
const MAX_PIXEL_RATIO = 2;
const BADGE_RADIUS_PX = 4.5;
const BADGE_RIM_PX = 1.2;
const BADGE_CORE_PX = 1.5;
const BOB_AMPLITUDE_PX = 1.6;
const BOB_RATE_RAD_PER_MS = (2 * Math.PI) / 300;
const PULSE_PERIOD_MS = 1_100;
const PULSE_REACH_PX = 9;
const PULSE_ALPHA = 0.5;
const FADE_START_MS = MINIMAP_MOVE_WINDOW_MS * 0.5;
const ARROW_EPSILON_RAD = 0.002;
const RING_SCALE_PERCENT = 25;
const RING_DASH = "2 2.5";

/** What the minimap's DOM half hands its per-frame painter. */
export interface MinimapSurface {
  /** The plan layer, under the edge vignette. */
  planCtx: CanvasRenderingContext2D;
  /** The hunters' layer, unfaded so a hunter at the edge of the radius still reads. */
  blipCtx: CanvasRenderingContext2D;
  /** The plan offset last drawn, so a still player costs no redraw; NaN forces one. */
  drawnX: number;
  drawnY: number;
  /** Whether the hunters' layer holds anything to clear. */
  blipsDrawn: boolean;
  arrow: HTMLElement;
  /** The rotation last written to the arrow, so it is restyled only when it turns. */
  arrowAngle: number;
  /** Device pixels per CSS pixel on the visible canvas. */
  ratio: number;
  /** Side of the visible canvas, in device pixels. */
  size: number;
  plan: HTMLCanvasElement;
  /** Device pixels per metre, on the plan and on the visible canvas alike. */
  scale: number;
  /** The world point at the plan canvas's top-left corner. */
  originX: number;
  originZ: number;
}

export type MinimapSurfaceRef = { current: MinimapSurface | null };

/**
 * Paint the static plan once, at exactly the visible canvas's scale, padded by
 * {@link MINIMAP_RADIUS} of void on every side so a player at the map's edge
 * still crops a full window out of it.
 */
function paintPlan(
  map: MapDefinition,
  scale: number,
): Pick<MinimapSurface, "plan" | "scale" | "originX" | "originZ"> {
  const originX = map.bounds.min.x - MINIMAP_RADIUS;
  const originZ = map.bounds.min.z - MINIMAP_RADIUS;
  const plan = document.createElement("canvas");
  plan.width = Math.ceil((map.bounds.max.x + MINIMAP_RADIUS - originX) * scale);
  plan.height = Math.ceil((map.bounds.max.z + MINIMAP_RADIUS - originZ) * scale);
  const ctx = plan.getContext("2d");
  if (ctx) {
    ctx.fillStyle = VOID_COLOR;
    ctx.fillRect(0, 0, plan.width, plan.height);
    for (const rect of minimapPlan(map)) {
      ctx.fillStyle = PLAN_COLORS[rect.kind];
      ctx.fillRect(
        (rect.x - rect.w / 2 - originX) * scale,
        (rect.z - rect.d / 2 - originZ) * scale,
        rect.w * scale,
        rect.d * scale,
      );
    }
  }
  return { plan, scale, originX, originZ };
}

/**
 * The round north-up radar at the top right of the match HUD: the plan within
 * {@link MINIMAP_RADIUS} of the player, fading out at its edge, with the player
 * as an arrow at the centre. This is the DOM half; {@link MinimapPainter},
 * inside the canvas, draws into it every frame without a React render.
 */
export function Minimap({
  map,
  surfaceRef,
}: {
  map: MapDefinition;
  surfaceRef: MinimapSurfaceRef;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blipRef = useRef<HTMLCanvasElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const blips = blipRef.current;
    const arrow = arrowRef.current;
    const planCtx = canvas?.getContext("2d");
    const blipCtx = blips?.getContext("2d");
    if (!root || !canvas || !blips || !planCtx || !blipCtx || !arrow) return;
    const fit = () => {
      const size = root.clientWidth;
      if (size <= 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const pixels = Math.round(size * ratio);
      canvas.width = pixels;
      canvas.height = pixels;
      blips.width = pixels;
      blips.height = pixels;
      surfaceRef.current = {
        planCtx,
        blipCtx,
        drawnX: Number.NaN,
        drawnY: Number.NaN,
        blipsDrawn: false,
        arrow,
        arrowAngle: Number.NaN,
        ratio,
        size: pixels,
        ...paintPlan(map, pixels / (2 * MINIMAP_RADIUS)),
      };
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    return () => {
      observer.disconnect();
      surfaceRef.current = null;
    };
  }, [map, surfaceRef]);

  return (
    <div className="minimap" ref={rootRef} aria-hidden="true">
      <canvas className="minimap-canvas minimap-plan" ref={canvasRef} />
      <svg className="minimap-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={RING_SCALE_PERCENT} strokeDasharray={RING_DASH} />
      </svg>
      <canvas className="minimap-canvas" ref={blipRef} />
      <div className="minimap-self" ref={arrowRef}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 0.8 L10.6 11 L6 8.4 L1.4 11 Z" />
        </svg>
      </div>
      <span className="minimap-north">N</span>
      <span className="minimap-scale">{MINIMAP_RADIUS} m</span>
    </div>
  );
}

/**
 * Draws the minimap every frame from the synced positions and the camera's
 * yaw: crops the plan round the player, turns the self arrow, and paints the
 * hunters the local role may see ({@link minimapBlips}). A moving hunter bobs
 * as it runs and pulses softly; on a prop's radar it fades over the last half
 * of its move window, so it drops off a moment after it stops.
 */
export function MinimapPainter({
  surfaceRef,
  playersRef,
  lookRef,
  localId,
  localRole,
}: {
  surfaceRef: MinimapSurfaceRef;
  playersRef: PlayersRef;
  lookRef: LookRef;
  localId: string;
  localRole: Role;
}) {
  const tracks = useMemo(() => new Map<string, MotionTrack>(), []);

  useGuardedFrame(() => {
    const now = performance.now();
    const players = playersRef.current;
    for (const [id, view] of players) {
      if (view.role === "hunter") tracks.set(id, trackMotion(tracks.get(id), view.x, view.z, now));
      else tracks.delete(id);
    }
    for (const id of tracks.keys()) if (!players.has(id)) tracks.delete(id);

    const surface = surfaceRef.current;
    const self = players.get(localId);
    if (!surface || !self) return;
    const { blipCtx: ctx, plan, scale, size, ratio } = surface;
    const half = size / 2;
    const sx = Math.round((self.x - surface.originX) * scale - half);
    const sy = Math.round((self.z - surface.originZ) * scale - half);
    if (sx !== surface.drawnX || sy !== surface.drawnY) {
      surface.drawnX = sx;
      surface.drawnY = sy;
      surface.planCtx.drawImage(plan, sx, sy, size, size, 0, 0, size, size);
    }

    const blips = minimapBlips(players, localId, localRole, self, tracks, now);
    if (surface.blipsDrawn) ctx.clearRect(0, 0, size, size);
    surface.blipsDrawn = blips.length > 0;
    for (const blip of blips) {
      const at = worldToMinimap(self, blip.x, blip.z, scale);
      const moving = blip.stepAgeMs !== null;
      const age = blip.stepAgeMs ?? 0;
      const fade =
        localRole === "prop" && moving && age > FADE_START_MS
          ? 1 - (age - FADE_START_MS) / (MINIMAP_MOVE_WINDOW_MS - FADE_START_MS)
          : 1;
      const bob = moving ? Math.abs(Math.sin(now * BOB_RATE_RAD_PER_MS)) * BOB_AMPLITUDE_PX : 0;
      const x = half + at.x;
      const y = half + at.y - bob * ratio;
      if (moving) {
        const phase = (now % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
        ctx.globalAlpha = fade * PULSE_ALPHA * (1 - phase);
        ctx.strokeStyle = HUNTER_COLOR;
        ctx.lineWidth = ratio;
        ctx.beginPath();
        ctx.arc(x, y, (BADGE_RADIUS_PX + PULSE_REACH_PX * phase) * ratio, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = fade;
      ctx.fillStyle = HUNTER_COLOR;
      ctx.strokeStyle = HUNTER_INK;
      ctx.lineWidth = BADGE_RIM_PX * ratio;
      ctx.beginPath();
      ctx.arc(x, y, BADGE_RADIUS_PX * ratio, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = HUNTER_INK;
      ctx.beginPath();
      ctx.arc(x, y, BADGE_CORE_PX * ratio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const angle = arrowRotation(lookRef.current.yaw);
    if (!(Math.abs(angle - surface.arrowAngle) < ARROW_EPSILON_RAD)) {
      surface.arrowAngle = angle;
      surface.arrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    }
  });

  return null;
}
