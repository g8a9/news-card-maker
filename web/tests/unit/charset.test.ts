import { describe, expect, it } from 'vitest';
import { decodeBytes } from '../../src/core/charset.ts';
import { readFixture } from './helpers.ts';

const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('decodeBytes (PLAN.md §5.2)', () => {
  it('defaults to UTF-8', () => {
    expect(decodeBytes(utf8('<html>Città 日本</html>'), 'text/html')).toEqual({
      text: '<html>Città 日本</html>',
      charset: 'utf-8',
    });
  });

  it('honours charset= in the upstream Content-Type', () => {
    const out = decodeBytes(latin1('<html>Citt\xe0</html>'), 'text/html; charset=ISO-8859-1');
    expect(out.text).toBe('<html>Città</html>');
  });

  it('reads <meta charset> and the http-equiv form from the first 4096 bytes', () => {
    const a = decodeBytes(
      latin1('<html><head><meta charset="iso-8859-1"></head>Citt\xe0'),
      'text/html',
    );
    expect(a.text.endsWith('Città')).toBe(true);
    const b = decodeBytes(
      latin1('<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">Citt\xe0'),
      'text/html',
    );
    expect(b.text.endsWith('Città')).toBe(true);
    const c = decodeBytes(latin1('<meta charset=windows-1252>caf\xe9'), 'text/html');
    expect(c.text.endsWith('café')).toBe(true);
  });

  it('prefers the HTTP header over the meta tag', () => {
    const out = decodeBytes(utf8('<meta charset="iso-8859-1">Città'), 'text/html; charset=utf-8');
    expect(out.text.endsWith('Città')).toBe(true);
  });

  it('ignores a meta tag that appears after the first 4096 bytes', () => {
    const bytes = latin1(`<html>${' '.repeat(5000)}<meta charset="iso-8859-1">Citt\xe0`);
    expect(decodeBytes(bytes, 'text/html').charset).toBe('utf-8');
  });

  it('lets a BOM win', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('<p>é</p>')]);
    expect(decodeBytes(bytes, 'text/html; charset=iso-8859-1').text).toBe('<p>é</p>');
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[...'<p>hi</p>'].flatMap((c) => [c.charCodeAt(0), 0]),
    ]);
    expect(decodeBytes(utf16, 'text/html').text).toBe('<p>hi</p>');
  });

  it('reads the XML declaration for feeds', () => {
    const xml = latin1(
      '<?xml version="1.0" encoding="ISO-8859-1"?><rss><title>Citt\xe0</title></rss>',
    );
    expect(decodeBytes(xml, 'application/rss+xml').text).toContain('Città');
  });

  it('does not look for <meta charset> in JSON', () => {
    const json = utf8('{"name":"<meta charset=iso-8859-1>é"}');
    expect(decodeBytes(json, 'application/json').text).toContain('é');
  });

  it('falls back to UTF-8 for unknown labels', () => {
    const out = decodeBytes(utf8('Città'), 'text/html; charset=klingon-9');
    expect(out).toEqual({ text: 'Città', charset: 'utf-8' });
  });

  it('decodes Shift_JIS', () => {
    // "日本語" in Shift_JIS
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
    const bytes = new Uint8Array([...latin1('<meta charset="Shift_JIS">'), ...sjis]);
    expect(decodeBytes(bytes, 'text/html').text.endsWith('日本語')).toBe(true);
  });

  it('decodes the ISO-8859-1 fixture page', () => {
    const { bytes } = readFixture('corriera-like-latin1.html');
    const { text, charset } = decodeBytes(bytes, 'text/html');
    expect(charset).toBe('windows-1252'); // the WHATWG name for the iso-8859-1 label
    expect(text).toContain('Città, il ponte resta chiuso');
  });
});
