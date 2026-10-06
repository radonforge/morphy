/**
 * The markdown subset the site pages are written in, rendered to HTML at build
 * time: `#`/`##`/`###` headings, paragraphs, `-` lists with two-space
 * continuation lines, `**bold**`, `` `code` `` and `[text](url)` links. Every
 * text and attribute is escaped; anything outside the subset renders as text,
 * except an indented `-` line, which is refused because nested lists are not
 * part of it. A link URL ends at the first `)` or whitespace, so it cannot hold
 * either: a URL that needs one must be percent-encoded (`%29`, `%20`).
 */

const RELEASE_HEADING =
  /^\[(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)\] - (\d{4}-\d{2}-\d{2})$/;
const UNRELEASED_HEADING = /^\[?unreleased\]?$/i;
const HEADING = /^#{1,3} (?=\S)/;
const LIST_MARKER = "- ";
const CONTINUATION_INDENT = "  ";
const LINK_REFERENCE = /^\[[^\]]+\]:\s+\S+\s*$/;
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
const SAFE_HREF = /^(https:\/\/\S|mailto:\S|\/(?![/\\]))/;
const DESCRIPTION_MAX_CHARS = 160;
const DEFAULT_DESCRIPTION = "Browser multiplayer prop hunt: morph into objects, then hunt or hide.";
const ELLIPSIS = "...";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const GROUP_LABELS: ReadonlyMap<string, string> = new Map([
  ["Added", "New"],
  ["Changed", "Changed"],
  ["Fixed", "Fixed"],
  ["Removed", "Removed"],
  ["Security", "Security"],
]);
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** One block of a parsed document. */
export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/** What a page template needs from a rendered document. */
export interface PageContent {
  title: string;
  description: string;
  body: string;
}

/** Thrown when a document uses the subset in a way that cannot render safely. */
export class SiteMarkdownError extends Error {
  override name = "SiteMarkdownError";
}

/** Escape text for an HTML text node or a quoted attribute value. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Split a document into blocks; link reference definitions are dropped. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let open: Extract<Block, { kind: "paragraph" | "list" }> | null = null;
  for (const [index, line] of source.replace(/\r\n?/g, "\n").split("\n").entries()) {
    const text = line.trim();
    if (text.startsWith(LIST_MARKER) && !line.startsWith(LIST_MARKER)) {
      throw new SiteMarkdownError(
        `line ${index + 1} "${text}" is an indented list item: nested lists are not supported, start it at the margin`,
      );
    }
    if (text === "") {
      if (open?.kind === "paragraph") open = null;
      continue;
    }
    if (open?.kind === "list" && line.startsWith(CONTINUATION_INDENT)) {
      const last = open.items.length - 1;
      open.items[last] = `${open.items[last]} ${text}`;
      continue;
    }
    if (line.startsWith(LIST_MARKER)) {
      if (open?.kind !== "list") {
        open = { kind: "list", items: [] };
        blocks.push(open);
      }
      open.items.push(line.slice(LIST_MARKER.length).trim());
      continue;
    }
    const hashes = HEADING.exec(line)?.[0];
    if (hashes || LINK_REFERENCE.test(line)) {
      open = null;
      if (hashes) {
        const level = (hashes.length - 1) as 1 | 2 | 3;
        blocks.push({ kind: "heading", level, text: line.slice(hashes.length).trim() });
      }
      continue;
    }
    if (open?.kind === "paragraph") {
      open.text = `${open.text} ${text}`;
    } else {
      open = { kind: "paragraph", text };
      blocks.push(open);
    }
  }
  return blocks;
}

function safeHref(url: string): string {
  if (SAFE_HREF.test(url) && !url.includes("\\")) return url;
  throw new SiteMarkdownError(
    `unsupported link target "${url}": use https:, mailto: or a site-relative path`,
  );
}

/** Render the inline syntax of one block's text to escaped HTML. */
export function renderInline(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    html += escapeHtml(text.slice(last, match.index));
    const [, code, bold, label, url] = match;
    if (code !== undefined) html += `<code>${escapeHtml(code)}</code>`;
    else if (bold !== undefined) html += `<strong>${renderInline(bold)}</strong>`;
    else html += `<a href="${escapeHtml(safeHref(url ?? ""))}">${renderInline(label ?? "")}</a>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

/** The text of a block with its inline syntax removed, for metadata. */
export function plainText(text: string): string {
  return text.replace(INLINE, (_match, code, bold, label) => code ?? plainText(bold ?? label));
}

function renderBlock(block: Block, className?: string): string {
  const attribute = className ? ` class="${className}"` : "";
  switch (block.kind) {
    case "heading":
      return `<h${block.level}${attribute}>${renderInline(block.text)}</h${block.level}>`;
    case "paragraph":
      return `<p${attribute}>${renderInline(block.text)}</p>`;
    case "list":
      return `<ul${attribute}>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
  }
}

/** Render a whole document in the subset to HTML. */
export function renderMarkdown(source: string): string {
  return parseMarkdown(source)
    .map((block) => renderBlock(block))
    .join("\n");
}

/** "2026-09-16" as "16 September 2026", refusing a date that does not exist. */
export function formatReleaseDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, iso.length) !== iso) {
    throw new SiteMarkdownError(`release date ${iso} is not a calendar date`);
  }
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function withoutUnreleased(blocks: readonly Block[]): Block[] {
  let hidden = false;
  return blocks.filter((block) => {
    if (block.kind === "heading" && block.level <= 2) {
      hidden = block.level === 2 && UNRELEASED_HEADING.test(block.text);
    }
    return !hidden;
  });
}

/**
 * Render a Keep a Changelog document: each `## [x.y.z] - YYYY-MM-DD` becomes a
 * release section with its lead paragraphs above its groups, group headings take
 * their player-facing label, and the `[Unreleased]` section (in any case, with or
 * without brackets) is left out. A version listed twice is refused.
 */
export function renderChangelog(source: string): string {
  const html: string[] = [];
  let section: "page" | "release" = "page";
  let inGroup = false;
  const versions = new Set<string>();
  const closeRelease = () => {
    if (section === "release") html.push("</section>");
  };
  for (const block of withoutUnreleased(parseMarkdown(source))) {
    if (block.kind === "heading" && block.level <= 2) {
      closeRelease();
      section = "page";
      const release = block.level === 2 ? RELEASE_HEADING.exec(block.text) : null;
      if (release) {
        const [, version = "", iso = ""] = release;
        if (versions.has(version)) {
          throw new SiteMarkdownError(`release ${version} is listed twice: merge the two sections`);
        }
        versions.add(version);
        section = "release";
        inGroup = false;
        html.push(
          `<section class="release" id="v${escapeHtml(version)}">`,
          `<h2><span class="version">v${escapeHtml(version)}</span> <time datetime="${iso}">${formatReleaseDate(iso)}</time></h2>`,
        );
        continue;
      }
      if (block.level === 2 && block.text.startsWith("[")) {
        throw new SiteMarkdownError(
          `malformed release heading "## ${block.text}": write "## [x.y.z] - YYYY-MM-DD" or "## [Unreleased]"`,
        );
      }
      html.push(renderBlock(block));
      continue;
    }
    if (section === "release" && block.kind === "heading") {
      inGroup = true;
      const label = GROUP_LABELS.get(block.text);
      html.push(
        label
          ? `<h3 class="group group-${block.text.toLowerCase()}">${label}</h3>`
          : renderBlock(block, "group"),
      );
      continue;
    }
    html.push(renderBlock(block, section === "release" && !inGroup ? "lead" : undefined));
  }
  closeRelease();
  return html.join("\n");
}

function describe(blocks: readonly Block[]): string {
  const first = blocks.find((block) => block.kind === "paragraph");
  if (!first) return DEFAULT_DESCRIPTION;
  const characters = Array.from(plainText(first.text));
  if (characters.length <= DESCRIPTION_MAX_CHARS) return characters.join("");
  const cut = characters.slice(0, DESCRIPTION_MAX_CHARS - ELLIPSIS.length).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}${ELLIPSIS}`;
}

function pageContent(blocks: readonly Block[], body: string): PageContent {
  const heading = blocks.find((block) => block.kind === "heading" && block.level === 1);
  if (heading?.kind !== "heading") {
    throw new SiteMarkdownError('the page has no "# Title" heading to name it by');
  }
  return { title: plainText(heading.text), description: describe(blocks), body };
}

/**
 * A plain page: its `#` heading names it, its first paragraph describes it (the
 * game's own description when it has none).
 */
export function markdownPage(source: string): PageContent {
  return pageContent(parseMarkdown(source), renderMarkdown(source));
}

/** The changelog page, named and described the same way as a plain page. */
export function changelogPage(source: string): PageContent {
  return pageContent(withoutUnreleased(parseMarkdown(source)), renderChangelog(source));
}
