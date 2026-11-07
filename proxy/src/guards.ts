// Target guards (PLAN.md §4.3). Workers cannot reach private networks anyway; these keep the
// contract identical to the FastAPI port in Appendix C, where the same checks are essential.
import { ProxyError } from './errors.ts';

const FORBIDDEN_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

/** [network, prefix length] pairs, written as four octets. */
const BLOCKED_V4: Array<[[number, number, number, number], number]> = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24], // documentation (TEST-NET-1)
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24], // documentation (TEST-NET-2)
  [[203, 0, 113, 0], 24], // documentation (TEST-NET-3)
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

const toInt = ([a, b, c, d]: number[]): number =>
  (((a as number) << 24) | ((b as number) << 16) | ((c as number) << 8) | (d as number)) >>> 0;

export function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

export function isBlockedIPv4(octets: number[]): boolean {
  const ip = toInt(octets);
  return BLOCKED_V4.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) >>> 0 === (toInt(net) & mask) >>> 0;
  });
}

/** Expands an IPv6 literal (without brackets) to 16 bytes, or null when it is not valid. */
export function parseIPv6(host: string): number[] | null {
  let h = host.toLowerCase();
  const zone = h.indexOf('%');
  if (zone >= 0) h = h.slice(0, zone);
  // An embedded dotted IPv4 tail (::ffff:127.0.0.1) becomes two hex groups.
  const tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (tail) {
    const v4 = parseIPv4(tail[1] as string);
    if (!v4) return null;
    const group = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
    const [a, b, c, d] = v4 as [number, number, number, number];
    h = `${h.slice(0, tail.index)}:${group(a, b)}:${group(c, d)}`;
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string): string[] | null => (s === '' ? [] : s.split(':'));
  const head = toGroups(halves[0] as string) as string[];
  const rest = halves.length === 2 ? (toGroups(halves[1] as string) as string[]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups =
    halves.length === 1 ? head : [...head, ...new Array<string>(missing).fill('0'), ...rest];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = Number.parseInt(g, 16);
    bytes.push(v >> 8, v & 0xff);
  }
  return bytes;
}

/** True for loopback, unspecified, unique-local, link-local, multicast, documentation, and for
 *  IPv4-mapped / compatible / NAT64 / 6to4 addresses that embed a blocked IPv4 address. */
export function isBlockedIPv6(b: number[]): boolean {
  const g = (i: number) => b[i] as number;
  if (b.slice(0, 15).every((x) => x === 0) && (g(15) === 0 || g(15) === 1)) return true; // :: and ::1
  if ((g(0) & 0xfe) === 0xfc) return true; // fc00::/7
  if (g(0) === 0xfe && (g(1) & 0xc0) === 0x80) return true; // fe80::/10
  if (g(0) === 0xff) return true; // ff00::/8 multicast
  if (g(0) === 0x20 && g(1) === 0x01 && g(2) === 0x0d && g(3) === 0xb8) return true; // 2001:db8::/32
  const v4 = (offset: number) =>
    isBlockedIPv4([g(offset), g(offset + 1), g(offset + 2), g(offset + 3)]);
  const zeros = (n: number) => b.slice(0, n).every((x) => x === 0);
  if (zeros(10) && g(10) === 0xff && g(11) === 0xff) return v4(12); // ::ffff:a.b.c.d (mapped)
  if (zeros(12)) return v4(12); // ::a.b.c.d (compatible)
  if (
    g(0) === 0x00 &&
    g(1) === 0x64 &&
    g(2) === 0xff &&
    g(3) === 0x9b &&
    b.slice(4, 12).every((x) => x === 0)
  )
    return v4(12); // 64:ff9b::/96 (NAT64)
  if (g(0) === 0x20 && g(1) === 0x02) return v4(2); // 2002::/16 (6to4)
  return false;
}

/** Checks scheme, credentials, port and host. Used for the first URL and for every redirect hop. */
export function assertTargetAllowed(url: URL, selfHostname: string): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyError('INVALID_URL', 'Only http and https URLs can be fetched');
  }
  if (url.username || url.password) {
    throw new ProxyError('INVALID_URL', 'URLs with credentials are not allowed');
  }
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new ProxyError('FORBIDDEN_TARGET', 'Only the default web ports are allowed');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') throw new ProxyError('INVALID_URL', 'The URL has no host');

  if (host.startsWith('[')) {
    // Every IPv6 literal is refused: news sites do not need them, and the private ranges are
    // checked anyway so the reason is accurate.
    const bytes = parseIPv6(host.slice(1, -1));
    if (!bytes || isBlockedIPv6(bytes)) {
      throw new ProxyError('FORBIDDEN_TARGET', 'Private or reserved addresses are not allowed');
    }
    throw new ProxyError('FORBIDDEN_TARGET', 'IPv6 addresses are not supported');
  }

  const v4 = parseIPv4(host);
  if (v4) {
    if (isBlockedIPv4(v4)) {
      throw new ProxyError('FORBIDDEN_TARGET', 'Private or reserved addresses are not allowed');
    }
    return;
  }

  if (host === 'localhost' || FORBIDDEN_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new ProxyError('FORBIDDEN_TARGET', 'Local hostnames are not allowed');
  }
  if (!host.includes('.')) {
    throw new ProxyError('FORBIDDEN_TARGET', 'Single-label hostnames are not allowed');
  }
  if (host === selfHostname.toLowerCase().replace(/\.$/, '')) {
    throw new ProxyError('FORBIDDEN_TARGET', 'The proxy cannot fetch itself');
  }
}

/** Parses the `url` query parameter and applies all guards. The fragment is dropped. */
export function parseTarget(raw: string | null, selfHostname: string): URL {
  if (!raw || raw.length > 4096) throw new ProxyError('INVALID_URL', 'Missing or malformed url');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProxyError('INVALID_URL', 'Missing or malformed url');
  }
  assertTargetAllowed(url, selfHostname);
  url.hash = '';
  return url;
}
