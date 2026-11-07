import { describe, expect, it } from 'vitest';
import { call } from './helpers.ts';

describe('GET /health', () => {
  it('returns ok and a version', async () => {
    const res = await call('/health', { origin: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 'dev' });
  });

  it('reports the deployed version', async () => {
    const res = await call('/health', { env: { VERSION: 'abc1234' } });
    expect(await res.json()).toEqual({ ok: true, version: 'abc1234' });
  });

  it('sends CORS headers to allowed origins only', async () => {
    const allowed = await call('/health');
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    const other = await call('/health', { origin: 'https://evil.example' });
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
