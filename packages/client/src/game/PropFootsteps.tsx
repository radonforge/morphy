import { FOOTSTEP_HEARING_RADIUS } from "@morphy/shared";
import { useMemo } from "react";
import { playRustle } from "./audio";
import { useGuardedFrame } from "./guardedFrame";
import { advanceStride, type Stride } from "./propRustle";
import { falloff, type ListenerRef, stereoPan } from "./spatialAudio";
import type { PlayersRef } from "./types";

const WALK_LEVEL = 0.6;
const RUN_LEVEL = 1;

/**
 * The rustle a disguise makes on the move, for every remote prop: louder at a
 * run, nothing while it stands still, gone past {@link FOOTSTEP_HEARING_RADIUS},
 * the same radius a bot hears a mover at, so moving is the same risk against a
 * player as against a bot. Driven from the synced positions, never the local
 * player: nobody hears their own disguise.
 */
export function PropFootsteps({
  playersRef,
  localId,
  listenerRef,
}: {
  playersRef: PlayersRef;
  localId: string;
  listenerRef: ListenerRef;
}) {
  const strides = useMemo(() => new Map<string, Stride>(), []);

  useGuardedFrame((_, delta) => {
    const listener = listenerRef.current;
    for (const [id, view] of playersRef.current) {
      if (id === localId || view.role !== "prop" || !view.alive) {
        strides.delete(id);
        continue;
      }
      const { stride, rustle } = advanceStride(strides.get(id), view.x, view.z, delta);
      strides.set(id, stride);
      if (!rustle) continue;
      const level = rustle === "run" ? RUN_LEVEL : WALK_LEVEL;
      const volume = falloff(listener, view.x, view.z, FOOTSTEP_HEARING_RADIUS) * level;
      playRustle(volume, stereoPan(listener, view.x, view.z));
    }
    for (const id of strides.keys()) {
      if (!playersRef.current.has(id)) strides.delete(id);
    }
  });

  return null;
}
