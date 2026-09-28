import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RUNTIME_MODEL_PATHS } from "../../packages/client/runtimeAssets";
import type { AssetCard } from "../../packages/shared/src/assetCards";
import { extractAssetCard } from "./extract";

const EXCLUDED_PREFIXES = ["/models/pets/", "/models/blaster/"];

/** Model paths that get a card: the runtime allow-list minus avatars and weapons. */
export const CARD_MODEL_PATHS: readonly string[] = RUNTIME_MODEL_PATHS.filter(
  (model) => !EXCLUDED_PREFIXES.some((prefix) => model.startsWith(prefix)),
);

/** Extract every card from the GLBs under `publicDir`, keyed by model path in sorted order. */
export async function buildAssetCards(publicDir: string): Promise<Record<string, AssetCard>> {
  const cards: Record<string, AssetCard> = {};
  for (const model of CARD_MODEL_PATHS) {
    const bytes = await readFile(resolve(publicDir, model.replace(/^\//, "")));
    cards[model] = extractAssetCard(bytes, model);
  }
  return cards;
}
