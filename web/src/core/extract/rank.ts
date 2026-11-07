// Candidate ranking (PLAN.md §5.5): score = base(source) × quality(value), plus 0.05 for each
// additional source that agrees after normalisation, capped at 1. Keeps up to 5 distinct alternatives.
import type { Candidate, SourceId } from '../types.ts';

export interface RankOptions<T> {
  /** Normalised identity: candidates with the same key agree with each other. */
  key: (value: T) => string;
  /** Picks which member of an agreeing group supplies the displayed value (default: highest score). */
  pick?: (group: Candidate<T>[]) => Candidate<T>;
  limit?: number;
}

export const AGREEMENT_BONUS = 0.05;

export function rank<T>(candidates: Candidate<T>[], options: RankOptions<T>): Candidate<T>[] {
  const groups = new Map<string, Candidate<T>[]>();
  for (const candidate of candidates) {
    if (candidate.score <= 0) continue;
    const key = options.key(candidate.value);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  const ranked: Candidate<T>[] = [];
  for (const group of groups.values()) {
    const bySource = new Map<SourceId, Candidate<T>>();
    for (const c of group) {
      const best = bySource.get(c.source);
      if (!best || c.score > best.score) bySource.set(c.source, c);
    }
    const distinct = [...bySource.values()].sort((a, b) => b.score - a.score);
    const top = distinct[0] as Candidate<T>;
    const chosen = options.pick ? options.pick(group) : top;
    const score = Math.min(1, top.score + AGREEMENT_BONUS * (distinct.length - 1));
    ranked.push({
      value: chosen.value,
      source: top.source,
      score: Math.round(score * 1000) / 1000,
      note: distinct.length > 1 ? distinct.map((c) => c.source).join(', ') : top.note,
    });
  }
  // Array.prototype.sort is stable: equal scores keep their document order.
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, options.limit ?? 5);
}

/** For site names: among entries differing only by case, prefer the better-capitalised one. */
export function pickBestCapitalised(group: Candidate<string>[]): Candidate<string> {
  const upper = (s: string) => (s.match(/\p{Lu}/gu) ?? []).length;
  const startsUpper = (s: string) => /^\p{Lu}/u.test(s);
  return [...group].sort(
    (a, b) =>
      Number(startsUpper(b.value)) - Number(startsUpper(a.value)) ||
      upper(b.value) - upper(a.value) ||
      b.score - a.score,
  )[0] as Candidate<string>;
}
