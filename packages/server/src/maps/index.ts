import {
  disguiseTypes,
  type MapDefinition,
  type MapId,
  MapValidationError,
  MIN_DISGUISE_TYPES,
} from "@morphy/shared";
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

/**
 * Build map `id`, refusing one that places fewer than {@link MIN_DISGUISE_TYPES}
 * disguises: a prop is dealt and rerolls only into shapes the map places, and a
 * reroll needs one other than the shape it wears.
 */
export function buildMap(id: MapId, seed: number): MapDefinition {
  const map = MAP_BUILDERS[id](seed);
  const types = disguiseTypes(map);
  if (types.length < MIN_DISGUISE_TYPES) {
    throw new MapValidationError(
      id,
      `it places ${types.length} disguise types (${types.join(", ") || "none"}), fewer than ${MIN_DISGUISE_TYPES}; place objects of another catalog type that is not decor`,
    );
  }
  return map;
}
