import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index.ts';

const call = (path: string) => worker.fetch(new Request(`http://proxy.test${path}`), env as Env);

describe('GET /health', () => {
  it('returns ok and a version', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 'dev' });
  });

  it('answers unknown paths with a JSON 404', async () => {
    const res = await call('/nope');
    expect(res.status).toBe(404);
  });
});
