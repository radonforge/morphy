import { MAP_CATALOG, type MapInfo } from "@morphy/shared";
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { playUiHover } from "../game/audio";
import { usePlayerCounts } from "../net/usePlayerCounts";
import {
  clipPath,
  isMoving,
  layoutAt,
  moveTo,
  SLICE_OPEN_S,
  sliceShape,
  WORLD_IDS,
  type WorldsMotion,
  worldsLayout,
} from "./worldSlices";

const SLICE_OPEN_MS = SLICE_OPEN_S * 1000;
const HOST_PICKS = "Host picks the map";

/** How the lobby says how many people are on a map, or null when nobody is. */
function playingLabel(players: number | undefined): string | null {
  return players === undefined || players <= 0 ? null : `${players} playing`;
}

/** A map's tag as the lobby shows it: a day/night map also says which one this visit drew. */
export function mapTag(info: MapInfo, night: boolean): string {
  return info.dayNight ? `${info.tag} · ${night ? "Night" : "Day"}` : info.tag;
}

/**
 * The menu's half of the worlds: one clipped, labelled button per closed map over the stage that
 * draws them; the open map's only control is its Play. A party guest's closed slices stay
 * focusable but say the host picks the map instead of opening it. Each slice also says how many
 * people are playing its map, when anyone is. It owns `motion`, the one record of where the
 * slices are going, and the stage reads the same record, so the clip paths here and the viewports there follow one curve. Positions are
 * written straight to the elements every animation frame of a move rather than through React,
 * which re-renders only when the open slice or the chrome changes.
 */
export function MapSlices({
  open,
  focus,
  motion,
  night,
  canChoose,
  reduced,
  onOpen,
  children,
}: {
  open: number;
  focus: boolean;
  motion: RefObject<WorldsMotion>;
  night: boolean;
  canChoose: boolean;
  reduced: boolean;
  onOpen: (index: number) => void;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const slices = useRef<(HTMLDivElement | null)[]>([]);
  const players = usePlayerCounts();

  useLayoutEffect(() => {
    const node = container.current;
    if (node === null) return;
    const now = performance.now();
    motion.current = moveTo(
      motion.current,
      worldsLayout(WORLD_IDS.length, open, focus),
      now,
      reduced ? 0 : SLICE_OPEN_MS,
    );
    let handle = 0;
    const apply = () => {
      const at = performance.now();
      const layout = layoutAt(motion.current, at);
      const width = node.clientWidth;
      const height = node.clientHeight;
      slices.current.forEach((slice, index) => {
        if (slice === null) return;
        const shape = sliceShape(layout, index, width, height);
        slice.style.clipPath = clipPath(shape.polygon);
        slice.style.setProperty("--slice-x", `${Math.max(0, shape.polygon[3][0])}px`);
      });
      handle = isMoving(motion.current, at) ? requestAnimationFrame(apply) : 0;
    };
    apply();
    const resize = new ResizeObserver(() => {
      if (handle === 0) apply();
    });
    resize.observe(node);
    return () => {
      cancelAnimationFrame(handle);
      resize.disconnect();
    };
  }, [motion, open, focus, reduced]);

  return (
    <div className={`worlds${focus ? " worlds-focus" : ""}`} ref={container} inert={focus}>
      {MAP_CATALOG.map((info, index) => {
        const isOpen = index === open;
        const tag = mapTag(info, night);
        const playing = playingLabel(players.get(info.id));
        const name = playing ? `${info.name}, ${playing}` : info.name;
        return (
          <div
            key={info.id}
            className={`world-slice${isOpen ? " open" : ""}`}
            ref={(node) => {
              slices.current[index] = node;
            }}
          >
            {!isOpen && (
              <button
                type="button"
                className="world-slice-hit"
                aria-label={canChoose ? `Open ${name}` : `${name}: ${HOST_PICKS}`}
                aria-disabled={!canChoose}
                onClick={() => {
                  if (canChoose) onOpen(index);
                }}
                onPointerEnter={canChoose ? playUiHover : undefined}
              />
            )}
            <span className="world-slice-v" aria-hidden="true">
              {info.name}
              <small>{tag}</small>
              {playing && <small className="world-slice-players">{playing}</small>}
              {!canChoose && <small className="world-slice-lock">{HOST_PICKS}</small>}
            </span>
            {isOpen && (
              <div className="world-slice-open">
                <span className="world-slice-tag">
                  {tag}
                  {playing && <span className="world-slice-players">{playing}</span>}
                </span>
                <h2 className="world-slice-name">{info.name}</h2>
                {children}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
