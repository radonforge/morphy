import assert from "node:assert/strict";
import { test } from "node:test";
import {
  storageGet,
  storageKeys,
  storageRemove,
  storageSet,
} from "../packages/client/src/safeStorage.ts";

test("safe storage falls back to memory when persistence is unavailable", () => {
  storageSet("test:key", "value");
  assert.equal(storageGet("test:key"), "value");
  assert.ok(storageKeys().includes("test:key"));
  storageRemove("test:key");
  assert.equal(storageGet("test:key"), null);
});

test("safe storage survives a SecurityError from the browser getter", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  try {
    storageSet("test:blocked", "fallback");
    assert.equal(storageGet("test:blocked"), "fallback");
  } finally {
    storageRemove("test:blocked");
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});
