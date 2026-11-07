import type { SourceId } from '../../core/types.ts';

/** What the alternatives menu calls each source (PLAN.md §9.4). */
export function sourceLabel(
  source: SourceId,
  note: string | undefined,
  kind: 'title' | 'description' | 'other',
): string {
  const first = (note ?? '').split(',')[0]?.trim();
  switch (source) {
    case 'jsonld':
      return 'Structured data';
    case 'og':
      return kind === 'description' ? 'Social description' : 'Social title';
    case 'twitter':
      return kind === 'description' ? 'Twitter description' : 'Twitter title';
    case 'html':
      return first === 'h1'
        ? 'Page headline'
        : first === 'title'
          ? 'SEO title'
          : first === 'article-img'
            ? 'Article image'
            : 'Page';
    case 'meta':
      return kind === 'description' ? 'Meta description' : 'Meta tag';
    case 'article':
      return 'Article tag';
    case 'parsely':
      return 'Parse.ly';
    case 'sailthru':
      return 'Sailthru';
    case 'citation':
      return 'Citation';
    case 'dc':
      return 'Dublin Core';
    case 'microdata':
      return 'Microdata';
    case 'feed':
      return 'RSS';
    case 'wayback':
      return 'Internet Archive';
    case 'adapter':
      return 'Source';
    case 'registry':
      return 'Outlet';
    case 'user':
      return 'Yours';
    default:
      return source;
  }
}
