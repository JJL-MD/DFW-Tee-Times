# End-to-End Browser Tests

These tests run against a real `wrangler dev` instance with a real Chromium
browser. They catch what route-level Hono tests don't:

- Tailwind classes render correctly
- HTMX hx-get fires and swaps in the right HTML
- Real browser interactions (date picker, select dropdowns, click navigation)
- Mobile responsive layout (viewport, tap targets, no horizontal scroll)
- Accessibility smoke (heading hierarchy, label associations, nav text)

## Run

```bash
# One-time: install the Chromium browser
npm run test:e2e:install

# Start wrangler dev (must use macOS 13.5+ for the workerd runtime)
npm run db:migrate:local
npm run db:seed:local
npm run dev                 # in one terminal

# Run e2e tests (auto-finds the dev server)
npm run test:e2e

# Or point at a different host
PLAYWRIGHT_BASE_URL=https://your-staging.example.com npm run test:e2e
```

## Prerequisites

**wrangler dev runtime requires macOS 13.5+ or Linux glibc 2.35+.** On older
macOS the runtime fails with:

```
[ERROR] Unsupported macOS version: The Cloudflare Workers runtime cannot run
on the current version of macOS (12.6.0). The minimum requirement is
macOS 13.5.0+.
```

The Playwright tests themselves will run anywhere — they just fail to
connect. On a supported system, they connect to the dev server and exercise
the real Worker.

## What's covered

`ui.spec.ts`:

```
homepage        form fields, defaults, catalog accordion, 9 priority courses
navigation      course-link click, 404 for unknown course, map page
search flow     empty-cache renders "No tee times matched"
mobile layout   375px viewport, no horizontal scroll, ≥44px tap targets
a11y smoke      single h1, labeled fields, nav link text
```

## Architecture

- `global-setup.ts` boots `wrangler dev` once per test run and exposes the
  base URL to the test config. Wrangler dev takes ~5s to start; one shared
  instance keeps the suite fast.
- `playwright.config.ts` points at the global setup's URL with workers=1
  (wrangler dev is single-tenant).
- `ui.spec.ts` is plain Playwright tests using `@playwright/test` API.

## CI

In CI, prefix with:
```bash
npm run test:e2e:install    # cache the browser between runs
npm run db:migrate:local
npm run db:seed:local
npm run test:e2e
```

## Debugging failures

Playwright auto-captures traces and screenshots on failure (see
`playwright.config.ts`). To view locally:
```bash
npx playwright show-report
```

Or run a single test with `--headed` to watch:
```bash
npx playwright test tests-e2e/ui.spec.ts --headed
```
