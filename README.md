# DFW Tee-Times

Personal site that aggregates tee-time availability across DFW booking platforms (GolfNow, TeeOff, Chronogolf, ForeUp, per-course systems) and auto-books one-shot scheduled tee times using your provider logins.

> Personal-use only. See TOS review in `docs/tos-review.md` (Phase H5).

## Stack

- Cloudflare Workers (TypeScript + Hono)
- D1 (SQLite) for catalog, vault, bookings
- KV for short-TTL tee-time cache
- Cron triggers: availability scrape every 15 min, booking daemon every minute
- Playwright fallback host (separate small service) for SPA-only providers and login-harvest

## Project layout

```
src/
  index.ts                 # Worker entrypoint
  types.ts                 # domain models (added in A2)
  adapters/                # per-provider availability adapters (Phase C)
  scrape/runner.ts         # parallel runner with concurrency cap (Phase B)
  cache/                   # KV tee-time cache (Phase B)
  links/builders/          # deep-link builders per provider (Phase E)
  vault/                   # AES-GCM encrypted credentials (Phase E)
  scheduling/predictor.ts  # slot-open predictor (Phase F)
  booking/                 # per-provider booking executors (Phase G)
  daemon/                  # booking scheduler (Phase G)
  notify/                  # email + sms (Phase G)
  routes/                  # Hono routes (Phase D)
  views/                   # server-rendered HTML (Phase D)
  seed/                    # DFW course catalog (Phase A)
migrations/                # D1 SQL
scripts/                   # seed, verify-links, dev-keys
fallback-host/             # Playwright service (separate deploy)
extension/                 # Chrome cookie exporter
tests/
```

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars   # edit secrets
npx wrangler d1 create dfw-tee-times
# paste returned database_id into wrangler.toml [[d1_databases]]
npx wrangler kv namespace create CACHE
# paste returned id into wrangler.toml [[kv_namespaces]]
npm run db:migrate:local
npm run dev                       # http://127.0.0.1:8787
npm test
```

## Build phases

See `/Users/javierlasa/.hermes/plans/2026-07-10_164000-dfw-tee-time-aggregator.md` for the full plan.

- **A** Foundation (scaffold, types, D1, seed) — current
- **B** Scraper framework (adapters, runner, cache)
- **C** Provider adapters (GolfNow, TeeOff, Chronogolf, ForeUp, per-system)
- **D** Web UI (homepage, results, map, course detail)
- **E** Credentials vault (cookie paste, Chrome extension, password harvest, health checks)
- **F** Scheduling model (one-shot bookings)
- **G** Booking daemon + auto-book executors + notifications
- **H** Ops & polish (observability, schema-drift alerts, IP hygiene, security, runbook)