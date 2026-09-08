import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT_MANIFEST = new URL("../../package.json", import.meta.url);
const SHA_LENGTH = 7;
const UNRELEASED_BUILD = "dev";

export interface BuildInfo {
  /** The release version, from the workspace root manifest — the only one that carries it. */
  version: string;
  /** Short commit sha of the build, or `dev` outside a checkout. */
  build: string;
}

function readRootVersion(): string {
  const raw: unknown = JSON.parse(readFileSync(ROOT_MANIFEST, { encoding: "utf-8" }));
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`malformed workspace manifest at ${ROOT_MANIFEST.pathname}`);
  }
  const version = (raw as Record<string, unknown>).version;
  if (typeof version !== "string" || version === "") {
    throw new Error(`no "version" in the workspace manifest at ${ROOT_MANIFEST.pathname}`);
  }
  return version;
}

function readBuildSha(): string {
  const fromCi = process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, SHA_LENGTH);
  try {
    return execFileSync("git", ["rev-parse", `--short=${SHA_LENGTH}`, "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return UNRELEASED_BUILD;
  }
}

/**
 * Identify the build being compiled, so a bug report can name it exactly.
 *
 * The version comes from the workspace root manifest because every package under
 * `packages/` is pinned at `0.0.0` — the root is the only one a release bumps.
 * The sha comes from `GITHUB_SHA`, which every GitHub Actions job sets and which
 * `deploy-prod.yml` also uses as the server image tag, so one sha names both
 * halves of a deploy. Version alone would not be enough: production also deploys
 * on `workflow_dispatch`, so the same version can ship from different commits.
 *
 * Outside a checkout the sha degrades to `dev` rather than guessing.
 */
export function resolveBuildInfo(): BuildInfo {
  return { version: readRootVersion(), build: readBuildSha() };
}
