import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { isMapId, type MapId, type PropDefinition } from "@morphy/shared";
import type { Plugin, ViteDevServer } from "vite";
import { formatLevelDocument, type LevelDocument, parseLevelDocument } from "../level/src";
import { SPACE_CATALOG } from "../server/src/spaceCatalog";
import { URBAN_CATALOG } from "../server/src/urbanCatalog";
import {
  type BridgeError,
  LEVEL_BRIDGE_PATH,
  LEVEL_CATALOG_SEGMENT,
  LEVEL_CHANGED_EVENT,
  type LevelChangedPayload,
} from "./src/editor/bridgeProtocol";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_LARGE = 413;
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVER_ERROR = 500;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const FORWARDING_HEADERS = ["x-forwarded-for", "forwarded", "x-real-ip"];
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HTTP_DEFAULT_PORT = "80";

/** Limits on a request body, named so a test can shrink them. */
export interface BridgeLimits {
  maxBodyBytes: number;
  bodyTimeoutMs: number;
}

/** A document is well under a megabyte; the cap only stops a runaway or hostile body. */
export const BRIDGE_LIMITS: BridgeLimits = {
  maxBodyBytes: 4 * 1024 * 1024,
  bodyTimeoutMs: 10_000,
};

/** A map authored as a level document: the file it lives in and the catalog its objects come from. */
export interface LevelSource {
  id: MapId;
  file: string;
  catalog: readonly PropDefinition[];
}

/** Every editable document, keyed by map id. Paths resolve against the client package root. */
export function levelSources(clientRoot: string): Partial<Record<MapId, LevelSource>> {
  return {
    station: {
      id: "station",
      file: resolve(clientRoot, "../server/src/maps/station.level.json"),
      catalog: SPACE_CATALOG,
    },
    urban: {
      id: "urban",
      file: resolve(clientRoot, "../server/src/maps/urban.level.json"),
      catalog: URBAN_CATALOG,
    },
  };
}

/** A request body the bridge refused, with the status to answer and a message the editor shows. */
export class LevelWriteError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LevelWriteError";
    this.status = status;
  }
}

/**
 * Validate a document sent to the bridge: it must be JSON and pass
 * `parseLevelDocument` for this map and catalog. Throws {@link LevelWriteError}
 * naming what is wrong, so nothing invalid ever reaches the file.
 */
export function acceptLevelText(text: string, source: LevelSource): LevelDocument {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LevelWriteError(HTTP_BAD_REQUEST, `the body is not JSON: ${detail}`);
  }
  try {
    return parseLevelDocument(input, { catalog: source.catalog, id: source.id });
  } catch (error) {
    throw new LevelWriteError(
      HTTP_UNPROCESSABLE,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Write a document's text to a temporary file beside the target, then rename it
 * over the target, so a reader (the game server's watcher, a tool) never sees
 * half a file.
 */
export async function writeLevelFile(file: string, text: string): Promise<void> {
  const temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { encoding: "utf8" });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** The request's `Host` if it names this machine on the port the request arrived on, else null. */
function loopbackHost(req: IncomingMessage): string | null {
  const host = req.headers.host;
  if (host === undefined) return null;
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return null;
  }
  const port = url.port || HTTP_DEFAULT_PORT;
  return LOOPBACK_HOSTNAMES.has(url.hostname) && port === String(req.socket.localPort)
    ? host
    : null;
}

/**
 * Whether a request comes from this machine and was not relayed: from a loopback
 * address, with no forwarding header, and addressed by a `Host` that is localhost
 * or a loopback IP on the dev port. The dev server listens on the LAN
 * (`server.host`) and `pnpm tunnel` exposes it through ngrok, whose agent connects
 * from loopback but adds a forwarding header; a page on another site that reaches
 * localhost through DNS rebinding carries its own name in `Host`. A write must also
 * come from the dev origin itself when the browser says where it comes from. The
 * bridge writes into the repo, so only a local page may use it.
 */
export function isLocalRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress;
  if (address === undefined || !LOOPBACK_ADDRESSES.has(address)) return false;
  if (FORWARDING_HEADERS.some((name) => req.headers[name] !== undefined)) return false;
  const host = loopbackHost(req);
  if (host === null) return false;
  const origin = req.headers.origin;
  return req.method !== "PUT" || origin === undefined || origin === `http://${host}`;
}

/** Read a body up to `limits.maxBodyBytes`, failing with 408 when it takes longer than `limits.bodyTimeoutMs`. */
function readBody(req: IncomingMessage, limits: BridgeLimits): Promise<string> {
  const tooLarge = new LevelWriteError(
    HTTP_TOO_LARGE,
    `the body exceeds ${limits.maxBodyBytes} bytes`,
  );
  if (Number(req.headers["content-length"] ?? 0) > limits.maxBodyBytes) {
    return Promise.reject(tooLarge);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      finish();
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limits.maxBodyBytes) settle(() => reject(tooLarge));
      else chunks.push(chunk);
    };
    const onEnd = () => settle(() => resolve(Buffer.concat(chunks).toString("utf8")));
    const onError = (error: Error) => settle(() => reject(error));
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new LevelWriteError(
              HTTP_REQUEST_TIMEOUT,
              `the body did not arrive within ${limits.bodyTimeoutMs} ms`,
            ),
          ),
        ),
      limits.bodyTimeoutMs,
    );
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/** Statuses after which the rest of the request body is abandoned, so the connection closes. */
const ABANDONED_BODY_STATUSES = new Set([HTTP_REQUEST_TIMEOUT, HTTP_TOO_LARGE]);

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function refuse(res: ServerResponse, status: number, error: string): void {
  reply(res, status, { error } satisfies BridgeError);
}

/** What the bridge middleware needs from its host: where to log, and the texts it wrote itself. */
export interface BridgeHost {
  written: Map<string, string>;
  logError: (message: string) => void;
}

/**
 * The bridge's request handler, relative to its mount point: `GET` and `PUT`
 * `/<mapId>` read and write a document, `GET /<mapId>/catalog` its catalog.
 * Exported apart from the plugin so it can be served by a plain `node:http`
 * server in a test.
 */
export function levelBridgeMiddleware(
  sources: Partial<Record<MapId, LevelSource>>,
  host: BridgeHost,
  limits: BridgeLimits = BRIDGE_LIMITS,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (!isLocalRequest(req)) {
      refuse(res, HTTP_FORBIDDEN, "the level bridge only answers a page served by this machine");
      return;
    }
    const [, rawId, segment, extra] = (req.url ?? "").split("?")[0]!.split("/");
    const source = isMapId(rawId) ? sources[rawId] : undefined;
    if (!source || extra !== undefined || (segment && segment !== LEVEL_CATALOG_SEGMENT)) {
      refuse(res, HTTP_NOT_FOUND, `no level document at ${req.url ?? ""}`);
      return;
    }
    if (segment === LEVEL_CATALOG_SEGMENT) {
      if (req.method !== "GET") {
        refuse(res, HTTP_METHOD_NOT_ALLOWED, "the catalog is read-only");
        return;
      }
      reply(res, HTTP_OK, source.catalog);
      return;
    }
    const handle = async () => {
      if (req.method === "GET") {
        const text = await readFile(source.file, { encoding: "utf8" });
        reply(res, HTTP_OK, acceptLevelText(text, source));
        return;
      }
      if (req.method !== "PUT") {
        refuse(res, HTTP_METHOD_NOT_ALLOWED, "use GET or PUT");
        return;
      }
      const doc = acceptLevelText(await readBody(req, limits), source);
      const text = formatLevelDocument(doc);
      host.written.set(source.file, text);
      try {
        await writeLevelFile(source.file, text);
      } catch (error) {
        host.written.delete(source.file);
        throw error;
      }
      reply(res, HTTP_OK, doc);
    };
    handle().catch((error: unknown) => {
      if (error instanceof LevelWriteError) {
        if (ABANDONED_BODY_STATUSES.has(error.status)) res.setHeader("connection", "close");
        refuse(res, error.status, error.message);
        return;
      }
      host.logError(`[level-bridge] ${source.id}: ${String(error)}`);
      refuse(res, HTTP_SERVER_ERROR, `the bridge failed on ${source.id}: ${String(error)}`);
    });
  };
}

/**
 * Dev-only bridge between the map editor page and the level documents in the
 * repo. Serves each document and its catalog, validates and atomically writes a
 * `PUT`, and pushes a {@link LEVEL_CHANGED_EVENT} over Vite's HMR socket when a
 * document changes on disk from outside the page (an agent, the CLI, a git
 * checkout), so the editor shows it live. The page's own writes are recognised
 * by their text and not echoed back. The catalogs are read once, when Vite starts.
 */
export function levelBridgePlugin(): Plugin {
  return {
    name: "morphy-level-bridge",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      const sources = levelSources(server.config.root);
      const written = new Map<string, string>();
      server.middlewares.use(
        LEVEL_BRIDGE_PATH,
        levelBridgeMiddleware(sources, {
          written,
          logError: (message) => server.config.logger.error(message),
        }),
      );

      const byFile = new Map(Object.values(sources).map((source) => [source.file, source]));
      server.watcher.add([...byFile.keys()]);
      const onFileChange = (file: string) => {
        const source = byFile.get(file);
        if (!source) return;
        readFile(file, { encoding: "utf8" })
          .then((text) => {
            const echo = written.get(file) === text;
            written.delete(file);
            if (echo) return;
            let payload: LevelChangedPayload;
            try {
              payload = { id: source.id, document: acceptLevelText(text, source) };
            } catch (error) {
              payload = { id: source.id, error: (error as Error).message };
            }
            server.ws.send(LEVEL_CHANGED_EVENT, payload);
          })
          .catch((error: unknown) => {
            server.config.logger.error(`[level-bridge] reading ${file}: ${String(error)}`);
          });
      };
      server.watcher.on("change", onFileChange);
      server.watcher.on("add", onFileChange);
    },
  };
}
