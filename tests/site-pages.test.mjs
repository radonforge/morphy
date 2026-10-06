import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  changelogPage,
  markdownPage,
  parseMarkdown,
  renderChangelog,
  renderInline,
  renderMarkdown,
  SiteMarkdownError,
} from "../packages/client/siteMarkdown.ts";
import { renderSitePages } from "../packages/client/viteSitePages.ts";

const FIXTURES = new URL("./fixtures/site/", import.meta.url);
const CHANGELOG = fileURLToPath(new URL("CHANGELOG.md", FIXTURES));
const CONTENT = fileURLToPath(new URL("content", FIXTURES));
const MISSING_CONTENT = fileURLToPath(new URL("no-such-content", FIXTURES));
const REPO_CHANGELOG = new URL("../CHANGELOG.md", import.meta.url);

test("text and attributes are escaped", () => {
  assert.equal(
    renderMarkdown(`# <b>"Tom" & 'Jerry'</b>`),
    "<h1>&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;</h1>",
  );
  assert.equal(
    renderInline(`[x](https://example.com/?a="b"&c=<d>)`),
    '<a href="https://example.com/?a=&quot;b&quot;&amp;c=&lt;d&gt;">x</a>',
  );
});

test("headings render at their level", () => {
  assert.equal(
    renderMarkdown("# One\n## Two\n### Three"),
    "<h1>One</h1>\n<h2>Two</h2>\n<h3>Three</h3>",
  );
  assert.equal(renderMarkdown("#### Four"), "<p>#### Four</p>");
});

test("consecutive lines join into one paragraph and a blank line splits them", () => {
  assert.equal(renderMarkdown("one\ntwo\n\nthree"), "<p>one two</p>\n<p>three</p>");
});

test("a list item takes its two-space continuation lines", () => {
  assert.deepEqual(parseMarkdown("- first item\n  goes on\n- second\n\n- third\n\nafter"), [
    { kind: "list", items: ["first item goes on", "second", "third"] },
    { kind: "paragraph", text: "after" },
  ]);
  assert.equal(renderMarkdown("- a\n  b"), "<ul><li>a b</li></ul>");
});

test("code spans keep their content literal", () => {
  assert.equal(renderInline("press `**F** <x>`"), "press <code>**F** &lt;x&gt;</code>");
});

test("bold renders and nests inline syntax", () => {
  assert.equal(
    renderInline("**bold `code`** text"),
    "<strong>bold <code>code</code></strong> text",
  );
});

test("https, mailto and site-relative links render", () => {
  assert.equal(
    renderInline("[a](https://radonforge.com)"),
    '<a href="https://radonforge.com">a</a>',
  );
  assert.equal(renderInline("[b](mailto:hi@example.com)"), '<a href="mailto:hi@example.com">b</a>');
  assert.equal(renderInline("[**c**](/privacy)"), '<a href="/privacy"><strong>c</strong></a>');
});

test("any other link target is refused", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "//evil.com",
    "/\\evil.com",
    "privacy",
  ]) {
    assert.throws(() => renderInline(`[x](${url})`), SiteMarkdownError, url);
  }
});

test("link reference definitions are not rendered", () => {
  assert.equal(
    renderMarkdown("text\n\n[0.1.0]: https://example.com/compare/v0.0.1...v0.1.0"),
    "<p>text</p>",
  );
});

test("the changelog shows releases and hides Unreleased", () => {
  const html = renderChangelog(readFileSync(CHANGELOG, { encoding: "utf-8" }));
  assert.doesNotMatch(html, /Unreleased|secret feature|compare/);
  assert.match(
    html,
    /<section class="release" id="v0\.2\.0">\n<h2><span class="version">v0\.2\.0<\/span> <time datetime="2026-09-16">16 September 2026<\/time><\/h2>\n<p class="lead">The hunt gets a sonar\.<\/p>\n<h3 class="group group-added">New<\/h3>/,
  );
  assert.match(html, /<time datetime="2026-07-21">21 July 2026<\/time>/);
});

test("changelog groups take their player-facing labels", () => {
  const html = renderChangelog(
    ["Added", "Changed", "Fixed", "Removed", "Security"]
      .map((group) => `### ${group}\n\n- item`)
      .join("\n\n")
      .replace(/^/, "## [1.0.0] - 2026-01-01\n\n"),
  );
  const labels = [...html.matchAll(/<h3 class="group group-\w+">(\w+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["New", "Changed", "Fixed", "Removed", "Security"]);
});

test("a malformed release heading or date is refused", () => {
  assert.throws(() => renderChangelog("## [1.0.0] 2026-01-01"), SiteMarkdownError);
  assert.throws(() => renderChangelog("## [1.0.0] - 2026-02-30"), SiteMarkdownError);
});

test("a page is named by its heading and described by its first paragraph", () => {
  const page = markdownPage("# Privacy\n\nWe keep **one** id.\n\nMore.");
  assert.equal(page.title, "Privacy");
  assert.equal(page.description, "We keep one id.");
  assert.throws(() => markdownPage("No heading here."), SiteMarkdownError);
});

test("an unreleased paragraph never becomes the changelog description", () => {
  const page = changelogPage(
    "# Changelog\n\n## [Unreleased]\n\nNot out yet.\n\n## [1.0.0] - 2026-01-01\n\nOut now.",
  );
  assert.equal(page.description, "Out now.");
});

test("a group heading outside the five keeps its own text, escaped", () => {
  const html = renderChangelog("## [1.0.0] - 2026-01-01\n\n### constructor <b>");
  assert.match(html, /<h3 class="group">constructor &lt;b&gt;<\/h3>/);
});

test("a long description is cut at a word boundary", () => {
  const page = markdownPage(`# Long\n\n${"word ".repeat(60)}`);
  assert.ok(page.description.length <= 160);
  assert.match(page.description, /word\.\.\.$/);
  assert.match(markdownPage(`# One\n\n${"x".repeat(200)}`).description, /^x{157}\.\.\.$/);
});

test("the repository changelog renders", () => {
  const page = changelogPage(readFileSync(REPO_CHANGELOG, { encoding: "utf-8" }));
  assert.equal(page.title, "Changelog");
  assert.match(page.body, /<section class="release" id="v0\.1\.0">/);
});

test("pages render with their metadata and a nav limited to the pages built", async () => {
  const pages = await renderSitePages({ changelogPath: CHANGELOG, contentDir: CONTENT });
  assert.deepEqual(
    pages.map((page) => page.slug),
    ["changelog", "privacy"],
  );
  const privacy = pages[1].html;
  assert.match(privacy, /<title>Privacy - Morphy<\/title>/);
  assert.match(
    privacy,
    /<link rel="canonical" href="https:\/\/morphy\.radonforge\.com\/privacy" \/>/,
  );
  assert.match(privacy, /<meta property="og:title" content="Privacy - Morphy" \/>/);
  assert.match(
    privacy,
    /<meta name="description" content="Morphy keeps a device id in your browser and nothing else\." \/>/,
  );
  assert.match(
    privacy,
    /<meta property="og:image" content="https:\/\/morphy\.radonforge\.com\/banner\.jpg" \/>/,
  );
  assert.match(privacy, /<a href="\/privacy" aria-current="page">Privacy<\/a>/);
  assert.match(privacy, /<a href="\/changelog">Changelog<\/a>/);
  assert.doesNotMatch(privacy, /\/terms|<script/);
});

test("without a content directory only the changelog is built", async () => {
  const pages = await renderSitePages({ changelogPath: CHANGELOG, contentDir: MISSING_CONTENT });
  assert.deepEqual(
    pages.map((page) => page.slug),
    ["changelog"],
  );
  assert.doesNotMatch(pages[0].html, /\/privacy|\/terms/);
});

test("a content page cannot take a path the site already serves", async (t) => {
  const contentDir = mkdtempSync(join(tmpdir(), "morphy-site-"));
  t.after(() => rmSync(contentDir, { recursive: true, force: true }));
  writeFileSync(join(contentDir, "index.md"), "# Index\n", { encoding: "utf-8" });
  await assert.rejects(
    renderSitePages({ changelogPath: CHANGELOG, contentDir }),
    /\/index is already served/,
  );
});
