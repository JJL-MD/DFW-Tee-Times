/**
 * Search results — table of tee times with sort + filter controls.
 */
import { renderLayout, escapeHtml, fmtTime, fmtPrice } from "./layout";
import type { TeeTime } from "../types";
import type { SeedCourse } from "../seed/dfw-courses";

export interface ResultsRow {
  teeTime: TeeTime;
  course: SeedCourse | undefined;
}

export interface ResultsOptions {
  date: string;
  players: number;
  rows: ResultsRow[];
  from: string;
  to: string;
  maxPriceCents: number | null;
}

export function renderResults(opts: ResultsOptions): string {
  const { rows, date, from, to, maxPriceCents, players } = opts;

  if (rows.length === 0) {
    return renderLayout({
      title: `Search · ${date}`,
      active: "search",
      body: `
      <div class="bg-white rounded-lg shadow p-5">
        <h2 class="text-lg font-semibold mb-2">No tee times matched</h2>
        <p class="text-sm text-slate-600">
          No availability in the cache for ${escapeHtml(date)}, ${players} players,
          ${escapeHtml(from)}–${escapeHtml(to)}${maxPriceCents ? `, ≤${fmtPrice(maxPriceCents)}` : ""}.
        </p>
        <p class="text-xs text-slate-500 mt-3">
          Scrapes run every 15 minutes. Last cache may not include this date
          yet — try a closer date, or hit "Search" to force a fresh scrape
          (Phase D wraps this).
        </p>
      </div>`,
    });
  }

  const sorted = [...rows].sort((a, b) => {
    // Soonest first by default
    return a.teeTime.timeEpochMs - b.teeTime.timeEpochMs;
  });

  const body = `
  <section class="bg-white rounded-lg shadow overflow-hidden">
    <div class="px-5 py-3 border-b flex items-center justify-between">
      <h2 class="font-semibold">${sorted.length} tee times · ${escapeHtml(date)}</h2>
      <div class="text-xs text-slate-500">
        ${escapeHtml(from)}–${escapeHtml(to)}${maxPriceCents ? ` · ≤${fmtPrice(maxPriceCents)}` : ""}
      </div>
    </div>
    <div class="overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead class="bg-slate-100 text-left">
          <tr>
            <th class="px-3 py-2">Time</th>
            <th class="px-3 py-2">Course</th>
            <th class="px-3 py-2">Provider</th>
            <th class="px-3 py-2 text-right">Hot deal</th>
            <th class="px-3 py-2 text-right">Rack</th>
            <th class="px-3 py-2 text-center">Spots</th>
            <th class="px-3 py-2 text-right">Book</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(rowHtml).join("")}
        </tbody>
      </table>
    </div>
  </section>`;

  return renderLayout({ title: `Search · ${date}`, body, active: "search" });
}

function rowHtml(row: ResultsRow): string {
  const tt = row.teeTime;
  const c = row.course;
  const hot = tt.hotDealPriceCents;
  return `
    <tr class="border-t hover:bg-slate-50">
      <td class="px-3 py-2 font-medium">${escapeHtml(fmtTime(tt.timeEpochMs))}</td>
      <td class="px-3 py-2">
        <a href="/course/${encodeURIComponent(tt.courseId)}" class="text-emerald-700 hover:underline">
          ${escapeHtml(c?.name ?? tt.courseId)}
        </a>
        ${c?.city ? `<span class="text-slate-500 text-xs"> · ${escapeHtml(c.city)}</span>` : ""}
      </td>
      <td class="px-3 py-2">
        <span class="inline-block px-2 py-0.5 rounded bg-slate-200 text-xs">${escapeHtml(tt.provider)}</span>
      </td>
      <td class="px-3 py-2 text-right">
        ${hot != null && hot > 0 ? `<span class="text-emerald-700 font-semibold">${escapeHtml(fmtPrice(hot))}</span>` : `<span class="text-slate-400">—</span>`}
      </td>
      <td class="px-3 py-2 text-right text-slate-600">${escapeHtml(fmtPrice(tt.rackPriceCents))}</td>
      <td class="px-3 py-2 text-center">${tt.playersAvailable}</td>
      <td class="px-3 py-2 text-right">
        <a href="/book/${encodeURIComponent(tt.id)}" class="text-emerald-700 hover:underline">
          Schedule →
        </a>
      </td>
    </tr>`;
}