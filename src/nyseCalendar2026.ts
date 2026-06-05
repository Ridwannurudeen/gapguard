// 2026 NYSE equity holiday calendar.
// Source: NYSE/ICE 2025–2027 Holiday & Early-Closings calendar, cross-checked against
// calendarlabs.com/nyse-market-holidays-2026. Veterans Day (Nov 11) is intentionally
// excluded: it is a bond-market holiday only — NYSE equities trade a full session.

/** Full-day closures (market shut all day). */
export const NYSE_FULL_CLOSURES_2026: ReadonlySet<string> = new Set([
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King Jr. Day
  "2026-02-16", // Washington's Birthday (Presidents' Day)
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth National Independence Day
  "2026-07-03", // Independence Day (observed; Jul 4 falls on Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving Day
  "2026-12-25", // Christmas Day
]);

/** Early closes — regular session ends 1:00 p.m. ET (780 minutes). Value is ET HH:MM. */
export const NYSE_EARLY_CLOSES_2026: ReadonlyMap<string, string> = new Map([
  ["2026-11-27", "13:00"], // Day after Thanksgiving
  ["2026-12-24", "13:00"], // Christmas Eve
]);
