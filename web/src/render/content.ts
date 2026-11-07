// Turns an ArticleModel plus a CardStyle into the strings a card prints (PLAN.md §7.2, §9.4).
import { daysBetween, formatDate, today } from '../core/dates.ts';
import { formatAuthors } from '../core/text.ts';
import { type ArticleModel, effective } from '../core/types.ts';
import { displayUrl } from '../core/url.ts';
import type { CardStyle } from './style.ts';

export interface CardContent {
  title: string;
  description: string | null;
  kicker: string | null;
  siteName: string | null;
  date: string | null;
  updated: string | null;
  accessed: string | null;
  /** Source-specific facts, such as Hacker News points and comments. */
  extra: string | null;
  authors: string | null;
  url: string | null;
  locale: string;
}

const LABELS: Record<string, { updated: string; accessed: string }> = {
  en: { updated: 'Updated', accessed: 'Accessed' },
  it: { updated: 'Aggiornato', accessed: 'Consultato' },
  de: { updated: 'Aktualisiert', accessed: 'Abgerufen' },
  fr: { updated: 'Mis à jour', accessed: 'Consulté' },
  es: { updated: 'Actualizado', accessed: 'Consultado' },
  pt: { updated: 'Atualizado', accessed: 'Acedido' },
};

const label = (locale: string, key: 'updated' | 'accessed'): string =>
  (LABELS[locale.toLowerCase().split('-')[0] as string] ?? LABELS.en)?.[key] as string;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function hnExtra(article: ArticleModel): string | null {
  const hn = article.extras?.hn;
  return hn
    ? `${plural(hn.points, 'point', 'points')} · ${plural(hn.comments, 'comment', 'comments')}`
    : null;
}

export function resolveLocale(style: CardStyle, article: ArticleModel, hostLocale: string): string {
  if (style.locale === 'article') return article.lang ?? hostLocale;
  if (style.locale === 'auto') return hostLocale;
  return style.locale;
}

/** "https://very-long…" shortened in the middle so the end of the path stays recognisable. */
export function ellipsizeMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

export function cardContent(
  article: ArticleModel,
  style: CardStyle,
  options: { hostLocale: string; now: Date; width: number },
): CardContent {
  const locale = resolveLocale(style, article, options.hostLocale);
  const f = article.fields;
  const published = effective(f.published);
  const modified = effective(f.modified);
  const title = effective(f.title)?.trim() || 'Untitled';
  const authors = effective(f.authors);

  return {
    title,
    description: style.show.description ? (effective(f.description)?.trim() ?? null) || null : null,
    kicker: style.show.kicker ? (effective(f.kicker)?.trim() ?? null) || null : null,
    siteName: effective(f.siteName)?.trim() || null,
    date: style.show.date && published ? formatDate(published, locale, style.dateFormat) : null,
    updated:
      style.show.updated && modified && published && daysBetween(published, modified) > 1
        ? `${label(locale, 'updated')} ${formatDate(modified, locale, style.dateFormat)}`
        : null,
    accessed: style.show.accessed
      ? `${label(locale, 'accessed')} ${formatDate(today(options.now), locale, style.dateFormat)}`
      : null,
    extra: hnExtra(article),
    authors:
      style.show.authors && authors && authors.length > 0 ? formatAuthors(authors, locale) : null,
    url: style.show.url
      ? ellipsizeMiddle(
          displayUrl(article.citeUrl, style.urlStyle),
          Math.max(24, Math.round(options.width / 26)),
        )
      : null,
    locale,
  };
}

/** Alt text for the preview and for pasting into slides. */
export function altText(content: CardContent): string {
  const from = content.siteName ? ` from ${content.siteName}` : '';
  const when = content.date ? ` (${content.date})` : '';
  return `News headline${from}: “${content.title}”${when}`;
}
