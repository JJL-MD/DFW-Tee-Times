/**
 * Vault health check — light probe to detect expired/invalid cookies.
 *
 * Per-provider strategy:
 *   - GolfNow / TeeOff: GET a known authenticated endpoint, expect 200
 *   - ForeUp:           GET /index.php/api/booking/times?course_id=X&date=today with cookies
 *   - Chronogolf:       GET /api/v2/me with cookies
 *
 * Returns { provider, ok, message, expiresAt? } for each entry.
 */
import { VaultStorage } from "./storage";
import type { Provider } from "../types";
import type { Fetcher } from "../adapters/fetcher";

export interface HealthResult {
  provider: Provider;
  ok: boolean;
  message: string;
  expiresAt: number | null;
}

const PROBE_URLS: Partial<Record<Provider, (providerCourseId: string) => string>> = {
  golfnow: () => "https://www.golfnow.com/api/profile",
  teeoff: () => "https://www.teeoff.com/api/profile",
  chronogolf: () => "https://www.chronogolf.com/api/v2/me",
  foreup: () => "https://foreupsoftware.com/index.php/booking",
};

export async function checkVaultHealth(
  storage: VaultStorage,
  masterKeyHex: string,
  fetcher: Fetcher,
  /** Sample provider course id for the cookie-bearing probe */
  sampleProviderCourseIds: Partial<Record<Provider, string>>,
): Promise<HealthResult[]> {
  const rows = await storage.list();
  const results: HealthResult[] = [];

  for (const row of rows) {
    const cookies = await storage.getCookies(row.provider, masterKeyHex);
    if (!cookies) {
      results.push({
        provider: row.provider,
        ok: false,
        message: "no cookies",
        expiresAt: row.expiresAt,
      });
      continue;
    }

    const probeBuilder = PROBE_URLS[row.provider];
    if (!probeBuilder) {
      results.push({
        provider: row.provider,
        ok: true,
        message: "no probe defined — skipping",
        expiresAt: row.expiresAt,
      });
      continue;
    }

    const sampleId = sampleProviderCourseIds[row.provider];
    if (!sampleId && row.provider !== "chronogolf") {
      results.push({
        provider: row.provider,
        ok: true,
        message: "no sample course id — skipping",
        expiresAt: row.expiresAt,
      });
      continue;
    }

    const url = probeBuilder(sampleId ?? "");
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    try {
      const res = await fetcher({
        url,
        headers: { Cookie: cookieHeader },
        timeoutMs: 5000,
      });
      const ok = res.status >= 200 && res.status < 400;
      // Detect common auth-failure signals
      const looksLoggedOut =
        res.body.includes("Sign In") ||
        res.body.includes("Log In") ||
        res.body.includes('"isAuthenticated":false');
      results.push({
        provider: row.provider,
        ok: ok && !looksLoggedOut,
        message: ok && !looksLoggedOut
          ? `HTTP ${res.status}`
          : looksLoggedOut
            ? "logged-out indicator in response"
            : `HTTP ${res.status}`,
        expiresAt: row.expiresAt,
      });
    } catch (err) {
      results.push({
        provider: row.provider,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        expiresAt: row.expiresAt,
      });
    }
  }

  return results;
}