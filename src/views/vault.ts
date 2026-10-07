/**
 * Vault UI — list, paste cookies, paste credentials, delete.
 */
import { renderLayout, escapeHtml } from "./layout";
import { PROVIDERS } from "../types";
import type { VaultRow } from "../vault/storage";

export interface VaultViewOptions {
  entries: VaultRow[];
  error?: string;
  success?: string;
}

export function renderVault(opts: VaultViewOptions): string {
  const providerOptions = PROVIDERS.map(
    (p) => `<option value="${p}">${p}</option>`,
  ).join("");

  const entryRows =
    opts.entries.length === 0
      ? `<tr><td colspan="5" class="px-3 py-3 text-slate-500 text-center">No credentials stored yet.</td></tr>`
      : opts.entries
          .map(
            (e) => `
        <tr class="border-t">
          <td class="px-3 py-2 font-medium">${escapeHtml(e.provider)}</td>
          <td class="px-3 py-2">${escapeHtml(e.kind)}</td>
          <td class="px-3 py-2 text-slate-600">
            ${e.expiresAt ? new Date(e.expiresAt).toLocaleString() : "—"}
          </td>
          <td class="px-3 py-2 text-slate-500 text-xs">
            ${new Date(e.updatedAt).toLocaleString()}
          </td>
          <td class="px-3 py-2 text-right">
            <form method="POST" action="/vault/delete" class="inline">
              <input type="hidden" name="provider" value="${escapeHtml(e.provider)}" />
              <button class="text-rose-600 hover:underline text-sm">Delete</button>
            </form>
          </td>
        </tr>`,
          )
          .join("");

  const banner = opts.error
    ? `<div class="bg-rose-100 text-rose-900 rounded p-3 text-sm mb-3">${escapeHtml(opts.error)}</div>`
    : opts.success
      ? `<div class="bg-emerald-100 text-emerald-900 rounded p-3 text-sm mb-3">${escapeHtml(opts.success)}</div>`
      : "";

  const body = `
  <section class="space-y-4">
    <div class="bg-white rounded-lg shadow p-5">
      <h1 class="text-xl font-semibold">Credentials vault</h1>
      <p class="text-sm text-slate-600 mt-1">
        Encrypted with AES-GCM (key from Workers Secrets).
        Cookies never leave the database in plaintext.
        Passwords are used once and discarded after harvest.
      </p>
    </div>

    ${banner}

    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div class="px-5 py-3 border-b font-semibold">Stored entries</div>
      <table class="min-w-full text-sm">
        <thead class="bg-slate-100 text-left">
          <tr>
            <th class="px-3 py-2">Provider</th>
            <th class="px-3 py-2">Kind</th>
            <th class="px-3 py-2">Expires</th>
            <th class="px-3 py-2">Updated</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>${entryRows}</tbody>
      </table>
    </div>

    <div class="bg-white rounded-lg shadow p-5 space-y-4">
      <h2 class="font-semibold">Add cookies (from Chrome extension)</h2>
      <p class="text-xs text-slate-500">
        Use the bundled extension (extension/ folder) to copy cookies as JSON, then paste below.
      </p>
      <form method="POST" action="/vault/cookies" class="space-y-2">
        <label class="block">
          <span class="text-sm font-medium">Provider</span>
          <select name="provider" class="mt-1 w-full border rounded px-2 py-2">
            ${providerOptions}
          </select>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Cookies JSON</span>
          <textarea name="cookies" rows="6" class="mt-1 w-full border rounded p-2 font-mono text-xs" placeholder='[{"name":"session","value":"...","domain":".golfnow.com","path":"/"}]'></textarea>
        </label>
        <button type="submit" class="bg-emerald-700 hover:bg-emerald-800 text-white rounded px-3 py-2 text-sm">
          Save cookies
        </button>
      </form>
    </div>

    <div class="bg-white rounded-lg shadow p-5 space-y-4">
      <h2 class="font-semibold">Add credentials (one-time harvest)</h2>
      <p class="text-xs text-slate-500">
        Site logs in via the Playwright fallback host, harvests cookies, then <b>discards the password</b>.
      </p>
      <form method="POST" action="/vault/credentials" class="space-y-2">
        <label class="block">
          <span class="text-sm font-medium">Provider</span>
          <select name="provider" class="mt-1 w-full border rounded px-2 py-2">
            ${providerOptions}
          </select>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Username</span>
          <input name="username" class="mt-1 w-full border rounded px-2 py-2" />
        </label>
        <label class="block">
          <span class="text-sm font-medium">Password</span>
          <input name="password" type="password" class="mt-1 w-full border rounded px-2 py-2" />
        </label>
        <button type="submit" class="bg-emerald-700 hover:bg-emerald-800 text-white rounded px-3 py-2 text-sm">
          Harvest cookies & discard password
        </button>
      </form>
    </div>
  </section>`;

  return renderLayout({ title: "Vault", body, active: "vault" });
}