import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGES = [
  ["index", "index.html"],
  ["arena", "arena.html"],
  ["app", "app.html"],
  ["news", "news.html"],
  ["status", "status.html"],
  ["dashboard", "dashboard.html"],
] as const;

const CANONICAL_LINKS = [
  ["index.html", "Home"],
  ["arena.html", "Cockpit"],
  ["app.html", "Assistant"],
  ["news.html", "News"],
  ["status.html", "Status"],
  ["dashboard.html", "Replay"],
] as const;

function readPage(name: string): string {
  return readFileSync(resolve(process.cwd(), "public", `${name}.html`), "utf8");
}

function desktopLinks(html: string): [string, string][] {
  const nav = html.match(/<nav class="gg-links"[\s\S]*?<\/nav>/)?.[0] ?? "";
  return [
    ...nav.matchAll(
      /<a class="gg-nav-link" href="([^"]+)"[^>]*>([^<]+)<\/a\s*>/g,
    ),
  ].map((match) => [match[1], match[2].trim()]);
}

describe("public navigation", () => {
  it.each(PAGES)(
    "keeps the canonical nav and landmarks on %s",
    (page, activeHref) => {
      const html = readPage(page);

      expect(html.match(/<!-- gg-nav v1 -->/g)).toHaveLength(1);
      expect(html).toMatch(
        /<body>\s*<a class="gg-skip" href="#main">Skip to content<\/a>/,
      );
      expect(html).toMatch(/<main\b[^>]*\bid="main"/);
      expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<main"));
      expect(desktopLinks(html)).toEqual(CANONICAL_LINKS);
      expect(html.match(/<a[^>]+aria-current="page"/g)).toHaveLength(2);
      expect(html).toContain(`href="${activeHref}" aria-current="page"`);
      expect(html).toContain('<details class="gg-mobile">');
      expect(html).toContain("@media (max-width: 860px)");
      expect(html).toContain('event.key !== "Escape"');
      expect(html).toContain('document.querySelector(".gg-mobile[open]")');
      expect(html).toContain(
        ":where(a, button, input, textarea, summary):focus-visible",
      );
    },
  );

  it("keeps landing section links in the mobile disclosure", () => {
    const html = readPage("index");
    const mobile =
      html.match(/<details class="gg-mobile">[\s\S]*?<\/details>/)?.[0] ?? "";

    expect(mobile).toContain('<div class="gg-section-label">Sections</div>');
    for (const id of ["thesis", "how", "proof", "field", "newsdesk", "modes"]) {
      expect(mobile).toContain(`href="#${id}"`);
    }
  });

  it.each(["arena", "dashboard"])(
    "preserves one pair of contextual proof controls on %s",
    (page) => {
      const html = readPage(page);
      expect(html.match(/id="verifyButton"/g)).toHaveLength(1);
      expect(html.match(/id="tamperButton"/g)).toHaveLength(1);
    },
  );
});
