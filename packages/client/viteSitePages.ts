import { readdir, readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { changelogPage, markdownPage, type PageContent } from "./siteMarkdown";
import { renderSitePage, type SitePage } from "./sitePage";

const CHANGELOG_SLUG = "changelog";
const CHANGELOG_FROM_ROOT = "../../CHANGELOG.md";
const CONTENT_FROM_ROOT = "content";
const MARKDOWN_EXTENSION = ".md";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const RESERVED_SLUGS = new Set([
  CHANGELOG_SLUG,
  "index",
  "assets",
  "models",
  "sounds",
  "colyseus",
  "stats",
]);

/** Where the site pages are read from. */
export interface SitePageSources {
  changelogPath: string;
  contentDir: string;
}

/** A finished page: its slug and the complete HTML served at `/<slug>`. */
export interface RenderedSitePage {
  slug: string;
  html: string;
}

async function contentFiles(contentDir: string): Promise<string[]> {
  try {
    const entries = await readdir(contentDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && extname(entry.name) === MARKDOWN_EXTENSION)
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readPage(
  path: string,
  slug: string,
  render: (source: string) => PageContent,
): Promise<SitePage> {
  if (!SLUG.test(slug)) {
    throw new Error(`site page ${path}: name it in lowercase letters, digits and dashes`);
  }
  const source = await readFile(path, { encoding: "utf-8" });
  try {
    return { slug, ...render(source) };
  } catch (error) {
    throw new Error(`site page ${path}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * Render the changelog and every `content/*.md` into complete HTML pages. A
 * missing or empty content directory leaves the changelog as the only page.
 */
export async function renderSitePages(sources: SitePageSources): Promise<RenderedSitePage[]> {
  const pages = [await readPage(sources.changelogPath, CHANGELOG_SLUG, changelogPage)];
  for (const file of await contentFiles(sources.contentDir)) {
    const slug = basename(file, MARKDOWN_EXTENSION);
    if (RESERVED_SLUGS.has(slug)) {
      throw new Error(`site page ${file}: /${slug} is already served by the site, rename the file`);
    }
    pages.push(await readPage(resolve(sources.contentDir, file), slug, markdownPage));
  }
  const available = new Set(pages.map((page) => page.slug));
  return pages.map((page) => ({ slug: page.slug, html: renderSitePage(page, available) }));
}

function sourcesFor(config: ResolvedConfig): SitePageSources {
  return {
    changelogPath: resolve(config.root, CHANGELOG_FROM_ROOT),
    contentDir: resolve(config.root, CONTENT_FROM_ROOT),
  };
}

/**
 * Serves the repo's `CHANGELOG.md` at `/changelog` and each
 * `packages/client/content/<slug>.md` at `/<slug>` as static pages with no
 * script. A build emits them as `<slug>.html` beside `index.html`, which nginx
 * finds through `try_files $uri $uri.html`; the dev server renders them afresh
 * on every request, so an edit shows on reload. Runs in Node only: nothing of it
 * reaches the client bundle.
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
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const slug = new URL(req.url ?? "/", "http://dev.invalid").pathname.slice(1);
        if (!SLUG.test(slug)) return next();
        const sources = sourcesFor(config);
        contentFiles(sources.contentDir)
          .then(async (files) => {
            const slugs = files.map((file) => basename(file, MARKDOWN_EXTENSION));
            if (slug !== CHANGELOG_SLUG && !slugs.includes(slug)) return next();
            const pages = await renderSitePages(sources);
            const page = pages.find((candidate) => candidate.slug === slug);
            res.setHeader("Content-Type", HTML_CONTENT_TYPE);
            res.end(req.method === "HEAD" ? undefined : page?.html);
          })
          .catch(next);
      });
    },
  };
}
