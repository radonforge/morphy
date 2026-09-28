import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildAssetCards } from "./build";

const PUBLIC_DIR = fileURLToPath(new URL("../../packages/client/public/", import.meta.url));
const OUTPUT = fileURLToPath(new URL("../../packages/shared/src/assetCards.json", import.meta.url));

const cards = await buildAssetCards(PUBLIC_DIR);
await writeFile(OUTPUT, `${JSON.stringify(cards, null, 2)}\n`, "utf8");
console.log(`wrote ${Object.keys(cards).length} asset cards`);
