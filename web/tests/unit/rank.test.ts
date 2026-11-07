import { describe, expect, it } from 'vitest';
import { pickBestCapitalised, rank } from '../../src/core/extract/rank.ts';
import type { Candidate } from '../../src/core/types.ts';

const c = (
  value: string,
  source: Candidate<string>['source'],
  score: number,
): Candidate<string> => ({
  value,
  source,
  score,
});
const key = (s: string) => s.toLowerCase();

describe('rank (PLAN.md §5.5)', () => {
  it('orders by score', () => {
    expect(rank([c('b', 'og', 0.5), c('a', 'jsonld', 0.9)], { key }).map((x) => x.value)).toEqual([
      'a',
      'b',
    ]);
  });

  it('adds 0.05 for each additional agreeing source and caps at 1', () => {
    const [top] = rank(
      [c('Same', 'jsonld', 0.9), c('same', 'og', 0.88), c('SAME', 'twitter', 0.82)],
      { key },
    );
    expect(top?.score).toBe(1);
    const [two] = rank([c('x', 'og', 0.6), c('x', 'meta', 0.5)], { key });
    expect(two?.score).toBe(0.65);
    expect(two?.note).toBe('og, meta');
  });

  it('does not count the same source twice', () => {
    const [top] = rank([c('x', 'html', 0.5), c('x', 'html', 0.4)], { key });
    expect(top?.score).toBe(0.5);
  });

  it('drops zero scores and empty keys, and limits to 5 alternatives', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((v, i) => c(v, 'meta', 0.9 - i * 0.1));
    expect(rank([...many, c('zero', 'og', 0)], { key })).toHaveLength(5);
    expect(rank([c('', 'og', 1)], { key })).toEqual([]);
  });

  it('keeps document order for equal scores', () => {
    const out = rank([c('first', 'og', 0.7), c('second', 'meta', 0.7)], { key });
    expect(out.map((x) => x.value)).toEqual(['first', 'second']);
  });

  it('can pick a different member of an agreeing group', () => {
    const [top] = rank([c('the Guardian', 'og', 0.85), c('The Guardian', 'jsonld', 0.8)], {
      key,
      pick: pickBestCapitalised,
    });
    expect(top?.value).toBe('The Guardian');
    expect(top?.source).toBe('og');
  });
});
