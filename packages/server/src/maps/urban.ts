import { compileLevel, parseLevelDocument } from "@morphy/level";
import type { MapDefinition } from "@morphy/shared";
import { URBAN_CATALOG } from "../urbanCatalog";
import urbanLevel from "./urban.level.json" with { type: "json" };

/** The committed North District document, validated once when the server loads the map registry. */
const URBAN_LEVEL = parseLevelDocument(urbanLevel, { catalog: URBAN_CATALOG, id: "urban" });

/**
 * North District: four courtyard blocks turned round a central park, each reached
 * by an avenue that jogs once between the park and a town gate. Buildings, trees
 * and lamps are fixed by the document; the map does not vary with `seed`. Props
 * wait in the park and hunters are released at the four gates.
 */
export function buildUrban(seed: number): MapDefinition {
  return compileLevel(URBAN_LEVEL, { catalog: URBAN_CATALOG, seed });
}
