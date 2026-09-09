import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveBuildInfo } from "../packages/client/buildInfo.ts";

const ROOT_MANIFEST = new URL("../package.json", import.meta.url);

function rootVersion() {
  return JSON.parse(readFileSync(ROOT_MANIFEST, { encoding: "utf-8" })).version;
}

function withEnv(vars, run) {
  const previous = Object.keys(vars).map((key) => [key, process.env[key]]);
  const apply = (entries) => {
    for (const [key, value] of entries) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(Object.entries(vars));
  try {
    run();
  } finally {
    apply(previous);
  }
}

test("a tagged build takes its version from the tag, not the manifest", () => {
  withEnv({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v9.9.9" }, () => {
    assert.equal(resolveBuildInfo().version, "9.9.9");
  });
  withEnv({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v9.9.9-rc.1" }, () => {
    assert.equal(resolveBuildInfo().version, "9.9.9-rc.1");
  });
});

test("an untagged build reports the release it sits past, marked", () => {
  withEnv({ GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "master" }, () => {
    assert.equal(
      resolveBuildInfo().version,
      `${rootVersion()}+`,
      "the stamp reads the workspace root, not a package pinned at 0.0.0",
    );
  });
});

test("a tag that is not a version does not become one", () => {
  withEnv({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "nightly" }, () => {
    assert.equal(resolveBuildInfo().version, `${rootVersion()}+`);
  });
});

test("the build sha is a short sha, or 'dev' outside a checkout", () => {
  assert.match(resolveBuildInfo().build, /^([0-9a-f]{7}|dev)$/);
});

test("CI's commit sha wins over the local checkout", () => {
  withEnv({ GITHUB_SHA: "deadbeefcafebabe0123456789abcdef01234567" }, () => {
    assert.equal(resolveBuildInfo().build, "deadbee");
  });
});
