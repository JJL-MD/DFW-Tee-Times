/**
 * Adapter registry.
 *
 * Phase B wires the registry shape; Phase C populates it with real
 * GolfNow / TeeOff / Chronogolf / ForeUp adapters. Tests use StubAdapter
 * directly so they don't depend on adapter implementations landing.
 */
import type { Provider } from "../types";
import type { TeeTimeAdapter } from "./types";

const registry = new Map<Provider, TeeTimeAdapter>();

export function registerAdapter(adapter: TeeTimeAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getAdapter(id: Provider): TeeTimeAdapter | undefined {
  return registry.get(id);
}

export function listAdapters(): TeeTimeAdapter[] {
  return Array.from(registry.values());
}

export function clearAdapters(): void {
  registry.clear();
}