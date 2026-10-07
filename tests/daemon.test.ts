import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StubExecutor,
  ExecutorRegistry,
  IdempotencyCache,
} from "../src/booking/executor";
import { runDaemonTick } from "../src/daemon/scheduler";
import { VaultStorage } from "../src/vault/storage";
import { TeeTimeCache } from "../src/cache/tee-time-cache";
import { TeeTimeSchema, makeTeeTimeId } from "../src/types";
import type { TeeTime } from "../src/types";

const NOW = 1_700_000_000_000;
const MASTER =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeD1(): D1Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(process.cwd(), "migrations", "0001_init.sql"), "utf8"));
  const stub = {
    prepare(sql: string) {
      // D1 contract: each bind() returns a fresh, independently-bindable
      // statement. better-sqlite3 binds are one-shot per Statement, so
      // we re-prepare the SQL on every bind() to honor D1's semantics.
      return {
        bind(...args: unknown[]) {
          return {
            async all<T = Record<string, unknown>>() {
              const rows = db.prepare(sql).bind(...args).all() as T[];
              return { results: rows ?? [], success: true, meta: {} };
            },
            async first<T = Record<string, unknown>>() {
              const r = db.prepare(sql).bind(...args).get() as T | undefined;
              return r ?? null;
            },
            async run() {
              db.prepare(sql).bind(...args).run();
              return { success: true, meta: {} };
            },
          };
        },
        async all<T = Record<string, unknown>>() {
          const rows = db.prepare(sql).all() as T[];
          return { results: rows ?? [], success: true, meta: {} };
        },
        async first<T = Record<string, unknown>>() {
          return (db.prepare(sql).get() as T | undefined) ?? null;
        },
        async run() {
          db.prepare(sql).run();
          return { success: true, meta: {} };
        },
      };
    },
  };
  return stub as unknown as D1Database;
}

function makeKV(): KVNamespace {
  const data = new Map<string, string>();
  return {
    get: async (k: string, t?: "json" | "text") => {
      const v = data.get(k);
      if (v == null) return null;
      if (t === "json") return JSON.parse(v);
      return v;
    },
    put: async (k: string, v: string) => {
      data.set(k, v);
    },
    delete: async (k: string) => {
      data.delete(k);
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
  } as unknown as KVNamespace;
}

async function seedScheduledBooking(
  db: D1Database,
  overrides: {
    id?: string;
    status?: string;
    bookAt?: number;
    provider?: string;
    date?: string;
    timeWindowStart?: string;
    timeWindowEnd?: string;
    providerCourseId?: string;
    maxPriceCents?: number | null;
  } = {},
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO scheduled_bookings
       (id, user_id, provider, provider_course_id, course_id, date,
        time_window_start, time_window_end, players, max_price_cents, book_at,
        status, attempts, last_error, confirmation_code, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      overrides.id ?? "sb1",
      "default",
      overrides.provider ?? "golfnow",
      overrides.providerCourseId ?? "pc1",
      "stevens_park",
      overrides.date ?? "2026-07-20",
      overrides.timeWindowStart ?? "07:00",
      overrides.timeWindowEnd ?? "09:00",
      2,
      overrides.maxPriceCents ?? null,
      overrides.bookAt ?? NOW,
      overrides.status ?? "pending",
      0,
      null,
      null,
      NOW,
      NOW,
    )
    .run();
}

function slotAt8am(date = "2026-07-20"): TeeTime {
  // 8:00 AM CT (CDT in July) = 13:00 UTC
  const epoch = Date.UTC(2026, 6, 20, 13, 0, 0);
  return TeeTimeSchema.parse({
    id: makeTeeTimeId("golfnow", "pc1", epoch),
    provider: "golfnow",
    providerCourseId: "pc1",
    courseId: "stevens_park",
    timeEpochMs: epoch,
    playersAvailable: 4,
    bookable: true,
    hotDealPriceCents: 4500,
    rackPriceCents: null,
    twilightPriceCents: null,
    providerSlotId: `slot-${date}`,
    scrapedAt: NOW,
  });
}

interface DaemonHarness {
  db: D1Database;
  kv: KVNamespace;
  cache: TeeTimeCache;
  vault: VaultStorage;
  executors: ExecutorRegistry;
  idem: IdempotencyCache;
  notifications: Array<{ subject: string; body: string }>;
  runDaemon: () => ReturnType<typeof runDaemonTick>;
}

async function setupHarness(opts: {
  withCookies?: boolean;
} = {}): Promise<DaemonHarness> {
  const db = makeD1();
  const kv = makeKV();
  const cache = new TeeTimeCache(kv);
  const vault = new VaultStorage(db);
  if (opts.withCookies !== false) {
    await vault.put(
      {
        provider: "golfnow",
        kind: "cookies",
        payload: [
          {
            name: "session",
            value: "x",
            domain: ".golfnow.com",
            path: "/",
            httpOnly: true,
            secure: true,
          },
        ],
      },
      MASTER,
    );
  }
  const executors = new ExecutorRegistry();
  const idem = new IdempotencyCache();
  const notifications: Array<{ subject: string; body: string }> = [];
  const runDaemon = () =>
    runDaemonTick(
      { maxRetries: 3, retryBackoffMs: 60_000 },
      {
        db,
        cache,
        executors,
        idempotency: idem,
        vault,
        masterKey: MASTER,
        sendNotification: async (subject, body) => {
          notifications.push({ subject, body });
        },
      },
    );
  return { db, kv, cache, vault, executors, idem, notifications, runDaemon };
}

describe("booking daemon", () => {
  beforeEach(() => {});

  it("books successfully when slot matches", async () => {
    const h = await setupHarness();
    await h.cache.set("golfnow", "pc1", "2026-07-20", [slotAt8am()]);
    const exec = new StubExecutor("golfnow");
    exec.setOutcome("slot-2026-07-20", {
      status: "booked",
      confirmationCode: "CONF-123",
    });
    h.executors.register(exec);
    await seedScheduledBooking(h.db, { id: "sb-1" });

    const result = await h.runDaemon();

    expect(result.scanned).toBe(1);
    expect(result.booked).toBe(1);
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]?.body).toContain("CONF-123");

    const row = (await h.db
      .prepare(
        "SELECT status, confirmation_code FROM scheduled_bookings WHERE id=?",
      )
      .bind("sb-1")
      .first()) as { status: string; confirmation_code: string };
    expect(row.status).toBe("booked");
    expect(row.confirmation_code).toBe("CONF-123");

    const attempts = (await h.db
      .prepare(
        "SELECT COUNT(*) as c FROM booking_attempts WHERE scheduled_booking_id=?",
      )
      .bind("sb-1")
      .first()) as { c: number };
    expect(attempts.c).toBe(1);
  });

  it("fails when no cookies in vault", async () => {
    const h = await setupHarness({ withCookies: false });
    await h.cache.set("golfnow", "pc1", "2026-07-20", [slotAt8am()]);
    h.executors.register(new StubExecutor("golfnow"));
    await seedScheduledBooking(h.db, { id: "sb-1" });

    const result = await h.runDaemon();

    expect(result.failed).toBe(1);
    const row = (await h.db
      .prepare(
        "SELECT status, last_error FROM scheduled_bookings WHERE id=?",
      )
      .bind("sb-1")
      .first()) as { status: string; last_error: string };
    expect(row.status).toBe("pending"); // will retry
    expect(row.last_error).toMatch(/no cookies/);
  });

  it("retries on transient failure then marks as pending", async () => {
    const h = await setupHarness();
    await h.cache.set("golfnow", "pc1", "2026-07-20", [slotAt8am()]);
    await seedScheduledBooking(h.db, { id: "sb-1" });

    const exec = new StubExecutor("golfnow");
    exec.setOutcome("slot-2026-07-20", {
      status: "failed",
      errorMessage: "upstream 503",
    });
    h.executors.register(exec);

    await h.runDaemon();

    const row = (await h.db
      .prepare(
        "SELECT status, attempts, last_error FROM scheduled_bookings WHERE id=?",
      )
      .bind("sb-1")
      .first()) as { status: string; attempts: number; last_error: string };
    expect(row.attempts).toBe(1);
    expect(row.status).toBe("pending");
    expect(row.last_error).toMatch(/upstream 503/);
  });

  it("records 'no slot in window' when cache is empty", async () => {
    const h = await setupHarness();
    await h.cache.set("golfnow", "pc1", "2026-07-20", []);
    h.executors.register(new StubExecutor("golfnow"));
    await seedScheduledBooking(h.db, { id: "sb-1" });

    await h.runDaemon();

    const row = (await h.db
      .prepare(
        "SELECT last_error FROM scheduled_bookings WHERE id=?",
      )
      .bind("sb-1")
      .first()) as { last_error: string };
    expect(row.last_error).toMatch(/no slot/);
  });

  it("picks earliest slot in window when multiple available", async () => {
    const h = await setupHarness();
    // 7:00 AM CT = 12:00 UTC, 9:00 AM CT = 14:00 UTC
    const slots: TeeTime[] = [
      TeeTimeSchema.parse({
        ...slotAt8am(),
        timeEpochMs: Date.UTC(2026, 6, 20, 14, 0, 0),
        providerSlotId: "slot-9am",
      }),
      TeeTimeSchema.parse({
        ...slotAt8am(),
        timeEpochMs: Date.UTC(2026, 6, 20, 12, 0, 0),
        providerSlotId: "slot-7am",
      }),
    ];
    await h.cache.set("golfnow", "pc1", "2026-07-20", slots);
    await seedScheduledBooking(h.db, {
      id: "sb-1",
      timeWindowStart: "06:00",
      timeWindowEnd: "10:00",
    });

    const exec = new StubExecutor("golfnow");
    exec.setOutcome("slot-7am", { status: "booked", confirmationCode: "X" });
    h.executors.register(exec);

    await h.runDaemon();

    const row = (await h.db
      .prepare(
        "SELECT confirmation_code FROM scheduled_bookings WHERE id=?",
      )
      .bind("sb-1")
      .first()) as { confirmation_code: string };
    expect(row.confirmation_code).toBe("X");
  });

  it("filters slots above max price", async () => {
    const h = await setupHarness();
    const expensive = TeeTimeSchema.parse({
      ...slotAt8am(),
      hotDealPriceCents: 12000, // $120 — over the $50 ceiling
      providerSlotId: "slot-expensive",
    });
    await h.cache.set("golfnow", "pc1", "2026-07-20", [expensive]);
    h.executors.register(new StubExecutor("golfnow"));
    await seedScheduledBooking(h.db, { id: "sb-1", maxPriceCents: 5000 });

    await h.runDaemon();

    const row = (await h.db
      .prepare(
        "SELECT status, last_error FROM scheduled_bookings WHERE id=?",
      )
      .bind("sb-1")
      .first()) as { status: string; last_error: string };
    expect(row.last_error).toMatch(/no slot/);
  });
});