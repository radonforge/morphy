import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeviceId } from "../packages/client/src/storage.ts";

test("device id generation falls back to getRandomValues on an insecure origin", () => {
  const id = createDeviceId({
    randomUUID() {
      throw new Error("secure context required");
    },
    getRandomValues(bytes) {
      bytes.fill(0);
      return bytes;
    },
  });
  assert.equal(id, "00000000-0000-4000-8000-000000000000");
});
