/**
 * Scrape runner.
 *
 * Pulls a set of (provider, providerCourseId) jobs and fans them out
 * across registered adapters with:
 *   - per-host concurrency cap (default 1, configurable)
 *   - per-job timeout (default 5s)
 *   - jittered start to avoid synchronized spikes
 *   - error isolation: one bad course never kills the batch
 *
 * Returns ScrapeResult (tee times + per-course errors).
 */
import { getAdapter } from "../adapters";
import type { TeeTimeAdapter, ScrapeContext } from "../adapters/types";
import {
  ScrapeErrorSchema,
  ScrapeResultSchema,
  makeTeeTimeId,
} from "../types";
import type {
  Provider,
  ScrapeError,
  ScrapeResult,
  TeeTime,
} from "../types";

export interface ScrapeJob {
  provider: Provider;
  providerCourseId: string;
  courseId: string;
}

export interface RunnerConfig {
  /** max concurrent jobs per provider host (default 1) */
  concurrencyPerHost?: number;
  /** per-job timeout in ms (default 5000) */
  timeoutMs?: number;
  /** random jitter window in ms applied to each job start (default 100) */
  jitterMs?: number;
}

export interface RunnerDeps {
  /** Override for tests — defaults to registry lookup */
  resolveAdapter?: (id: Provider) => TeeTimeAdapter | undefined;
  /** Override for tests */
  sleep?: (ms: number) => Promise<void>;
  /** Override for tests */
  now?: () => number;
}

const DEFAULT_CONFIG: Required<RunnerConfig> = {
  concurrencyPerHost: 1,
  timeoutMs: 5000,
  jitterMs: 100,
};

export async function runScrape(
  date: string,
  players: number,
  timezone: string,
  jobs: ScrapeJob[],
  config: RunnerConfig = {},
  deps: RunnerDeps = {},
): Promise<ScrapeResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const resolve = deps.resolveAdapter ?? getAdapter;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const start = now();

  // Bucket jobs by host (provider) for concurrency cap.
  const buckets = new Map<Provider, ScrapeJob[]>();
  for (const j of jobs) {
    if (!buckets.has(j.provider)) buckets.set(j.provider, []);
    buckets.get(j.provider)!.push(j);
  }

  const teeTimes: TeeTime[] = [];
  const errors: ScrapeError[] = [];

  // Run each bucket with its own concurrency cap.
  await Promise.all(
    Array.from(buckets.entries()).map(async ([provider, providerJobs]) => {
      const adapter = resolve(provider);
      if (!adapter) {
        for (const j of providerJobs) {
          errors.push(
            ScrapeErrorSchema.parse({
              provider,
              courseId: j.courseId,
              date,
              message: `no adapter registered for provider '${provider}'`,
              occurredAt: now(),
            }),
          );
        }
        return;
      }

      // Simple semaphore: at most N concurrent per host.
      let inFlight = 0;
      const waiters: Array<() => void> = [];
      const acquire = async () => {
        if (inFlight < cfg.concurrencyPerHost) {
          inFlight++;
          return;
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
        inFlight++;
      };
      const release = () => {
        inFlight--;
        const next = waiters.shift();
        if (next) next();
      };

      const ctxBase: ScrapeContext = { date, players, timezone };

      const taskFor = async (job: ScrapeJob) => {
        await acquire();
        try {
          // Jitter: randomize start time to avoid synchronized spikes.
          if (cfg.jitterMs > 0) {
            await sleep(Math.random() * cfg.jitterMs);
          }
          // Pass the signal into the adapter (best-effort cancellation)
          // AND race the adapter call against a hard timer so adapters
          // that ignore the signal still time out cleanly.
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
          try {
            const tt = await Promise.race([
              adapter.fetchAvailability(job.providerCourseId, {
                ...ctxBase,
                signal: controller.signal,
              }),
              new Promise<never>((_, reject) => {
                // Hard timer — runs even if the adapter ignores the signal.
                setTimeout(() => reject(new Error("__timeout__")), cfg.timeoutMs);
              }),
            ]);
            for (const t of tt) {
              // Defensive: stamp the canonical courseId and rebuild the
              // composite id so downstream consumers can dedup safely.
              const stamped: TeeTime = {
                ...t,
                courseId: job.courseId,
                id: makeTeeTimeId(t.provider, t.providerCourseId, t.timeEpochMs),
                scrapedAt: now(),
              };
              teeTimes.push(stamped);
            }
          } finally {
            clearTimeout(timer);
          }
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message === "__timeout__"
                ? `timeout after ${cfg.timeoutMs}ms`
                : err.message
              : String(err);
          errors.push(
            ScrapeErrorSchema.parse({
              provider,
              courseId: job.courseId,
              date,
              message,
              occurredAt: now(),
            }),
          );
        } finally {
          release();
        }
      };

      await Promise.all(providerJobs.map(taskFor));
    }),
  );

  const result: ScrapeResult = ScrapeResultSchema.parse({
    date,
    teeTimes,
    errors,
    durationMs: now() - start,
  });
  return result;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}