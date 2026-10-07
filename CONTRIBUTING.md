# Contributing

## Local dev

```bash
npm install
cp .dev.vars.example .dev.vars
npm run keys:local                # add to .dev.vars
npm run db:migrate:local
npm run db:seed:local
npm run dev                       # http://127.0.0.1:8787
```

## Tests

```bash
npm test          # vitest (164 tests, ~2s, no network)
npm run test:e2e  # Playwright (11 tests, requires wrangler dev running)
```

## Pushing to GitHub

The repo is at <https://github.com/JJL-MD/DFW-Tee-Times>.

```bash
git init                                    # one-time per clone
git config user.name "Your Name"
git config user.email "you@example.com"
git add .
git commit -m "Describe your change"
git remote add origin git@github.com:JJL-MD/DFW-Tee-Times.git
git branch -M main
git push -u origin main
```

For HTTPS + PAT instead of SSH:
```bash
git remote add origin https://github.com/JJL-MD/DFW-Tee-Times.git
git push -u origin main    # paste PAT when prompted
```

## CI

Pushes to `main` and PRs against `main` run `.github/workflows/e2e.yml`:
- **vitest** job: `npm ci && npm run lint && npm test`
- **e2e** job: install Playwright, boot wrangler dev on ubuntu-latest,
  run Playwright tests, upload report + traces on failure

CI only works on runners with wrangler-compatible runtimes
(macOS 13.5+ or Linux glibc 2.35+, which `ubuntu-latest` satisfies).

## What NOT to commit

- `.dev.vars` — local secrets
- `node_modules/`, `.wrangler/`, `test-results/`, `playwright-report/`
  (all in `.gitignore`)
- `*.log` files
