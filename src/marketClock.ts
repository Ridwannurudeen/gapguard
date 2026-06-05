import {
  NYSE_FULL_CLOSURES_2026,
  NYSE_EARLY_CLOSES_2026,
} from "./nyseCalendar2026";
import type { MarketSession, SessionState } from "./types";

const PRE_START = 4 * 60; // 04:00 ET
const OPEN = 9 * 60 + 30; // 09:30 ET
const REGULAR_CLOSE = 16 * 60; // 16:00 ET
const EARLY_CLOSE = 13 * 60; // 13:00 ET
const POST_END = 20 * 60; // 20:00 ET

const DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface ClockOptions {
  fullClosures?: ReadonlySet<string>;
  earlyCloses?: ReadonlyMap<string, string>;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Extract New York wall-clock components from a UTC instant (DST-correct via Intl). */
function etParts(d: Date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const o: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) o[part.type] = part.value;
  return {
    year: +o.year,
    month: +o.month,
    day: +o.day,
    hour: +o.hour,
    minute: +o.minute,
    dow: DOW[o.weekday],
  };
}

/** Offset (asUTC − realUTC) of America/New_York at instant `d`, in ms. */
function etOffsetMs(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const o: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) o[part.type] = part.value;
  const asUTC = Date.UTC(
    +o.year,
    +o.month - 1,
    +o.day,
    +o.hour,
    +o.minute,
    +o.second,
  );
  return asUTC - d.getTime();
}

/** Convert an ET wall-clock time to the matching UTC instant (handles DST). */
function etWallToUtc(
  y: number,
  mo: number,
  da: number,
  h: number,
  mi: number,
): Date {
  const base = Date.UTC(y, mo - 1, da, h, mi, 0);
  let guess = new Date(base);
  for (let i = 0; i < 2; i++) guess = new Date(base - etOffsetMs(guess));
  return guess;
}

function isTradingDay(
  y: number,
  mo: number,
  da: number,
  full: ReadonlySet<string>,
): boolean {
  const dow = new Date(Date.UTC(y, mo - 1, da, 12)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !full.has(`${y}-${pad(mo)}-${pad(da)}`);
}

/** First regular-session open strictly after `now`. */
function nextRegularOpen(now: Date, full: ReadonlySet<string>): Date {
  const p = etParts(now);
  const start = Date.UTC(p.year, p.month - 1, p.day, 12);
  for (let i = 0; i < 15; i++) {
    const anchor = new Date(start + i * 86_400_000);
    const y = anchor.getUTCFullYear();
    const mo = anchor.getUTCMonth() + 1;
    const da = anchor.getUTCDate();
    if (!isTradingDay(y, mo, da, full)) continue;
    const open = etWallToUtc(y, mo, da, 9, 30);
    if (open.getTime() > now.getTime()) return open;
  }
  return etWallToUtc(p.year, p.month, p.day, 9, 30);
}

/**
 * Classify the US-market session for a tokenized stock at instant `now`.
 * The token trades 24/7; `underlyingOpen` is the gate — true only when the
 * underlying market is setting price. Everything else is gap-risk territory.
 */
export function classifySession(
  now: Date,
  opts: ClockOptions = {},
): SessionState {
  const full = opts.fullClosures ?? NYSE_FULL_CLOSURES_2026;
  const early = opts.earlyCloses ?? NYSE_EARLY_CLOSES_2026;

  const p = etParts(now);
  const dateStr = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const m = p.hour * 60 + p.minute;

  let session: MarketSession;
  let underlyingOpen = false;

  if (full.has(dateStr)) {
    session = "holiday";
  } else if (p.dow === 0 || p.dow === 6) {
    session = "weekend";
  } else {
    const close = early.has(dateStr) ? EARLY_CLOSE : REGULAR_CLOSE;
    if (m >= OPEN && m < close) {
      session = "regular";
      underlyingOpen = true;
    } else if (m >= PRE_START && m < OPEN) {
      session = "pre";
    } else if (m >= close && m < POST_END) {
      session = "post";
    } else {
      session = "overnight";
    }
  }

  const nextOpen = nextRegularOpen(now, full);
  return {
    session,
    underlyingOpen,
    etTime: `${dateStr} ${pad(p.hour)}:${pad(p.minute)} ET`,
    nextOpenUtc: nextOpen.toISOString(),
    msToNextOpen: nextOpen.getTime() - now.getTime(),
  };
}
