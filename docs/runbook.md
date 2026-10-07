# Operator Runbook

Everything you need to deploy, debug, and recover the DFW Tee Times Worker.

## Architecture

```
Browser ──> Cloudflare Worker (Hono)
                 ├─ D1  (catalog, vault, scheduled bookings, attempts)
                 ├─ KV  (tee-time cache, 10min TTL + 30min stale)
                 └─ Cron: */15 scrape tick, */1 booking daemon tick
                              │
                              └─ Optional: Playwright fallback host (Fly/Railway)
                                 for SPA-only providers and login-harvest
```

## First-time deploy

```bash
# 1. Install deps
npm install

# 2. Provision Cloudflare resources
npx wrangler login
npx wrangler d1 create dfw-tee-times
# → paste database_id into wrangler.toml [[d1_databases]]

npx wrangler kv namespace create CACHE
# → paste id into wrangler.toml [[kv_namespaces]]

# 3. Set secrets
npx wrangler secret put VAULT_MASTER_KEY    # 32-byte hex, run scripts/dev-keys.mjs
npx wrangler secret put CSRF_SECRET         # any random string
npx wrangler secret put RESEND_API_KEY      # optional, for email notifications
npx wrangler secret put FALLBACK_HOST_TOKEN # shared with fallback host

# 4. Apply migrations + seed
npm run db:migrate:remote
npm run db:seed:remote

# 5. Deploy
npm run deploy
```

## Local dev

```bash
cp .dev.vars.example .dev.vars   # edit secrets
npm run keys:local              # generate VAULT_MASTER_KEY
npm run db:migrate:local
npm run db:seed:local
npm run dev                     # http://127.0.0.1:8787
```

## Adding a new provider adapter

1. Implement `TeeTimeAdapter` (see `src/adapters/types.ts`) in
   `src/adapters/{provider}/index.ts`.
2. Register it in `src/adapters/index.ts`'s bootstrap (call `registerAdapter`
   in the Worker entrypoint's startup).
3. Capture a fixture: open the provider's site in Chrome with DevTools,
   hit the search endpoint, save the JSON response.
4. Save it to `fixtures/private/{provider}/get-{hash}.json` (the fixture
   fetcher hashes the URL for the filename).
5. Add tests in `tests/adapter-{provider}.test.ts` using `InMemoryFetcher`
   to simulate the response.
6. Update `src/seed/dfw-courses.ts` to set the new provider as default
   for courses that use it (or add it to `providerIds` map).

## Capturing fixtures for offline testing

```bash
# Local: with --record flag
FIXTURE_RECORD=1 npm run dev
# Then hit /api/scrape — fixture is written to fixtures/private/{provider}/

# Manual: paste a captured response into:
#   fixtures/private/{provider}/get-{urlhash}.json
```

## Adding a new course

1. Edit `src/seed/dfw-courses.ts`:
   ```ts
   { id: "new_course", name: "...", city: "...", state: "TX",
     lat, lon, defaultProvider: "golfnow", bookingWindowDays: 7,
     bookingOpensAtLocal: "06:00", timezone: "America/Chicago",
     providerIds: { golfnow: "REAL_COURSE_ID" } }
   ```
2. Re-run seed:
   ```bash
   npm run db:seed:local    # or remote
   ```
3. The seed uses INSERT OR REPLACE so existing rows are updated.

## Master key rotation

If `VAULT_MASTER_KEY` is compromised or you want to rotate:

1. Generate a new key: `npm run keys:local` (or your own).
2. Run a one-time migration that re-encrypts every `vault_entries.ciphertext`
   with the new key. The old key must remain available for decryption.
3. Once all rows are migrated, replace `VAULT_MASTER_KEY` with the new value.
4. Delete the old key.

The Worker can support dual-key decryption by storing a `key_version`
column and trying both keys during the rotation window.

## Recovering from a provider ban

Symptoms: 403/429 from GolfNow/TeeOff for hours; CAPTCHA pages;
empty tee-time responses for courses that are clearly booked.

Steps:
1. Check `npx wrangler tail dfw-tee-times` — look for repeated 4xx from
   a provider.
2. **Stop the booking daemon** (or set `BOOKING_RETRY_MAX=0` temporarily)
   so it doesn't make things worse.
3. Pause scrape ticks: `npx wrangler cron trigger cancel dfw-tee-times *`.
4. Wait 24-48 hours. Most provider bans are short.
5. If you're blocked persistently:
   - Switch to residential proxy (Bright Data, Webshare) — see
     `src/obs/hygiene.ts` for the proxy interface.
   - Apply for the provider's partner API (GolfNow Affiliate).
   - Or fall back to deep-link-only mode for that provider.
6. Update fixtures (the schema likely changed) and re-run drift checks.

## Drift detection

`src/obs/drift.ts` provides `checkDrift(snapshot, liveResponse)` — call
after each scrape to detect structural changes to provider responses.

When the daemon ticks, it can:
1. Capture the shape of the live response.
2. Compare to a snapshot stored alongside fixtures.
3. Alert if keys are added/removed/types change.
4. Disable the affected adapter until you re-record fixtures.

## Cron tuning

- `*/15 * * * *` — availability scrape (every 15 min). Tighten to
  `*/5` for more responsive data, loosen to `*/30` to reduce bans.
- `* * * * *` — booking daemon (every minute). Each tick scans for due
  bookings. If no bookings are due, the tick is cheap.

## Observability

`src/obs/observability.ts` provides `Observability.timed()` — wrap any
async call:

```ts
await obs.timed("scrape", "ok", "golfnow", () =>
  adapter.fetchAvailability(providerCourseId, ctx),
);
```

Bind `AnalyticsEngineDataset` in wrangler.toml to enable. Without it,
events are silently dropped (Observability.noop).

## Tests

```bash
npm test            # vitest
npm run lint        # tsc --noEmit
```

All tests run on a better-sqlite3-backed D1 stub and a Map-backed KV stub —
no live network or Cloudflare credentials required.

## Adding a new course that's not in any provider

If you want to tee off a course that doesn't have an online booking
system (private clubs, walk-on only), set `providerIds: {}` and leave
`defaultProvider` as `"course_direct"`. The aggregator will skip it
in scrapes and the map page will show it but with no availability.

## Reference

- Plan: `~/.hermes/plans/2026-07-10_164000-dfw-tee-time-aggregator.md`
- TOS: `docs/tos-review.md`
- Backup: `~/Projects/dfw-tee-times-backup-*/`
