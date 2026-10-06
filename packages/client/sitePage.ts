import { escapeHtml, type PageContent } from "./siteMarkdown";

const SITE_ORIGIN = "https://morphy.radonforge.com";
const SITE_NAME = "Morphy";
const STUDIO_NAME = "Radon Forge";
const STUDIO_URL = "https://radonforge.com";
const SHARE_IMAGE = `${SITE_ORIGIN}/banner.jpg`;
const SHARE_IMAGE_WIDTH = 1600;
const SHARE_IMAGE_HEIGHT = 800;
const SHARE_IMAGE_ALT =
  "A fox morphing into a barrel while an armed hunter closes in on a space station.";
const THEME_COLOR = "#070b14";
const NAV_LINKS: readonly { label: string; slug: string | null }[] = [
  { label: "Play", slug: null },
  { label: "Changelog", slug: "changelog" },
  { label: "Privacy", slug: "privacy" },
  { label: "Terms", slug: "terms" },
];

const STYLE = `
:root {
  --bg: #070b14;
  --surface: rgba(12, 20, 34, 0.62);
  --border: rgba(53, 224, 255, 0.22);
  --cyan: #35e0ff;
  --amber: #ffb24a;
  --rust: #ff7a45;
  --steel: #9fb0d8;
  --danger: #ff5b5b;
  --success: #4ce8a0;
  --text: #dbe7f2;
  --muted: rgba(219, 231, 242, 0.62);
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, monospace;
  --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: dark;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background: var(--bg); }
body {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: var(--text);
  font: 1rem/1.65 var(--font-sans);
  background:
    radial-gradient(90% 60% at 50% -10%, rgba(53, 224, 255, 0.12), transparent 70%),
    var(--bg);
}
a { color: var(--cyan); text-underline-offset: 0.2em; }
a:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; border-radius: 4px; }
.site-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  width: min(100%, 68ch + 32px);
  margin: 0 auto;
  padding: 24px 16px;
}
.wordmark {
  display: flex;
  align-items: center;
  gap: 0.4em;
  color: var(--text);
  font: 800 1.05rem var(--font-mono);
  letter-spacing: 0.02em;
  text-decoration: none;
}
.wordmark img { width: 1.5em; height: 1.5em; }
.site-nav { display: flex; flex-wrap: wrap; gap: 6px 20px; }
.site-nav a {
  padding: 4px 0;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font: 800 0.75rem var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-decoration: none;
}
.site-nav a:hover { color: var(--text); }
.site-nav a[aria-current="page"] { color: var(--cyan); border-bottom-color: var(--cyan); }
main {
  flex: 1;
  width: min(100%, 68ch + 32px);
  margin: 0 auto;
  padding: 16px 16px 64px;
  overflow-wrap: break-word;
}
h1, h2, h3 { font-family: var(--font-mono); line-height: 1.25; }
h1 { margin-bottom: 0.6em; font-size: clamp(1.8rem, 6vw, 2.4rem); font-weight: 800; letter-spacing: -0.01em; }
h2 { margin: 2em 0 0.6em; font-size: 1.3rem; }
h3 { margin: 1.6em 0 0.5em; font-size: 1rem; }
p, ul { margin-bottom: 1em; }
ul { padding-left: 1.25em; }
li { margin-bottom: 0.45em; }
li::marker { color: var(--cyan); }
strong { color: #fff; }
code {
  padding: 0.1em 0.35em;
  border-radius: 6px;
  background: rgba(53, 224, 255, 0.08);
  font: 0.88em var(--font-mono);
}
.release { margin-top: 2.5em; padding-top: 1.5em; border-top: 1px solid var(--border); }
.release h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin-top: 0; }
.release .version { color: var(--cyan); font-size: 1.5rem; font-weight: 800; }
.release time { color: var(--muted); font-size: 0.85rem; font-weight: 600; }
.lead { color: #fff; font-size: 1.05rem; }
.group {
  display: inline-block;
  padding: 2px 10px;
  border: 1px solid currentColor;
  border-radius: 999px;
  color: var(--steel);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.group-added { color: var(--success); }
.group-fixed { color: var(--amber); }
.group-removed { color: var(--rust); }
.group-security { color: var(--danger); }
.site-footer {
  width: min(100%, 68ch + 32px);
  margin: 0 auto;
  padding: 24px 16px 32px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font: 0.8rem var(--font-mono);
}
.site-footer a { color: inherit; }
`;

/** A rendered page and where it is served. */
export interface SitePage extends PageContent {
  slug: string;
}

function navigation(current: string, available: ReadonlySet<string>): string {
  return NAV_LINKS.filter((link) => link.slug === null || available.has(link.slug))
    .map((link) => {
      const href = link.slug === null ? "/" : `/${link.slug}`;
      const currentPage = link.slug === current ? ' aria-current="page"' : "";
      return `<a href="${href}"${currentPage}>${link.label}</a>`;
    })
    .join("");
}

/**
 * The complete HTML of a static site page: Morphy's header, footer and look,
 * with no script, so it reads the same with JavaScript disabled. `available`
 * holds the slugs this build renders, and only those get a nav link.
 */
export function renderSitePage(page: SitePage, available: ReadonlySet<string>): string {
  const title = escapeHtml(`${page.title} - ${SITE_NAME}`);
  const description = escapeHtml(page.description);
  const url = `${SITE_ORIGIN}/${page.slug}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<meta name="description" content="${description}" />
<meta name="author" content="${STUDIO_NAME}" />
<link rel="canonical" href="${url}" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="theme-color" content="${THEME_COLOR}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${STUDIO_NAME}" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${SHARE_IMAGE}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="${SHARE_IMAGE_WIDTH}" />
<meta property="og:image:height" content="${SHARE_IMAGE_HEIGHT}" />
<meta property="og:image:alt" content="${SHARE_IMAGE_ALT}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image:alt" content="${SHARE_IMAGE_ALT}" />
<style>${STYLE}</style>
</head>
<body>
<header class="site-header">
<a class="wordmark" href="/"><img src="/icon-192.png" alt="" width="192" height="192" /><span>MORPHY</span></a>
<nav class="site-nav" aria-label="Site">${navigation(page.slug, available)}</nav>
</header>
<main>
${page.body}
</main>
<footer class="site-footer"><a href="${STUDIO_URL}">© ${STUDIO_NAME}</a></footer>
</body>
</html>
`;
}
