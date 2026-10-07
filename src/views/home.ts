/**
 * Homepage — search form.
 */
import { renderLayout, escapeHtml, todayISO, addDays } from "./layout";
import { DFW_COURSES } from "../seed/dfw-courses";

export function renderHome(): string {
  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const week = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today, i);
    const label = new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
    });
    return `<option value="${d}">${escapeHtml(label)}</option>`;
  }).join("");

  const courseOptions = DFW_COURSES.map(
    (c) =>
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} — ${escapeHtml(c.city)}</option>`,
  ).join("");

  const body = `
  <section class="space-y-6">
    <div class="bg-white rounded-lg shadow p-5">
      <h1 class="text-xl font-semibold mb-3">Find tee times across DFW</h1>
      <p class="text-sm text-slate-600 mb-4">
        Aggregates availability from GolfNow, TeeOff, Chronogolf, ForeUp, and
        course-direct systems. ${DFW_COURSES.length} courses in the catalog.
      </p>
      <form
        hx-get="/search"
        hx-target="#results"
        hx-trigger="submit"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <label class="block">
          <span class="text-sm font-medium">Date</span>
          <select name="date" class="mt-1 w-full border rounded px-2 py-2">
            ${week}
          </select>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Players</span>
          <select name="players" class="mt-1 w-full border rounded px-2 py-2">
            <option value="1">1</option>
            <option value="2" selected>2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Course (optional)</span>
          <select name="courseId" class="mt-1 w-full border rounded px-2 py-2">
            <option value="">All courses</option>
            ${courseOptions}
          </select>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Max price</span>
          <select name="maxPrice" class="mt-1 w-full border rounded px-2 py-2">
            <option value="">No limit</option>
            <option value="3000">≤ $30</option>
            <option value="5000" selected>≤ $50</option>
            <option value="8000">≤ $80</option>
            <option value="12000">≤ $120</option>
          </select>
        </label>
        <label class="block sm:col-span-2 lg:col-span-3">
          <span class="text-sm font-medium">Time window (course-local)</span>
          <div class="mt-1 flex gap-2 items-center">
            <select name="from" class="border rounded px-2 py-2">
              ${hourOptions("06:00")}
            </select>
            <span>to</span>
            <select name="to" class="border rounded px-2 py-2">
              ${hourOptions("20:00")}
            </select>
          </div>
        </label>
        <div class="flex items-end">
          <button
            type="submit"
            class="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded px-3 py-2"
          >
            Search
          </button>
        </div>
      </form>
      <input type="hidden" name="tz" value="America/Chicago" />
    </div>

    <div id="results" class="bg-white rounded-lg shadow p-5 text-slate-500 text-sm">
      Pick a date and click Search.
    </div>

    <details class="bg-white rounded-lg shadow p-5">
      <summary class="cursor-pointer font-medium">Catalog (${DFW_COURSES.length} courses)</summary>
      <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
        ${DFW_COURSES.map(
          (c) => `
            <div class="flex justify-between border-b py-1">
              <a href="/course/${encodeURIComponent(c.id)}" class="text-emerald-700 hover:underline">
                ${escapeHtml(c.name)}
              </a>
              <span class="text-slate-500">${escapeHtml(c.city)} · ${escapeHtml(c.defaultProvider)}</span>
            </div>`,
        ).join("")}
      </div>
    </details>
  </section>`;

  return renderLayout({ title: "DFW Tee Times", body, active: "home" });
}

function hourOptions(selected: string): string {
  const hours = [
    "05:00", "06:00", "07:00", "08:00", "09:00", "10:00",
    "11:00", "12:00", "13:00", "14:00", "15:00", "16:00",
    "17:00", "18:00", "19:00", "20:00", "21:00",
  ];
  return hours
    .map((h) => `<option value="${h}"${h === selected ? " selected" : ""}>${h}</option>`)
    .join("");
}