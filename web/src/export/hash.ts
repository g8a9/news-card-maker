// A cheap fingerprint of everything that changes the exported picture, so the pre-rendered PNG is
// only reused when it is still what the card shows (PLAN.md §8.1).
import { effective } from '../core/types.ts';
import type { AppState } from '../state/app-state.ts';

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function exportHash(state: AppState): string {
  const a = state.article;
  if (!a) return '';
  const f = a.fields;
  return fnv1a(
    JSON.stringify([
      state.style,
      effective(f.title),
      effective(f.description),
      effective(f.kicker),
      effective(f.siteName),
      effective(f.authors),
      effective(f.published),
      effective(f.modified),
      effective(f.image)?.objectUrl,
      effective(f.logo)?.objectUrl,
      a.citeUrl,
      a.lang,
      a.dir,
      a.brand.color,
      a.brand.paper,
    ]),
  );
}
