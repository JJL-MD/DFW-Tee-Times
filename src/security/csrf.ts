/**
 * Security — CSRF tokens, rate limiting, vault hardening helpers.
 *
 * CSRF: each form-rendering route generates a token bound to a session
 * secret. The form submits with the token; the POST handler validates it.
 * Single-user system uses a fixed CSRF_SECRET from Workers Secrets.
 *
 * Rate limit: per-IP leaky bucket. Tokens replenish over time.
 * Used for vault endpoints (paste, harvest, delete) to discourage abuse
 * even though the app is single-user.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface CsrfConfig {
  secret: string;
  /** Token TTL in ms (default 1 hour) */
  ttlMs?: number;
  /** Override for tests */
  now?: () => number;
}

export class CsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsrfError";
  }
}

export function generateCsrfToken(
  cfg: CsrfConfig,
  sessionId: string = "default",
): string {
  const now = (cfg.now ?? Date.now)();
  const exp = now + (cfg.ttlMs ?? 3_600_000);
  const payload = `${sessionId}:${exp}`;
  const sig = createHmac("sha256", cfg.secret).update(payload).digest("hex");
  // base64 the (payload|exp|sig) so it's URL-safe in a hidden field
  return btoa(`${payload}|${sig}`);
}

export function validateCsrfToken(
  cfg: CsrfConfig,
  token: string,
  sessionId: string = "default",
): boolean {
  try {
    const decoded = atob(token);
    const [payload, sig] = decoded.split("|");
    if (!payload || !sig) return false;
    const expectedSig = createHmac("sha256", cfg.secret)
      .update(payload)
      .digest("hex");
    // timingSafeEqual requires equal-length buffers
    const a = new Uint8Array(Buffer.from(sig, "hex"));
    const b = new Uint8Array(Buffer.from(expectedSig, "hex"));
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
    const [_sid, expStr] = payload.split(":");
    const exp = Number(expStr);
    if (!Number.isFinite(exp)) return false;
    return exp > (cfg.now ?? Date.now)();
  } catch {
    return false;
  }
}

/**
 * Leaky-bucket rate limiter — tracks per-key request timestamps.
 * Returns true if request should be allowed.
 */
export class RateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(
    private readonly capacity: number = 10,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.buckets.get(key) ?? [];
    // Drop expired
    const fresh = timestamps.filter((t) => t > cutoff);
    if (fresh.length >= this.capacity) {
      this.buckets.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.buckets.set(key, fresh);
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Test-only inspection */
  size(key: string): number {
    return this.buckets.get(key)?.length ?? 0;
  }
}

/**
 * Constant-time string equality — defense against timing attacks on
 * tokens/secret comparisons.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = new Uint8Array(Buffer.from(a));
  const bb = new Uint8Array(Buffer.from(b));
  return timingSafeEqual(ab, bb);
}

/**
 * Mask a master key for logging — show first 4 + last 4 hex chars only.
 */
export function maskKey(hex: string): string {
  if (hex.length <= 8) return "****";
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}