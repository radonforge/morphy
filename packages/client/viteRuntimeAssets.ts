import { readdir, readFile, rm, stat } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { RUNTIME_MODEL_PATHS } from "./runtimeAssets";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const ASSET_ORIGIN = "https://runtime-assets.invalid";

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}

function publicRelative(path: string): string {
  return path.replace(/^\//, "").split("/").join(sep);
}

function externalModelDependencies(bytes: Buffer, model: string): string[] {
  if (
    bytes.readUInt32LE(0) !== GLB_MAGIC ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(16) !== GLB_JSON_CHUNK
  ) {
    throw new Error(`runtime asset is not a supported GLB: ${model}`);
  }
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Record<
    string,
    unknown
  >;
  const entries = [json.buffers, json.images]
    .filter((value): value is unknown[] => Array.isArray(value))
    .flat();
  const dependencies = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const uri = (entry as Record<string, unknown>).uri;
    if (typeof uri !== "string" || uri.startsWith("data:")) continue;
    const url = new URL(uri, `${ASSET_ORIGIN}${model}`);
    if (url.origin !== ASSET_ORIGIN || !url.pathname.startsWith("/models/")) {
      throw new Error(`${model}: external asset URI is outside /models: ${uri}`);
    }
    dependencies.add(decodeURIComponent(posix.normalize(url.pathname)));
  }
  return [...dependencies];
}

/** Resolve all external buffers/images declared by the allow-listed GLBs. */
export async function runtimePublicAssetPaths(publicDir: string): Promise<string[]> {
  const paths = new Set(RUNTIME_MODEL_PATHS);
  for (const model of RUNTIME_MODEL_PATHS) {
    const path = resolve(publicDir, publicRelative(model));
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      throw new Error(`runtime asset is missing: ${model}`, { cause: error });
    }
    for (const dependency of externalModelDependencies(bytes, model)) paths.add(dependency);
  }
  for (const asset of paths) {
    const path = resolve(publicDir, publicRelative(asset));
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error("not a file");
    } catch (error) {
      throw new Error(`runtime asset is missing: ${asset}`, { cause: error });
    }
  }
  return [...paths].sort();
}

/**
 * Vite normally copies the whole public model source pack. Validate the exact
 * runtime model manifest, then prune only non-manifest GLBs from the generated
 * `dist` directory; source/licence files remain untouched in `public`.
 */
export function runtimeAssetsPlugin(): Plugin {
  let config: ResolvedConfig;
  let runtimeAssets: string[] = [];
  return {
    name: "morphy-runtime-assets",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    async buildStart() {
      runtimeAssets = await runtimePublicAssetPaths(config.publicDir);
    },
    async closeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      const modelDir = resolve(outDir, "models");
      const allowed = new Set(runtimeAssets.map(publicRelative));
      for (const path of await filesBelow(modelDir)) {
        const modelPath = relative(outDir, path);
        if (!allowed.has(modelPath)) await rm(path);
      }
      // Finder metadata and unreferenced source-size logos are not production assets.
      await Promise.all([
        rm(resolve(outDir, ".DS_Store"), { force: true }),
        rm(resolve(outDir, "models/.DS_Store"), { force: true }),
        rm(resolve(outDir, "models/urban/.DS_Store"), { force: true }),
        rm(resolve(outDir, "sounds/.DS_Store"), { force: true }),
        rm(resolve(outDir, "logo.png"), { force: true }),
        rm(resolve(outDir, "logo-mark.png"), { force: true }),
      ]);
    },
  };
}
