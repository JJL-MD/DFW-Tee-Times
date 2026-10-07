# Fallback Host (Playwright service)

A small standalone Node service used when providers:

1. Render tee times via JavaScript (no SSR), so plain `fetch` returns an empty HTML shell
2. Require browser-mediated booking (e.g. clicking through a React SPA)

## Endpoints

### `GET /healthz`

Returns `{ ok: true }`. Used by the Worker to health-check before relying on this host.

### `POST /render`

Body: `{ url: string, cookies?: VaultCookie[], waitFor?: string, screenshot?: boolean }`

Renders the URL in headless Chromium with the supplied cookies, waits for `waitFor` selector (optional), and returns:

```json
{ status: 200, headers: {...}, body: "<rendered HTML>", screenshotBase64?: "..." }
```

### `POST /book`

Body: `{ provider: string, providerCourseId: string, date: string, players: number, cookies: VaultCookie[] }`

Navigates the booking flow, fills the form, clicks "Book", and returns:

```json
{ status: "booked" | "failed", confirmationCode?: string, errorMessage?: string }
```

### `POST /harvest`

Body: `{ provider: string, username: string, password: string }`

Logs in via real browser, exports session cookies, returns:

```json
{ cookies: VaultCookie[] }
```

## Local dev

```bash
cd fallback-host
npm install
npm run dev
# Runs on http://localhost:8788
```

## Deploy

Deploy to Fly.io / Railway / $5 VPS:

```bash
fly launch
fly secrets set FALLBACK_HOST_TOKEN=...
fly deploy
```

Update Worker with:

```bash
wrangler secret put FALLBACK_HOST_URL    # https://your-app.fly.dev
wrangler secret put FALLBACK_HOST_TOKEN  # same as above
```

## Security

- All endpoints require `Authorization: Bearer ${FALLBACK_HOST_TOKEN}`
- Cookies / passwords are NEVER logged
- Per-request, headless browser is launched in an isolated context, then destroyed
- Cookies returned to the caller are encrypted in transit over HTTPS
