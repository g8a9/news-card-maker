export interface Health {
  ok: boolean;
  version?: string;
}

/** Ask the proxy whether it is up. Never throws: a failure is reported as `{ ok: false }`. */
export async function checkHealth(
  base: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<Health> {
  try {
    const res = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { ok?: unknown; version?: unknown };
    return {
      ok: body.ok === true,
      version: typeof body.version === 'string' ? body.version : undefined,
    };
  } catch {
    return { ok: false };
  }
}
