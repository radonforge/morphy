import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveBuildInfo } from "../packages/client/buildInfo.ts";

const ROOT_MANIFEST = new URL("../package.json", import.meta.url);

test("the client stamps the version a release actually bumps", () => {
  const root = JSON.parse(readFileSync(ROOT_MANIFEST, { encoding: "utf-8" }));
  assert.equal(
    resolveBuildInfo().version,
    root.version,
    "the stamp reads the workspace root, not a package pinned at 0.0.0",
  );
});

test("the build sha is a short sha, or 'dev' outside a checkout", () => {
  const { build } = resolveBuildInfo();
  assert.match(build, /^([0-9a-f]{7}|dev)$/);
});

test("CI's commit sha wins over the local checkout", () => {
  const previous = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = "deadbeefcafebabe0123456789abcdef01234567";
  try {
    assert.equal(resolveBuildInfo().build, "deadbee");
  } finally {
    if (previous === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previous;
  }
});
