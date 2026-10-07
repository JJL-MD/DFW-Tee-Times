/**
 * HTML layout — server-rendered shell with HTMX + Tailwind via CDN.
 *
 * No SPA framework. Tailwind via CDN keeps the Worker bundle tiny and
 * the page snappy. HTMX gives us partial-page updates for the search
 * form without writing any client JS.
 */
export interface LayoutOptions {
  title: string;
  body: string;
  /** When true, set page background slightly tinted to highlight section */
  active?: "home" | "search" | "schedule" | "vault" | "course" | undefined;
}

export function renderLayout(opts: LayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${escapeHtml(opts.title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen flex flex-col">
  <header class="bg-emerald-700 text-white shadow">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
      <a href="/" class="font-semibold text-lg">⛳ DFW Tee Times</a>
      <nav class="flex-1 flex gap-1 text-sm">
        ${navLink("/", "Search", opts.active === "home" || opts.active === "search")}
        ${navLink("/schedule", "Schedule", opts.active === "schedule")}
        ${navLink("/vault", "Vault", opts.active === "vault")}
      </nav>
      <span class="text-xs text-emerald-200 hidden sm:inline">Personal use · CST/CDT</span>
    </div>
  </header>
  <main class="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
    ${opts.body}
  </main>
  <footer class="text-center text-xs text-slate-500 py-4">
    Personal tee-time aggregator · ${new Date().getFullYear()}
  </footer>
</body>
</html>`;
}

function navLink(href: string, label: string, active: boolean): string {
  const cls = active
    ? "px-3 py-1.5 rounded bg-emerald-800"
    : "px-3 py-1.5 rounded hover:bg-emerald-800";
  return `<a href="${href}" class="${cls}">${escapeHtml(label)}</a>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format epoch ms as "8:30 AM CT" for display.
 * Defaults to America/Chicago; callers may pass a tz.
 */
export function fmtTime(epochMs: number, tz = "America/Chicago"): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  });
}

export function fmtDate(epochMs: number, tz = "America/Chicago"): string {
  const d = new Date(epochMs);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
}

export function fmtPrice(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Build today's date as YYYY-MM-DD in the given timezone.
 */
export function todayISO(tz = "America/Chicago"): string {
  const d = new Date();
  return d.toLocaleDateString("en-CA", { timeZone: tz }); // en-CA gives YYYY-MM-DD
}

/**
 * Add `days` to a YYYY-MM-DD date string.
 */
export function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (!y || !m || !d) return dateISO;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}