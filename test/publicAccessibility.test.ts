import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGES = [
  "index",
  "arena",
  "app",
  "news",
  "status",
  "dashboard",
] as const;

function readPage(name: (typeof PAGES)[number]): string {
  return readFileSync(resolve(process.cwd(), "public", `${name}.html`), "utf8");
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((value >> 16) & 0xff) +
    0.7152 * channel((value >> 8) & 0xff) +
    0.0722 * channel(value & 0xff)
  );
}

function contrast(left: string, right: string): number {
  const lighter = Math.max(luminance(left), luminance(right));
  const darker = Math.min(luminance(left), luminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function tagWithId(html: string, id: string): string {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? "";
}

describe("public accessibility contracts", () => {
  it("keeps the small-text token above WCAG AA on every relevant surface", () => {
    expect(contrast("#8b8d94", "#0a0a0c")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#8b8d94", "#1a1a21")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#8b8d94", "#232329")).toBeGreaterThanOrEqual(4.5);

    for (const page of PAGES) {
      const html = readPage(page);
      expect(html, page).toContain("--dim-text: #8b8d94");
      expect(html, page).not.toMatch(/(?<!-)color:\s*var\(--dim\)/);
    }
  });

  it("does not request font weights above the loaded families' maximum", () => {
    for (const page of PAGES) {
      const html = readPage(page);
      expect(html, page).not.toMatch(/font-weight:\s*(?:7[1-9]\d|[89]\d{2})/);
      expect(html, page).not.toMatch(/font:\s*(?:7[1-9]\d|[89]\d{2})\s/);
    }
  });

  it("keeps every landing data table in a labeled keyboard-scrollable region", () => {
    const html = readPage("index");
    expect(html.match(/<table\b/g)).toHaveLength(3);
    expect(html.match(/class="table-scroll\b/g)).toHaveLength(3);
    expect(html.match(/role="region"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
    expect(html).toContain("-webkit-overflow-scrolling: touch");
    expect(html).toContain("min-width: 760px");
  });

  it("announces async verdict and proof-state changes without asserting them", () => {
    const regions = [
      ["arena", "stageStatus"],
      ["arena", "hashStatus"],
      ["dashboard", "hashState"],
      ["index", "verdictBadge"],
      ["app", "liveList"],
      ["status", "overallText"],
    ] as const;

    for (const [page, id] of regions) {
      expect(tagWithId(readPage(page), id), `${page}#${id}`).toContain(
        'aria-live="polite"',
      );
    }
  });

  it("supports motion-safe assistant updates and pausable evidence tickers", () => {
    const app = readPage("app");
    expect(app).toContain("@media (prefers-reduced-motion: reduce)");
    expect(app).toContain("animation-duration: 0.01ms !important");

    for (const page of ["arena", "dashboard"] as const) {
      const html = readPage(page);
      expect(html).toContain(".ticker:hover .ticker-track");
      expect(html).toContain(".ticker:focus-within .ticker-track");
      expect(html).toContain("animation-play-state: paused");
      expect(html).toMatch(/<section class="ticker" tabindex="0"/);
    }
  });

  it("reserves metric width and keeps audited controls at the touch floor", () => {
    const index = readPage("index");
    expect(index).toMatch(/\.metric \.v\s*{[^}]*min-width:\s*6ch/s);
    expect(index).toMatch(/\.scrub-btn\s*{[^}]*min-height:\s*44px/s);
    expect(index).toMatch(/\.preset-btn\s*{[^}]*min-height:\s*44px/s);

    const arena = readPage("arena");
    expect(arena).toMatch(/\.receipt-value\s*{[^}]*min-width:\s*6ch/s);

    const app = readPage("app");
    expect(app).toMatch(/\.rules-bar button\s*{[^}]*min-height:\s*44px/s);
    expect(app).toMatch(/\.gap-action \.copy, \.ticket-row \.copy\s*{[^}]*min-height:\s*44px/s);
  });
});
