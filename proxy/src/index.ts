// M0 placeholder: only /health. The full /api/text and /api/image contract lands in M1.

export interface Env {
  ALLOWED_ORIGINS: string;
  USER_AGENT: string;
  MAX_TEXT_BYTES: string;
  MAX_IMAGE_BYTES: string;
  VERSION?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (origin && allowed.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers.Vary = 'Origin';
    }
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, version: env.VERSION ?? 'dev' }), { headers });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
      status: 404,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
