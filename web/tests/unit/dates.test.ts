import { describe, expect, it } from 'vitest';
import {
  dateFromUrl,
  daysBetween,
  formatDate,
  parseDate,
  sameDay,
  toIsoDate,
} from '../../src/core/dates.ts';
import { NOW } from './helpers.ts';

const p = (input: unknown) => parseDate(input, NOW);

describe('parseDate: ISO 8601', () => {
  it.each([
    ['2026-11-06T23:46:00Z', { y: 2026, m: 11, d: 6, hh: 23, mi: 46, offsetMin: 0 }],
    ['2026-11-06T23:46:00.123Z', { y: 2026, m: 11, d: 6, hh: 23, mi: 46, offsetMin: 0 }],
    ['2026-11-06T23:46:00-05:00', { y: 2026, m: 11, d: 6, hh: 23, mi: 46, offsetMin: -300 }],
    ['2026-11-06T23:46:00+0100', { y: 2026, m: 11, d: 6, hh: 23, mi: 46, offsetMin: 60 }],
    ['2026-11-06T23:46:00+01', { y: 2026, m: 11, d: 6, hh: 23, mi: 46, offsetMin: 60 }],
    ['2026-11-06T23:46:00+05:30', { y: 2026, m: 11, d: 6, hh: 23, mi: 46, offsetMin: 330 }],
    ['2026-11-06T09:15+02:00', { y: 2026, m: 11, d: 6, hh: 9, mi: 15, offsetMin: 120 }],
    ['2026-11-06 21:15:00', { y: 2026, m: 11, d: 6, hh: 21, mi: 15, offsetMin: null }],
    ['2026-11-06', { y: 2026, m: 11, d: 6, offsetMin: null }],
    ['2026/11/06', { y: 2026, m: 11, d: 6, offsetMin: null }],
  ])('parses %s', (input, expected) => {
    expect(p(input)).toMatchObject(expected);
  });

  it('keeps the raw string', () => {
    expect(p(' 2026-11-06T09:15:00Z ')?.raw).toBe('2026-11-06T09:15:00Z');
  });
});

describe('parseDate: other formats', () => {
  it('parses RFC 2822', () => {
    expect(p('Fri, 06 Nov 2026 23:46:00 GMT')).toMatchObject({
      y: 2026,
      m: 11,
      d: 6,
      hh: 23,
      mi: 46,
      offsetMin: 0,
    });
    expect(p('Fri, 6 Nov 2026 08:00:00 +0100')).toMatchObject({ d: 6, hh: 8, offsetMin: 60 });
    expect(p('Thu, 05 Nov 2026 19:00:00 EST')).toMatchObject({ d: 5, offsetMin: -300 });
  });

  it('parses epoch seconds and milliseconds as UTC', () => {
    expect(p(1_794_000_000)).toMatchObject({ y: 2026, m: 11, d: 6, offsetMin: 0 });
    expect(p('1794000000')).toMatchObject({ y: 2026, m: 11, d: 6 });
    expect(p(1_794_000_000_000)).toMatchObject({ y: 2026, m: 11, d: 6 });
  });

  it('parses plain English dates', () => {
    expect(p('November 6, 2026')).toMatchObject({ y: 2026, m: 11, d: 6, offsetMin: null });
    expect(p('6 November 2026')).toMatchObject({ y: 2026, m: 11, d: 6 });
    expect(p('Nov 6th, 2026 4:30 PM')).toMatchObject({ y: 2026, m: 11, d: 6, hh: 16, mi: 30 });
  });

  it('rejects junk', () => {
    for (const v of [
      '',
      'yesterday',
      'not a date',
      null,
      undefined,
      {},
      '2026-13-01',
      '2026-02-30',
      '2026-11-06T25:00:00Z',
    ]) {
      expect(p(v), String(v)).toBeNull();
    }
  });

  it('applies the sanity window: 1995 to now + 1 day', () => {
    expect(p('1994-12-31')).toBeNull();
    expect(p('1995-01-01')).not.toBeNull();
    expect(p('2026-11-08')).not.toBeNull(); // tomorrow: time zones
    expect(p('2026-11-09')).toBeNull();
    expect(p('2031-01-01')).toBeNull();
  });
});

describe('calendar dates stay as written', () => {
  it('shows 23:46 at -05:00 as the 6th whatever the viewer time zone', () => {
    const d = p('2026-11-06T23:46:00-05:00');
    expect(d && formatDate(d, 'en', 'iso')).toBe('2026-11-06');
    expect(d && formatDate(d, 'en', 'long')).toBe('November 6, 2026');
    expect(d && formatDate(d, 'it', 'long')).toBe('6 novembre 2026');
    expect(d && formatDate(d, 'de', 'medium')).toBe('06.11.2026');
  });

  it('treats sources that differ only by offset as the same day', () => {
    const a = p('2026-11-06T09:15:00+02:00');
    const b = p('2026-11-06T08:15:00+01:00');
    expect(a && b && sameDay(a, b)).toBe(true);
  });

  it('falls back to English for unknown locales', () => {
    const d = p('2026-11-06');
    expect(d && formatDate(d, 'xx-INVALID-zz', 'long')).toBe('November 6, 2026');
  });

  it('computes day differences and ISO strings', () => {
    const a = p('2026-11-05');
    const b = p('2026-11-07');
    expect(a && b && daysBetween(a, b)).toBe(2);
    expect(a && toIsoDate(a)).toBe('2026-11-05');
  });
});

describe('dateFromUrl', () => {
  it.each([
    ['https://example.com/2026/11/07/story', '2026-11-07'],
    ['https://example.com/news/2026-11-07/story', '2026-11-07'],
    ['https://example.com/world/2026/nov/06/story', '2026-11-06'],
    ['https://example.com/2026/1/5/story', '2026-01-05'],
  ])('finds the date in %s', (u, iso) => {
    const d = dateFromUrl(u, NOW);
    expect(d && toIsoDate(d)).toBe(iso);
  });

  it('ignores non-dates', () => {
    expect(dateFromUrl('https://example.com/2026/99/99/story', NOW)).toBeNull();
    expect(dateFromUrl('https://example.com/story-123456', NOW)).toBeNull();
    expect(dateFromUrl('https://example.com/a?date=2026-11-07', NOW)).toBeNull();
  });
});
