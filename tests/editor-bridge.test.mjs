import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { LEVEL_BRIDGE_PATH } from "../packages/client/src/editor/bridgeProtocol.ts";
import { levelBridgeMiddleware, levelSources } from "../packages/client/viteLevelBridge.ts";
import { formatLevelDocument } from "../packages/level/src/index.ts";

const LIMITS = { maxBodyBytes: 64 * 1024, bodyTimeoutMs: 200 };
const LOOPBACK = "127.0.0.1";

let server;
let port;
let dir;
let file;
let original;

before(async () => {
  const committed = levelSources(new URL("../packages/client", import.meta.url).pathname).station;
  dir = await mkdtemp(join(tmpdir(), "morphy-bridge-http-"));
  file = join(dir, "station.level.json");
  await copyFile(committed.file, file);
  original = JSON.parse(await readFile(file, "utf8"));
  const handler = levelBridgeMiddleware(
    { station: { ...committed, file } },
    { written: new Map(), logError: (message) => assert.fail(message) },
    LIMITS,
  );
  server = createServer((req, res) => {
    if (!req.url?.startsWith(LEVEL_BRIDGE_PATH)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    req.url = req.url.slice(LEVEL_BRIDGE_PATH.length);
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, LOOPBACK, resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

/** One request to the test server; `partial` sends headers and part of the body, then stalls. */
function send(method, path, { body, headers = {}, partial = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: LOOPBACK,
        port,
        method,
        path: `${LEVEL_BRIDGE_PATH}${path}`,
        headers: {
          host: `localhost:${port}`,
          ...(body !== undefined ? { "content-length": Buffer.byteLength(body) } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }),
        );
      },
    );
    req.on("error", reject);
    if (body === undefined) req.end();
    else if (partial) req.write(body.slice(0, 1));
    else req.end(body);
  });
}

test("the bridge routes documents and catalogs and 404s anything else", async () => {
  const doc = await send("GET", "/station");
  assert.equal(doc.status, 200);
  assert.deepEqual(doc.body, original);
  const catalog = await send("GET", "/station/catalog");
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.some((def) => def.id === "chair"));
  assert.equal((await send("GET", "/urban")).status, 404);
  assert.equal((await send("GET", "/station/catalog/extra")).status, 404);
  assert.equal((await send("PUT", "/station/catalog", { body: "{}" })).status, 405);
});

test("the bridge refuses a Host that is not this machine, a forwarded request and a foreign Origin", async () => {
  assert.equal((await send("GET", "/station", { headers: { host: "evil.example" } })).status, 403);
  assert.equal(
    (await send("GET", "/station", { headers: { host: `localhost:${port + 1}` } })).status,
    403,
  );
  assert.equal(
    (await send("GET", "/station", { headers: { "x-forwarded-for": "203.0.113.9" } })).status,
    403,
  );
  const body = JSON.stringify(original);
  const foreign = await send("PUT", "/station", {
    body,
    headers: { origin: "http://evil.example" },
  });
  assert.equal(foreign.status, 403);
  const own = await send("PUT", "/station", {
    body,
    headers: { origin: `http://localhost:${port}` },
  });
  assert.equal(own.status, 200);
});

test("the bridge answers 413 over the size cap and 408 when the body stalls", async () => {
  const big = await send("PUT", "/station", { body: "x".repeat(LIMITS.maxBodyBytes + 1) });
  assert.equal(big.status, 413);
  const stalled = await send("PUT", "/station", { body: JSON.stringify(original), partial: true });
  assert.equal(stalled.status, 408);
});

test("the bridge rejects an invalid document with 422 and leaves the file alone", async () => {
  const before = await readFile(file, "utf8");
  const invalid = await send("PUT", "/station", {
    body: JSON.stringify({ ...original, objects: [{ id: "x", type: "sofa", x: 0, z: 0, yaw: 0 }] }),
  });
  assert.equal(invalid.status, 422);
  assert.match(invalid.body.error, /sofa/);
  assert.equal(await readFile(file, "utf8"), before);
});

test("the bridge writes a valid document in the formatter's layout and answers 200", async () => {
  const moved = {
    ...original,
    objects: original.objects.map((object, index) =>
      index === 0 ? { ...object, x: 0, z: 0 } : object,
    ),
  };
  const saved = await send("PUT", "/station", { body: JSON.stringify(moved) });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, moved);
  assert.equal(await readFile(file, "utf8"), formatLevelDocument(moved));
});
