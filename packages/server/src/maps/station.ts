import { compileLevel, parseLevelDocument } from "@morphy/level";
import type { MapDefinition } from "@morphy/shared";
import { SPACE_CATALOG } from "../spaceCatalog";
import stationLevel from "./station.level.json" with { type: "json" };

/** The committed Kepler-9 document, validated once when the server loads the map registry. */
const STATION_LEVEL = parseLevelDocument(stationLevel, { catalog: SPACE_CATALOG });

/**
 * Kepler-9 Station: six themed compartments around a `+`-shaped corridor, each
 * reachable from the spine, plus a storage to quarters side door as a flanking
 * route. Furniture is fixed by the document; `seed` only varies floor and wall
 * tile variants. Hunters are released along the spine, away from every prop spawn.
 */
export function buildStation(seed: number): MapDefinition {
  return compileLevel(STATION_LEVEL, { catalog: SPACE_CATALOG, seed });
}
