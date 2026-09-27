import type { MapDefinition, MapId } from "@morphy/shared";
import { buildStation } from "./station";
import { buildUrban } from "./urban";

/**
 * One builder per selectable map. The `Record<MapId, …>` type makes `typecheck`
 * fail if a catalog id has no builder (or a builder no catalog entry), so the
 * registry can never drift out of sync with {@link MAP_CATALOG}.
 */
export const MAP_BUILDERS: Record<MapId, (seed: number) => MapDefinition> = {
  station: buildStation,
  urban: buildUrban,
};

export function buildMap(id: MapId, seed: number): MapDefinition {
  return MAP_BUILDERS[id](seed);
}
