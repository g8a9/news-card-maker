// Edge cache (PLAN.md §4.4). Best effort: guaranteed on custom domains, optional on workers.dev.
import type { Kind } from './upstream.ts';

/** Text depends on the language a localised outlet answers in; images do not. */
function key(kind: Kind, target: URL, acceptLanguage: string | null): Request {
  const lang = kind === 'text' ? (acceptLanguage ?? '').split(/[,;]/)[0]?.trim().toLowerCase() : '';
  const u = `https://cache.invalid/${kind}?u=${encodeURIComponent(target.href)}&l=${encodeURIComponent(lang ?? '')}`;
  return new Request(u);
}

const store = (): Cache | null => {
  try {
    return (caches as unknown as { default?: Cache }).default ?? null;
  } catch {
    return null;
  }
};

export async function cacheLookup(
  kind: Kind,
  target: URL,
  acceptLanguage: string | null,
): Promise<Response | undefined> {
  try {
    return await store()?.match(key(kind, target, acceptLanguage));
  } catch {
    return undefined;
  }
}

/** Stores a response clone unless it opted out with `no-store`. */
export async function cacheStore(
  kind: Kind,
  target: URL,
  acceptLanguage: string | null,
  res: Response,
): Promise<void> {
  try {
    if (res.headers.get('Cache-Control')?.includes('no-store')) return;
    await store()?.put(key(kind, target, acceptLanguage), res);
  } catch {
    // The cache is an optimisation; a failed put (for example an errored stream) is ignored.
  }
}
