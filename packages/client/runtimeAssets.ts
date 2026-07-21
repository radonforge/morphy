import { AVATAR_CATALOG, WEAPONS } from "@morphy/shared";
import { FLOORPLAN_MODEL_PATHS } from "../server/src/maps/lib";
import { MARS_SCENERY_MODEL_PATHS } from "../server/src/maps/mars";
import { URBAN_SCENERY_MODEL_PATHS } from "../server/src/maps/urban";
import { MARS_CATALOG } from "../server/src/marsCatalog";
import { SPACE_CATALOG } from "../server/src/spaceCatalog";
import { URBAN_CATALOG } from "../server/src/urbanCatalog";
import { LOBBY_DIORAMA_MODEL_PATHS } from "./src/ui/lobbyDioramas";

const catalogModels = [...SPACE_CATALOG, ...MARS_CATALOG, ...URBAN_CATALOG]
  .map((definition) => definition.model)
  .filter((model): model is string => typeof model === "string");

/**
 * Complete production allow-list for GLBs. Each procedural builder exports all
 * alternatives it can emit, so this list does not rely on sampling random seeds.
 */
export const RUNTIME_MODEL_PATHS = [
  ...new Set([
    ...AVATAR_CATALOG.map((avatar) => `/models/pets/animal-${avatar.id}.glb`),
    ...Object.values(WEAPONS).map((weapon) => weapon.model),
    ...catalogModels,
    ...FLOORPLAN_MODEL_PATHS,
    ...MARS_SCENERY_MODEL_PATHS,
    ...URBAN_SCENERY_MODEL_PATHS,
    ...LOBBY_DIORAMA_MODEL_PATHS,
  ]),
].sort();
