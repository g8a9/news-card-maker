// Outlet registry types and host matching (PLAN.md §6.1). The data lives in brand/outlets.json.

export interface OutletLogoRef {
  url: string;
  /** How to treat the logo on dark themes: "mono" recolours it, "original" keeps it. */
  onDark?: 'mono' | 'original';
  onLight?: 'mono' | 'original';
}

export interface Outlet {
  id: string;
  name: string;
  /** A host or any of its subdomains matches. */
  domains: string[];
  colors?: { brand?: string | null; paper?: string | null };
  logo?: { wordmark?: OutletLogoRef; icon?: OutletLogoRef };
  fonts?: { headline?: 'serif' | 'sans' };
  feeds?: string[];
  titleSuffixes?: string[];
  imageRewrites?: Array<{ pattern: string; replace: string }>;
  /** Style defaults for this outlet's cards, applied when a card is first created. */
  defaults?: { theme?: string; template?: string; headlineFont?: string };
  /** "blocked" outlets start their fallbacks in parallel with the direct fetch. */
  fetch?: 'ok' | 'blocked';
  verified?: string;
}

const bare = (host: string): string => host.toLowerCase().replace(/\.$/, '');

/** The outlet whose domain list matches `host` best (longest matching domain wins). */
export function findOutlet(outlets: readonly Outlet[], host: string): Outlet | null {
  const h = bare(host);
  let best: Outlet | null = null;
  let bestLength = -1;
  for (const outlet of outlets) {
    for (const domain of outlet.domains) {
      const d = bare(domain);
      if ((h === d || h.endsWith(`.${d}`)) && d.length > bestLength) {
        best = outlet;
        bestLength = d.length;
      }
    }
  }
  return best;
}

export function findOutletById(outlets: readonly Outlet[], id: string): Outlet | null {
  return outlets.find((o) => o.id === id) ?? null;
}
