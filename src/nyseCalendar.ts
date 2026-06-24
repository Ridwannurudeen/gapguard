// NYSE equity holiday calendar generator.
// Veterans Day is intentionally excluded: it is a bond-market holiday only.

const pad = (n: number): string => String(n).padStart(2, "0");

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function isoFromDate(date: Date): string {
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): string {
  let count = 0;
  for (let day = 1; day <= 31; day += 1) {
    const date = utcDate(year, month, day);
    if (date.getUTCMonth() !== month - 1) break;
    if (date.getUTCDay() === weekday) {
      count += 1;
      if (count === nth) return iso(year, month, day);
    }
  }
  throw new Error(`no weekday ${weekday} #${nth} in ${year}-${month}`);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  for (let day = 31; day >= 1; day -= 1) {
    const date = utcDate(year, month, day);
    if (date.getUTCMonth() !== month - 1) continue;
    if (date.getUTCDay() === weekday) return iso(year, month, day);
  }
  throw new Error(`no weekday ${weekday} in ${year}-${month}`);
}

function observedFixedHoliday(
  year: number,
  month: number,
  day: number,
): string {
  const date = utcDate(year, month, day);
  const dow = date.getUTCDay();
  if (dow === 0) return isoFromDate(addDays(date, 1));
  if (dow === 6) return isoFromDate(addDays(date, -1));
  return iso(year, month, day);
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

function isWeekday(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow !== 0 && dow !== 6;
}

export function nyseFullClosuresForYear(year: number): ReadonlySet<string> {
  return new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    isoFromDate(addDays(easterSunday(year), -2)),
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]);
}

export function nyseEarlyClosesForYear(year: number): ReadonlyMap<string, string> {
  const full = nyseFullClosuresForYear(year);
  const early = new Map<string, string>();
  const july3 = utcDate(year, 7, 3);
  const christmasEve = utcDate(year, 12, 24);
  const thanksgiving = utcDate(year, 11, Number(nthWeekday(year, 11, 4, 4).slice(8, 10)));
  const blackFriday = addDays(thanksgiving, 1);

  for (const date of [july3, blackFriday, christmasEve]) {
    const value = isoFromDate(date);
    if (isWeekday(date) && !full.has(value)) early.set(value, "13:00");
  }
  return early;
}

function mergeSets(years: number[]): ReadonlySet<string> {
  return new Set(years.flatMap((year) => [...nyseFullClosuresForYear(year)]));
}

function mergeMaps(years: number[]): ReadonlyMap<string, string> {
  return new Map(
    years.flatMap((year) => [...nyseEarlyClosesForYear(year).entries()]),
  );
}

export function nyseFullClosuresAround(year: number): ReadonlySet<string> {
  return mergeSets([year - 1, year, year + 1]);
}

export function nyseEarlyClosesAround(year: number): ReadonlyMap<string, string> {
  return mergeMaps([year - 1, year, year + 1]);
}

export const NYSE_FULL_CLOSURES_2026 = nyseFullClosuresForYear(2026);
export const NYSE_EARLY_CLOSES_2026 = nyseEarlyClosesForYear(2026);
