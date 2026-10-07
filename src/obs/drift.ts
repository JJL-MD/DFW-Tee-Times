/**
 * Schema-drift detector.
 *
 * Each adapter has a recorded fixture JSON under `fixtures/private/{provider}/`.
 * After every scrape, we diff the new response's structure (key set +
 * per-key type signature) against the snapshot. Drift > threshold triggers
 * an alert event so the operator can refresh fixtures and adjust parsers.
 *
 * Detected drifts include:
 *   - new top-level keys
 *   - missing top-level keys
 *   - type changes (string → object, etc.)
 *   - per-array-item shape changes
 *
 * We compare only structure, not values, so fixtures stay valid even when
 * tee-time content changes daily.
 */

export interface FieldShape {
  /** "string" | "number" | "boolean" | "null" | "array" | "object" */
  kind: string;
  /** For object: sorted top-level keys. For array: shape of items. */
  keys?: string[];
  /** For object: per-key shape (drift detection uses for nested type checks) */
  children?: Record<string, FieldShape>;
  /** For array: shape of each item */
  itemShape?: FieldShape;
}

export interface ProviderSnapshot {
  provider: string;
  recordedAt: number;
  /** Per-course fixture shape: keys at top of response */
  responseShape: FieldShape;
  /** Per-slot shape inside the response */
  slotShape: FieldShape;
}

export interface DriftReport {
  provider: string;
  hasDrift: boolean;
  addedKeys: string[];
  removedKeys: string[];
  changedTypes: Array<{ key: string; before: string; after: string }>;
}

export function captureShape(value: unknown): FieldShape {
  if (value == null) return { kind: "null" };
  if (Array.isArray(value)) {
    const itemShapes = value.slice(0, 5).map(captureShape);
    const first = itemShapes[0] ?? { kind: "null" };
    return { kind: "array", keys: [], itemShape: first };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    // Capture child shapes so nested drift detection works
    const children: Record<string, FieldShape> = {};
    keys.forEach((k) => {
      children[k] = captureShape(obj[k]);
    });
    return { kind: "object", keys, children } as FieldShape;
  }
  return { kind: typeof value };
}

/**
 * Find the "tee times" array in a provider response. Convention:
 *   GolfNow: response.teeTimes or response.results
 *   TeeOff:  response.results or response.slots
 *   Chronogolf: response.items
 *   ForeUp: response is an array
 */
export function extractSlots(provider: string, body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  if (Array.isArray(body)) return body;
  const candidates = [
    obj.teeTimes,
    obj.results,
    obj.slots,
    obj.items,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

/**
 * Compare two field shapes. Returns drift details.
 */
export function diffShapes(
  before: FieldShape,
  after: FieldShape,
  keyPath = "",
): { added: string[]; removed: string[]; changed: Array<{ key: string; before: string; after: string }> } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ key: string; before: string; after: string }> = [];

  if (before.kind !== after.kind) {
    changed.push({
      key: keyPath || "(root)",
      before: before.kind,
      after: after.kind,
    });
  }
  if (before.kind === "object" && after.kind === "object") {
    const beforeKeys = new Set(before.keys ?? []);
    const afterKeys = new Set(after.keys ?? []);
    afterKeys.forEach((k) => {
      if (!beforeKeys.has(k)) added.push(keyPath ? `${keyPath}.${k}` : k);
    });
    beforeKeys.forEach((k) => {
      if (!afterKeys.has(k)) removed.push(keyPath ? `${keyPath}.${k}` : k);
    });
    // Recurse into keys present in both — catches nested type changes
    beforeKeys.forEach((k) => {
      if (!afterKeys.has(k)) return;
      const beforeChild = (before as { children?: Record<string, FieldShape> }).children?.[k];
      const afterChild = (after as { children?: Record<string, FieldShape> }).children?.[k];
      if (!beforeChild || !afterChild) return;
      const inner = diffShapes(beforeChild, afterChild, keyPath ? `${keyPath}.${k}` : k);
      added.push(...inner.added);
      removed.push(...inner.removed);
      changed.push(...inner.changed);
    });
  }
  if (before.kind === "array" && after.kind === "array") {
    if (before.itemShape && after.itemShape) {
      // Array items recurse under "[]" prefix
      const inner = diffShapes(before.itemShape, after.itemShape, keyPath ? `${keyPath}[]` : "[]");
      added.push(...inner.added);
      removed.push(...inner.removed);
      changed.push(...inner.changed);
    }
  }
  return { added, removed, changed };
}

export function checkDrift(
  snapshot: ProviderSnapshot,
  liveResponse: unknown,
): DriftReport {
  const slots = extractSlots(snapshot.provider, liveResponse);
  const liveResponseShape = captureShape(liveResponse);
  const liveSlotShape = captureShape(slots[0] ?? null);

  const responseDiff = diffShapes(snapshot.responseShape, liveResponseShape);
  const slotDiff = diffShapes(snapshot.slotShape, liveSlotShape);

  return {
    provider: snapshot.provider,
    hasDrift:
      responseDiff.added.length > 0 ||
      responseDiff.removed.length > 0 ||
      responseDiff.changed.length > 0 ||
      slotDiff.added.length > 0 ||
      slotDiff.removed.length > 0 ||
      slotDiff.changed.length > 0,
    addedKeys: [...responseDiff.added, ...slotDiff.added],
    removedKeys: [...responseDiff.removed, ...slotDiff.removed],
    changedTypes: [...responseDiff.changed, ...slotDiff.changed],
  };
}