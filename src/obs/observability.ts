/**
 * Observability — Workers Analytics Engine.
 *
 * Writes structured event records that wrangler tail / logpush can route.
 * Indexes:
 *   - blob1: provider or "*"
 *   - blob2: event type ("scrape", "book", "vault", "daemon")
 *   - blob3: outcome ("ok", "fail", "stale", "skip")
 *   - blob4: course_id (or "*")
 *   - blob5: courseId+provider correlation
 *   - double1: durationMs
 *   - double2: count
 *   - double3: teeTimeCount
 */

export type ObsEventType = "scrape" | "book" | "vault" | "daemon" | "cache";
export type ObsOutcome = "ok" | "fail" | "stale" | "skip" | "miss" | "expired";

export interface ObsEvent {
  type: ObsEventType;
  outcome: ObsOutcome;
  provider?: string;
  courseId?: string;
  durationMs?: number;
  teeTimeCount?: number;
  message?: string;
}

export interface AnalyticsEngineDataset {
  writeDataPoint(event?: AnalyticsEngineDataPoint): void;
}

export interface AnalyticsEngineDataPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

export class Observability {
  /** No-op sink for tests + local dev where AE isn't bound. */
  static noop: Observability = new Observability(undefined);

  private readonly ae?: AnalyticsEngineDataset;

  constructor(ae?: AnalyticsEngineDataset) {
    this.ae = ae;
  }

  emit(ev: ObsEvent): void {
    if (!this.ae) return; // silent in dev
    const blobs: string[] = [
      ev.provider ?? "*",
      ev.type,
      ev.outcome,
      ev.courseId ?? "*",
      `${ev.provider ?? "*"}:${ev.courseId ?? "*"}`,
    ];
    // Pad to 8 with empty strings (Analytics Engine expects fixed length)
    while (blobs.length < 8) blobs.push("");
    const doubles: number[] = [
      ev.durationMs ?? 0,
      1,
      ev.teeTimeCount ?? 0,
      0,
      0,
      0,
      0,
      0,
    ];
    try {
      this.ae!.writeDataPoint({
        blobs,
        doubles,
        indexes: [ev.type, ev.provider ?? "*"],
      });
    } catch (err) {
      console.error("obs_emit_failed", err);
    }
  }

  /**
   * Convenience: time an async function and emit an event with its duration.
   */
  async timed<T>(
    type: ObsEventType,
    outcome: ObsOutcome,
    provider: string | undefined,
    fn: () => Promise<T>,
    extra?: Omit<ObsEvent, "type" | "outcome" | "provider" | "durationMs">,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.emit({
        type,
        outcome,
        provider,
        durationMs: Date.now() - start,
        ...extra,
      });
      return result;
    } catch (err) {
      this.emit({
        type,
        outcome: "fail",
        provider,
        durationMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
        ...extra,
      });
      throw err;
    }
  }
}