import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { COLYSEUS_PROXY_PATH, STATS_PATH } from "../shared/src/constants";
import { changelogPage, markdownPage, type PageContent } from "./siteMarkdown";
import { renderSitePage } from "./sitePage";

const CHANGELOG_SLUG = "changelog";
const INDEX_SLUG = "index";
const CHANGELOG_FROM_ROOT = "../../CHANGELOG.md";
const CONTENT_FROM_ROOT = "content";
const MARKDOWN_EXTENSION = ".md";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const DEV_ROOTS = ["src", "node_modules", "public", "content", "assets"];
const SERVER_PATHS = [COLYSEUS_PROXY_PATH, STATS_PATH];
const DEV_URL_BASE = "http://dev.invalid";
const SERVED_METHODS = new Set(["GET", "HEAD"]);
const HEAD_METHOD = "HEAD";

/** Where the site pages are read from, and the public dir whose names they must not take. */
export interface SitePageSources {
  changelogPath: string;
  contentDir: string;
  publicDir: string;
}

/** A finished page: its slug and the complete HTML served at `/<slug>`. */
export interface RenderedSitePage {
  slug: string;
  html: string;
}

interface PageSource {
  slug: string;
  path: string;
  render: (source: string) => PageContent;
}

async function entriesOf(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function reservedSlugs(publicDir: string): Promise<Set<string>> {
  const publicNames = (await entriesOf(publicDir)).map((entry) =>
    basename(entry.name, extname(entry.name)),
  );
  return new Set([
    CHANGELOG_SLUG,
    INDEX_SLUG,
    ...SERVER_PATHS.map((path) => path.slice(1)),
    ...DEV_ROOTS,
    ...publicNames,
  ]);
}

async function pageSources(sources: SitePageSources): Promise<PageSource[]> {
  const reserved = await reservedSlugs(sources.publicDir);
  const pages: PageSource[] = [
    { slug: CHANGELOG_SLUG, path: sources.changelogPath, render: changelogPage },
  ];
  const files = (await entriesOf(sources.contentDir))
    .filter((entry) => entry.isFile() && extname(entry.name) === MARKDOWN_EXTENSION)
    .map((entry) => entry.name)
    .sort();
  for (const file of files) {
    const slug = basename(file, MARKDOWN_EXTENSION);
    const path = resolve(sources.contentDir, file);
    if (!SLUG.test(slug)) {
      throw new Error(`site page ${path}: name it in lowercase letters, digits and dashes`);
    }
    if (reserved.has(slug)) {
      throw new Error(`site page ${path}: /${slug} is already served by the site, rename the file`);
    }
    pages.push({ slug, path, render: markdownPage });
  }
  return pages;
}

async function renderPage(
  page: PageSource,
  available: ReadonlySet<string>,
): Promise<RenderedSitePage> {
  const source = await readFile(page.path, { encoding: "utf-8" });
  try {
    return {
      slug: page.slug,
      html: renderSitePage({ slug: page.slug, ...page.render(source) }, available),
    };
  } catch (error) {
    throw new Error(`site page ${page.path}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * Render the changelog and every `content/*.md` into complete HTML pages. A
 * missing or empty content directory leaves the changelog as the only page.
 */
export async function renderSitePages(sources: SitePageSources): Promise<RenderedSitePage[]> {
  const pages = await pageSources(sources);
  const available = new Set(pages.map((page) => page.slug));
  return Promise.all(pages.map((page) => renderPage(page, available)));
}

function sourcesFor(config: ResolvedConfig): SitePageSources {
  return {
    changelogPath: resolve(config.root, CHANGELOG_FROM_ROOT),
    contentDir: resolve(config.root, CONTENT_FROM_ROOT),
    publicDir: config.publicDir,
  };
}

/**
 * Serves the repo's `CHANGELOG.md` at `/changelog` and each
 * `packages/client/content/<slug>.md` at `/<slug>` as static pages with no
 * script. A build emits them as `<slug>.html` beside `index.html`, which nginx
 * serves for `/<slug>`; the dev server renders the requested page afresh on
 * every request, so an edit shows on reload and a broken page breaks only
 * itself. Runs in Node only: nothing of it reaches the client bundle.
 */
export function sitePagesPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "morphy-site-pages",
    configResolved(resolved) {
      config = resolved;
    },
    async generateBundle() {
      for (const page of await renderSitePages(sourcesFor(config))) {
        this.emitFile({ type: "asset", fileName: `${page.slug}.html`, source: page.html });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!SERVED_METHODS.has(req.method ?? "")) return next();
        const slug = new URL(req.url ?? "/", DEV_URL_BASE).pathname.slice(1);
        if (!SLUG.test(slug)) return next();
        pageSources(sourcesFor(config))
          .then(async (pages) => {
            const page = pages.find((candidate) => candidate.slug === slug);
            if (!page) return next();
            const rendered = await renderPage(
              page,
              new Set(pages.map((candidate) => candidate.slug)),
            );
            res.setHeader("Content-Type", HTML_CONTENT_TYPE);
            res.end(req.method === HEAD_METHOD ? undefined : rendered.html);
          })
          .catch(next);
      });
    },
  };
}
