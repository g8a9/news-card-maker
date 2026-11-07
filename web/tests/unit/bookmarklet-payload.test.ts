// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodePayload, encodePayload, type Payload } from '../../src/bookmarklet/payload.ts';
import { hasBookmarklet, readBookmarklet } from '../../src/bookmarklet/receive.ts';

const sample: Payload = {
  v: 1,
  url: 'https://www.example.com/news/story?id=1',
  html: '<!doctype html><title>Çà et là — “titolo” 日本語 🙂</title>'.repeat(40),
};

describe('bookmarklet payload', () => {
  it('round-trips through deflate-raw and base64url, including non-ASCII text', async () => {
    const encoded = await encodePayload(sample);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodePayload(encoded)).toEqual(sample);
  });

  it('is much smaller than the HTML it carries', async () => {
    const encoded = await encodePayload(sample);
    expect(encoded.length).toBeLessThan(JSON.stringify(sample).length / 4);
  });

  it('reads the fragment the bookmarklet writes', async () => {
    const encoded = await encodePayload(sample);
    expect(hasBookmarklet(`#bm=${encoded}`)).toBe(true);
    expect(hasBookmarklet('#other')).toBe(false);
    expect(await readBookmarklet(`#bm=${encoded}`)).toEqual(sample);
    expect(await readBookmarklet('')).toBeNull();
  });

  it('refuses data that is not valid', async () => {
    await expect(decodePayload('not base64 at all !!')).rejects.toThrow(/not valid/);
    await expect(decodePayload('AAAA')).rejects.toThrow(/not valid/);
    await expect(decodePayload('')).rejects.toThrow(/not valid/);
  });

  it('refuses another version, a missing field or a non-http address', async () => {
    const bad = async (value: unknown) => {
      const text = await encodePayload(value as Payload);
      return expect(decodePayload(text)).rejects.toThrow(/not valid/);
    };
    await bad({ ...sample, v: 2 });
    await bad({ v: 1, url: sample.url });
    await bad({ v: 1, html: sample.html });
    await bad({ ...sample, url: 'javascript:alert(1)' });
    await bad({ ...sample, url: 'file:///etc/passwd' });
    await bad({ ...sample, url: 'not a url' });
  });

  it('stops inflating past the size cap (a decompression bomb)', async () => {
    const bomb = await encodePayload({ ...sample, html: 'a'.repeat(5_000_000) });
    expect(bomb.length).toBeLessThan(20_000);
    await expect(decodePayload(bomb)).rejects.toThrow(/too large/);
    await expect(decodePayload(bomb, 10_000_000)).resolves.toMatchObject({ v: 1 });
  });
});
