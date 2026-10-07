/**
 * Fallback host — minimal entrypoint. Real implementation lives in a
 * separate Node service (see README.md). This stub exists so the Worker
 * has a documented contract to call against.
 *
 * Production deploy: Fly.io / Railway / VPS.
 * Local dev: `cd fallback-host && npm install && npm run dev` on port 8788.
 */
export interface FallbackHost {
  health(): Promise<{ ok: boolean; message?: string }>;
}

export function makeFallbackHost(baseUrl: string, token: string): FallbackHost {
  return {
    async health() {
      try {
        const res = await fetch(`${baseUrl}/healthz`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return { ok: res.ok, message: `HTTP ${res.status}` };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}