/**
 * Login-harvest — proxies username/password to the Playwright fallback host,
 * which logs in via real browser and returns session cookies. The Worker
 * never persists the password; only the resulting cookies are encrypted.
 */
import type { Provider, VaultCookie } from "../types";

export interface HarvestRequest {
  provider: Provider;
  username: string;
  password: string;
}

export interface HarvestResponse {
  cookies: VaultCookie[];
}

export class HarvestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "HarvestError";
  }
}

export async function harvestCookies(
  baseUrl: string,
  token: string,
  req: HarvestRequest,
): Promise<HarvestResponse> {
  const res = await fetch(`${baseUrl}/harvest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new HarvestError(
      `harvest failed: HTTP ${res.status} ${await res.text().catch(() => "")}`,
      res.status,
    );
  }
  const data = (await res.json()) as HarvestResponse;
  if (!data.cookies || !Array.isArray(data.cookies)) {
    throw new HarvestError("harvest returned no cookies");
  }
  return data;
}