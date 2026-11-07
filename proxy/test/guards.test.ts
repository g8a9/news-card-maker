import { describe, expect, it } from 'vitest';
import { ProxyError } from '../src/errors.ts';
import { isBlockedIPv6, parseIPv6, parseTarget } from '../src/guards.ts';

const SELF = 'proxy.test';

function codeOf(raw: string | null): string | null {
  try {
    parseTarget(raw, SELF);
    return null;
  } catch (e) {
    return e instanceof ProxyError ? e.code : `unexpected:${String(e)}`;
  }
}

describe('parseTarget: accepted targets', () => {
  it.each([
    'https://www.theguardian.com/world/2026/nov/06/story',
    'http://example.com/',
    'https://example.com:443/path',
    'http://example.com:80/path',
    'https://example.com:80/odd-but-allowed',
    'https://xn--bcher-kva.example/',
    'https://8.8.8.8/',
    'https://172.15.255.255/',
    'https://172.32.0.1/',
    'https://100.63.255.255/',
    'https://100.128.0.1/',
    'https://198.17.255.255/',
    'https://198.20.0.1/',
    'https://169.253.1.1/',
    'https://192.0.1.1/',
  ])('allows %s', (url) => {
    expect(codeOf(url)).toBeNull();
  });

  it('drops the fragment and keeps the query', () => {
    expect(parseTarget('https://example.com/a?id=7#ref=rss', SELF).href).toBe(
      'https://example.com/a?id=7',
    );
  });
});

describe('parseTarget: malformed input is INVALID_URL', () => {
  it.each([
    [null],
    [''],
    ['   '],
    ['not a url'],
    ['/relative/path'],
    ['ftp://example.com/file'],
    ['file:///etc/passwd'],
    ['javascript:alert(1)'],
    ['data:text/html,<p>hi</p>'],
    ['https://user:pass@example.com/'],
    ['https://user@example.com/'],
    [`https://example.com/${'a'.repeat(5000)}`],
  ])('rejects %s', (url) => {
    expect(codeOf(url)).toBe('INVALID_URL');
  });
});

describe('parseTarget: reserved targets are FORBIDDEN_TARGET', () => {
  // Boundaries of every IPv4 range in PLAN.md §4.3 (first and last address of each).
  it.each([
    '0.0.0.0',
    '0.255.255.255',
    '10.0.0.0',
    '10.255.255.255',
    '100.64.0.0',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.0.0',
    '169.254.169.254',
    '172.16.0.0',
    '172.31.255.255',
    '192.0.0.0',
    '192.0.0.255',
    '192.168.0.0',
    '192.168.255.255',
    '198.18.0.0',
    '198.19.255.255',
    '224.0.0.0',
    '239.255.255.255',
    '240.0.0.0',
    '255.255.255.255',
  ])('blocks the IPv4 literal %s', (ip) => {
    expect(codeOf(`http://${ip}/`)).toBe('FORBIDDEN_TARGET');
  });

  it.each([
    ['decimal', 'http://2130706433/'],
    ['hex', 'http://0x7f000001/'],
    ['octal dotted', 'http://0177.0.0.1/'],
    ['short form', 'http://127.1/'],
    ['mixed radix', 'http://0x7f.0.0.1/'],
  ])('blocks %s spellings of loopback', (_label, url) => {
    expect(codeOf(url)).toBe('FORBIDDEN_TARGET');
  });

  it.each([
    'http://[::1]/',
    'http://[::]/',
    'http://[fc00::1]/',
    'http://[fd12:3456:789a::1]/',
    'http://[fe80::1]/',
    'http://[febf::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:10.1.2.3]/',
    'http://[::ffff:7f00:1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[2002:7f00:1::]/',
    'http://[ff02::1]/',
    'http://[2001:db8::1]/',
    'http://[2606:4700:4700::1111]/', // a public address: IPv6 literals are not supported at all
  ])('blocks the IPv6 literal %s', (url) => {
    expect(codeOf(url)).toBe('FORBIDDEN_TARGET');
  });

  it.each([
    'http://localhost/',
    'http://LOCALHOST:80/',
    'http://localhost./',
    'http://foo.localhost/',
    'http://printer.local/',
    'http://db.internal/',
    'http://router.home.arpa/',
    'http://intranet/',
    'http://proxy.test/api/text',
    'http://PROXY.test./',
  ])('blocks the hostname in %s', (url) => {
    expect(codeOf(url)).toBe('FORBIDDEN_TARGET');
  });

  it.each(['https://example.com:8443/', 'http://example.com:8080/', 'http://example.com:22/'])(
    'blocks the port in %s',
    (url) => {
      expect(codeOf(url)).toBe('FORBIDDEN_TARGET');
    },
  );
});

describe('IPv6 helpers', () => {
  const blocked = (s: string) => isBlockedIPv6(parseIPv6(s) as number[]);

  it('parses compressed, full and dotted forms', () => {
    expect(parseIPv6('::1')).toEqual([...new Array(15).fill(0), 1]);
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toEqual([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8]);
    expect(parseIPv6('::ffff:1.2.3.4')).toEqual(parseIPv6('::ffff:102:304'));
    expect(parseIPv6('1::2::3')).toBeNull();
    expect(parseIPv6('12345::')).toBeNull();
    expect(parseIPv6('1:2:3')).toBeNull();
  });

  it('flags private, reserved and embedded-private ranges', () => {
    for (const ip of ['::', '::1', 'fc00::', 'fdff::1', 'fe80::', 'febf:ffff::1', 'ff00::1']) {
      expect(blocked(ip), ip).toBe(true);
    }
    for (const ip of ['::ffff:127.0.0.1', '::ffff:192.168.0.1', '::127.0.0.1', '64:ff9b::a00:1']) {
      expect(blocked(ip), ip).toBe(true);
    }
  });

  it('lets global addresses through', () => {
    for (const ip of [
      '2606:4700:4700::1111',
      '2a00:1450:4001::1',
      '::ffff:8.8.8.8',
      '64:ff9b::808:808',
    ]) {
      expect(blocked(ip), ip).toBe(false);
    }
  });
});
