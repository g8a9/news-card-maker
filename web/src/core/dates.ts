// Date parsing and display (PLAN.md §5.5, "Dates"). Dates are kept as written by the source,
// in the source's own UTC offset, and shown that way: never converted to the viewer's time zone.
import type { PartialDate } from './types.ts';

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const ZONES: Record<string, number> = {
  Z: 0,
  UT: 0,
  UTC: 0,
  GMT: 0,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
};

const MIN_YEAR = 1995;

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

function offsetFrom(text: string | undefined): number | null {
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper in ZONES) return ZONES[upper] as number;
  const m = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(text);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutes : minutes;
}

function build(
  raw: string,
  y: number,
  m: number,
  d: number,
  hh: number | undefined,
  mi: number | undefined,
  offsetMin: number | null,
  now: number,
): PartialDate | null {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  if (hh !== undefined && (hh > 23 || (mi ?? 0) > 59)) return null;
  const limit = new Date(now + 24 * 3600 * 1000);
  const afterLimit =
    y > limit.getUTCFullYear() ||
    (y === limit.getUTCFullYear() &&
      (m > limit.getUTCMonth() + 1 || (m === limit.getUTCMonth() + 1 && d > limit.getUTCDate())));
  if (y < MIN_YEAR || afterLimit) return null;
  const out: PartialDate = { raw, y, m, d, offsetMin };
  if (hh !== undefined) {
    out.hh = hh;
    out.mi = mi ?? 0;
  }
  return out;
}

function fromEpoch(value: number, raw: string, now: number): PartialDate | null {
  const ms = value < 1e11 ? value * 1000 : value;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return build(
    raw,
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    0,
    now,
  );
}

const ISO =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?$/i;
const RFC2822 =
  /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|UT|UTC|GMT|[A-Z]{3}|[+-]\d{4})?$/;
const DAY_MONTH_YEAR =
  /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?:[\s,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i;
const MONTH_DAY_YEAR =
  /^(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[\s,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i;

const to24 = (hour: number, meridiem: string | undefined): number => {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase() === 'pm';
  return (hour % 12) + (pm ? 12 : 0);
};

/** Parses ISO 8601 (all offset spellings), RFC 2822, epoch seconds/ms and plain English dates. */
export function parseDate(input: unknown, now: number = Date.now()): PartialDate | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? fromEpoch(input, String(input), now) : null;
  }
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  if (/^\d{10}$|^\d{13}$/.test(raw)) return fromEpoch(Number(raw), raw, now);

  let m = ISO.exec(raw);
  if (m) {
    const hh = m[4] === undefined ? undefined : Number(m[4]);
    return build(
      raw,
      +(m[1] as string),
      +(m[2] as string),
      +(m[3] as string),
      hh,
      m[5] === undefined ? undefined : Number(m[5]),
      hh === undefined ? null : offsetFrom(m[7]),
      now,
    );
  }
  m = RFC2822.exec(raw);
  if (m) {
    const month = MONTHS[(m[2] as string).toLowerCase()];
    if (!month) return null;
    let year = Number(m[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const hh = m[4] === undefined ? undefined : Number(m[4]);
    return build(
      raw,
      year,
      month,
      Number(m[1]),
      hh,
      m[5] === undefined ? undefined : Number(m[5]),
      hh === undefined ? null : offsetFrom(m[7]),
      now,
    );
  }
  m = DAY_MONTH_YEAR.exec(raw);
  if (m) {
    const month = MONTHS[(m[2] as string).toLowerCase()];
    if (!month) return null;
    const hh = m[4] === undefined ? undefined : to24(Number(m[4]), m[7]);
    return build(
      raw,
      Number(m[3]),
      month,
      Number(m[1]),
      hh,
      m[5] === undefined ? undefined : Number(m[5]),
      null,
      now,
    );
  }
  m = MONTH_DAY_YEAR.exec(raw);
  if (m) {
    const month = MONTHS[(m[1] as string).toLowerCase()];
    if (!month) return null;
    const hh = m[4] === undefined ? undefined : to24(Number(m[4]), m[7]);
    return build(
      raw,
      Number(m[3]),
      month,
      Number(m[2]),
      hh,
      m[5] === undefined ? undefined : Number(m[5]),
      null,
      now,
    );
  }
  return null;
}

/** A date hidden in the URL path: /2026/11/07/, /2026-11-07/, /2026/nov/06/. */
export function dateFromUrl(url: string, now: number = Date.now()): PartialDate | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const numeric = /\/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?=[/\-_.]|$)/.exec(path);
  if (numeric) {
    const out = build(
      numeric[0].slice(1),
      +(numeric[1] as string),
      +(numeric[2] as string),
      +(numeric[3] as string),
      undefined,
      undefined,
      null,
      now,
    );
    if (out) return out;
  }
  const named = /\/(\d{4})\/([a-z]{3,9})\/(\d{1,2})(?=[/\-_.]|$)/i.exec(path);
  if (named) {
    const month = MONTHS[(named[2] as string).toLowerCase()];
    if (month)
      return build(
        named[0].slice(1),
        +(named[1] as string),
        month,
        +(named[3] as string),
        undefined,
        undefined,
        null,
        now,
      );
  }
  return null;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export const toIsoDate = (d: PartialDate): string => `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)}`;

/** Same calendar day as written, ignoring offsets (Il Post: +02:00 vs +01:00, same day). */
export const sameDay = (a: PartialDate, b: PartialDate): boolean =>
  a.y === b.y && a.m === b.m && a.d === b.d;

export function daysBetween(from: PartialDate, to: PartialDate): number {
  const t = (d: PartialDate) => Date.UTC(d.y, d.m - 1, d.d);
  return Math.round((t(to) - t(from)) / 86_400_000);
}

export type DateStyle = 'long' | 'medium' | 'short' | 'iso';

/** Formats the calendar date as written. `timeZone: 'UTC'` keeps it from shifting for the viewer. */
export function formatDate(
  date: PartialDate,
  locale: string | undefined,
  style: DateStyle,
): string {
  if (style === 'iso') return toIsoDate(date);
  const instant = new Date(Date.UTC(date.y, date.m - 1, date.d, 12));
  const options: Intl.DateTimeFormatOptions = { dateStyle: style, timeZone: 'UTC' };
  try {
    return new Intl.DateTimeFormat(locale, options).format(instant);
  } catch {
    return new Intl.DateTimeFormat('en', options).format(instant);
  }
}

/** Today's date, for "Accessed {today}". */
export function today(now: Date = new Date()): PartialDate {
  return {
    raw: now.toISOString(),
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: now.getDate(),
    offsetMin: -now.getTimezoneOffset(),
  };
}
