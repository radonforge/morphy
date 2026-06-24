import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMapDefinition, type MapDefinition } from "@webhunt/shared";

const MAPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "maps");

/**
 * Read and validate a map definition from the repo `maps/` directory.
 * Propagates fs errors (with path) and {@link MapValidationError} on malformed JSON.
 */
export function loadMap(id: string): MapDefinition {
  const path = join(MAPS_DIR, `${id}.json`);
  const raw = readFileSync(path, "utf-8");
  return parseMapDefinition(JSON.parse(raw));
}
