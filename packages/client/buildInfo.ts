import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT_MANIFEST = new URL("../../package.json", import.meta.url);
const SHA_LENGTH = 7;
const UNRELEASED_BUILD = "dev";
const UNRELEASED_SUFFIX = "+";
const TAG_REF_TYPE = "tag";
const TAG_VERSION = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export interface BuildInfo {
  /**
   * The version this build reports: the tag itself on a tagged build, otherwise
   * the last release the build sits past, marked with a trailing `+`.
   */
  version: string;
  /** Short commit sha of the build, or `dev` outside a checkout. */
  build: string;
}

function readTagVersion(): string | null {
  if (process.env.GITHUB_REF_TYPE !== TAG_REF_TYPE) return null;
  const tag = process.env.GITHUB_REF_NAME;
  if (tag === undefined) return null;
  return TAG_VERSION.exec(tag)?.[1] ?? null;
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
 * A tagged build reads its version from the tag, which makes the tag
 * authoritative: a tag pushed without the matching manifest bump stamps the
 * release it claims to be instead of the stale one on disk. Every other build
 * — a `workflow_dispatch` redeploy, CI, a local `pnpm build` — sits *past* a
 * release rather than being it, so it reports the root manifest's version
 * marked with `+`. A flat version there would claim to be the release.
 *
 * The version cannot come from a workspace package: everything under
 * `packages/` is pinned at `0.0.0`, so reading one would stamp a credible lie.
 *
 * The sha comes from `GITHUB_SHA`, which every GitHub Actions job sets and
 * which `deploy-prod.yml` also uses as the server image tag, so one sha names
 * both halves of a deploy. Outside a checkout it degrades to `dev` rather than
 * guessing a commit.
 */
export function resolveBuildInfo(): BuildInfo {
  const tagged = readTagVersion();
  return {
    version: tagged ?? `${readRootVersion()}${UNRELEASED_SUFFIX}`,
    build: readBuildSha(),
  };
}
