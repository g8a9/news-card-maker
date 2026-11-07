// URL handling: input normalisation (§5.6.1), citation cleaning (§5.6.4), same-site checks (§5.6.5).

/** Tracking parameters to drop (Appendix B.1). Compared lower-case. */
const TRACKING_PARAMS = new Set(
  [
    'mc_cid',
    'mc_eid',
    'fbclid',
    'gclid',
    'dclid',
    'gbraid',
    'wbraid',
    'msclkid',
    'yclid',
    'twclid',
    'ttclid',
    'igshid',
    'li_fat_id',
    '_hsenc',
    '_hsmi',
    'mkt_tok',
    'oly_anon_id',
    'oly_enc_id',
    'vero_id',
    'rb_clickid',
    's_cid',
    'cmpid',
    'cmp',
    'ocid',
    'xtor',
    'smid',
    'smtyp',
    'sr_share',
    'traffic_source',
    'ref',
    'ref_src',
    'ref_url',
    'share',
    'shared',
    'guccounter',
    'guce_referrer',
    'guce_referrer_sig',
    'unlocked_article_code',
    'giftcopy',
    'gift',
    '_ga',
    '_gl',
    'spm',
  ].map((p) => p.toLowerCase()),
);
const TRACKING_PREFIXES = ['utm_', 'at_', 'syn-'];

export const isTrackingParam = (name: string): boolean => {
  const n = name.toLowerCase();
  return TRACKING_PARAMS.has(n) || TRACKING_PREFIXES.some((p) => n.startsWith(p));
};

/** Resolves `href` against `base`. Only http(s) URLs (and data:image/ when allowed) are returned. */
export function resolveUrl(
  href: string | null | undefined,
  base: string,
  options: { allowDataImage?: boolean } = {},
): string | null {
  const text = href?.trim();
  if (!text) return null;
  if (options.allowDataImage && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(text)) {
    return text;
  }
  try {
    const url = new URL(text, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/** Drops the fragment and tracking parameters, keeps every other query parameter in order. */
export function cleanCitationUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (isTrackingParam(key)) u.searchParams.delete(key);
    }
    return u.href;
  } catch {
    return url;
  }
}

/** Scheme-, `www`-, query-, fragment- and trailing-slash-insensitive form, for comparing URLs. */
export function comparableUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

/** Approximate registrable domain without the Public Suffix List: `bbc.co.uk`, `nytimes.com`. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const take = SECOND_LEVEL.has(labels[labels.length - 2] as string) ? 3 : 2;
  return labels.slice(-take).join('.');
}

export const sameSite = (a: string, b: string): boolean =>
  registrableDomain(hostOf(a) || a) === registrableDomain(hostOf(b) || b);

/** Host labels without the public suffix and generic prefixes: "www.theguardian.com" → ["theguardian"]. */
export function hostLabels(host: string): string[] {
  const reg = registrableDomain(host);
  const first = reg.split('.')[0];
  const stripped = host.toLowerCase().replace(/^(www|m|amp|mobile)\./, '');
  return [...new Set([first, stripped, reg].filter((x): x is string => !!x))];
}

export function isAmpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (/^amp\./i.test(u.hostname) || /\.cdn\.ampproject\.org$/i.test(u.hostname)) return true;
    if (u.hostname.includes('google.') && u.pathname.startsWith('/amp/')) return true;
    if (/(^|\/)amp(\/|$)/i.test(u.pathname) || /\.amp(\.html)?$/i.test(u.pathname)) return true;
    const output = u.searchParams.get('outputType') ?? u.searchParams.get('output');
    return output?.toLowerCase() === 'amp' || u.searchParams.get('amp') === '1';
  } catch {
    return false;
  }
}

// ---- Input normalisation -------------------------------------------------------------------

export type InputResult =
  | { ok: true; url: string; warnings: string[] }
  | { ok: false; reason: 'empty' | 'not-a-url' | 'unsupported-scheme' };

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`“”‘’]+/i;
const BARE_DOMAIN =
  /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;

function trimTrailingPunctuation(url: string): string {
  let out = url.replace(/[.,;:!?'"»›]+$/, '');
  while (out.endsWith(')') && !out.includes('(')) out = out.slice(0, -1).replace(/[.,;:!?]+$/, '');
  return out;
}

/** Peels one redirect wrapper off a URL, or returns null when it is not wrapped. */
function unwrapOnce(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (/^(www\.)?google\.[a-z.]+$/.test(host)) {
    if (u.pathname === '/url') return u.searchParams.get('q') ?? u.searchParams.get('url');
    const amp = /^\/amp\/s\/(.+)$/.exec(u.pathname);
    if (amp) return `https://${amp[1]}${u.search}`;
  }
  if (/^(l|lm)\.facebook\.com$/.test(host) && u.pathname === '/l.php')
    return u.searchParams.get('u');
  if (host.endsWith('.cdn.ampproject.org')) {
    const amp = /^\/[cv]\/s\/(.+)$/.exec(u.pathname);
    if (amp) return `https://${amp[1]}${u.search}`;
  }
  return null;
}

/** Turns whatever the user pasted ("Title — https://…", "example.com/story") into a clean http(s) URL. */
export function normalizeInput(text: string): InputResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  let candidate: string | null = null;
  const found = URL_IN_TEXT.exec(trimmed);
  if (found) {
    candidate = trimTrailingPunctuation(found[0]);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[a-z0-9.-]+:\d+/i.test(trimmed)) {
    return { ok: false, reason: 'unsupported-scheme' };
  } else {
    const token = trimmed.split(/\s+/).find((t) => BARE_DOMAIN.test(t));
    if (token) candidate = `https://${trimTrailingPunctuation(token)}`;
  }
  if (!candidate) return { ok: false, reason: 'not-a-url' };

  const warnings: string[] = [];
  for (let i = 0; i < 3; i++) {
    const inner = unwrapOnce(candidate);
    if (!inner) break;
    const found2 = URL_IN_TEXT.exec(inner);
    candidate = found2 ? found2[0] : inner;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, reason: 'unsupported-scheme' };
    }
    if (u.hostname === 'news.google.com') warnings.push('google-news-redirect');
    return { ok: true, url: u.href, warnings };
  } catch {
    return { ok: false, reason: 'not-a-url' };
  }
}

// ---- Display ---------------------------------------------------------------------------------

export type UrlStyle = 'clean' | 'full' | 'domain';

export function displayUrl(url: string, style: UrlStyle = 'clean'): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    if (style === 'domain') return host;
    if (style === 'full') return u.href;
    const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
    return `${host}${rest}`;
  } catch {
    return url;
  }
}
