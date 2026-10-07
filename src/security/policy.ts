/**
 * TOS policy — runtime guard rails so the auto-book daemon refuses
 * providers that are explicitly off-limits without an explicit override.
 *
 * Defaults to PERSONAL_READ_ONLY mode. Operators who have negotiated
 * provider partnerships (Affiliate API, partner agreements) can flip
 * individual providers to AUTO_BOOK_ALLOWED.
 */

export type ProviderPolicy = "personal_read_only" | "auto_book_allowed";

const DEFAULT_POLICIES: Record<string, ProviderPolicy> = {
  golfnow: "personal_read_only",
  teeoff: "personal_read_only",
  chronogolf: "personal_read_only",
  foreup: "personal_read_only",
  miclub: "personal_read_only",
  quick18: "personal_read_only",
  lightspeed: "personal_read_only",
  clubprophet: "personal_read_only",
  ezlinks: "personal_read_only",
  course_direct: "personal_read_only",
};

export class PolicyStore {
  private policies: Map<string, ProviderPolicy>;

  constructor(overrides?: Partial<Record<string, ProviderPolicy>>) {
    const merged: Record<string, ProviderPolicy> = { ...DEFAULT_POLICIES };
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined) merged[k] = v;
      }
    }
    this.policies = new Map(Object.entries(merged));
  }

  allow(provider: string): boolean {
    return this.policies.get(provider) === "auto_book_allowed";
  }

  set(provider: string, policy: ProviderPolicy): void {
    this.policies.set(provider, policy);
  }

  get(provider: string): ProviderPolicy {
    return this.policies.get(provider) ?? "personal_read_only";
  }

  list(): Array<{ provider: string; policy: ProviderPolicy }> {
    return Array.from(this.policies.entries()).map(([provider, policy]) => ({
      provider,
      policy,
    }));
  }
}

/**
 * Throw if a scheduled booking's provider isn't allowed to auto-book.
 * The daemon calls this before invoking any executor.
 */
export class PolicyViolation extends Error {
  constructor(
    public readonly provider: string,
    public readonly policy: ProviderPolicy,
  ) {
    super(
      `provider '${provider}' has policy '${policy}' — ` +
        `bookings are not auto-executed; link out to the provider instead`,
    );
    this.name = "PolicyViolation";
  }
}

export function enforceBookingPolicy(
  store: PolicyStore,
  provider: string,
): void {
  if (!store.allow(provider)) {
    throw new PolicyViolation(provider, store.get(provider));
  }
}