import { describe, expect, it } from 'vitest';
import { checkHealth } from '../../src/health.ts';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('checkHealth', () => {
  it('reports ok and the version', async () => {
    const seen: string[] = [];
    const fetchImpl = ((url: string) => {
      seen.push(url);
      return json({ ok: true, version: 'abc123' });
    }) as unknown as typeof fetch;
    expect(await checkHealth('http://proxy.test', fetchImpl)).toEqual({
      ok: true,
      version: 'abc123',
    });
    expect(seen).toEqual(['http://proxy.test/health']);
  });

  it('reports not ok on HTTP errors and network failures', async () => {
    const bad = (() => json({ ok: false }, 500)) as unknown as typeof fetch;
    const down = (() => Promise.reject(new TypeError('network'))) as unknown as typeof fetch;
    expect(await checkHealth('http://proxy.test', bad)).toEqual({ ok: false });
    expect(await checkHealth('http://proxy.test', down)).toEqual({ ok: false });
  });
});
