// File names (PLAN.md §8.3): {outlet-slug}-{yyyy-mm-dd}-{first-6-words-of-headline}.{ext}, ASCII-folded,
// at most 80 characters, for example "the-guardian-2026-11-06-kenyan-doomsday-sect-leader-jailed.png".
import { toIsoDate } from '../core/dates.ts';
import type { PartialDate } from '../core/types.ts';

export function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface NameInput {
  siteName: string | null;
  /** Used when the outlet name has no ASCII letters (for example Arabic or Japanese). */
  host: string;
  published: PartialDate | null;
  title: string;
}

const MAX_LENGTH = 80;

export function fileName(input: NameInput, extension: string): string {
  const outlet = slug(input.siteName ?? '') || slug(input.host.replace(/^www\./, '')) || 'card';
  const date = input.published ? toIsoDate(input.published) : '';
  const words = slug(input.title.split(/\s+/).slice(0, 6).join(' '));
  const base = [outlet, date, words].filter(Boolean).join('-');
  const room = MAX_LENGTH - extension.length - 1;
  return `${base.slice(0, room).replace(/-+$/, '')}.${extension}`;
}
