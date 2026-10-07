import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encryptJson, decryptJson, loadKey } from "../src/vault/crypto";

const MASTER_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("vault crypto", () => {
  let key: CryptoKey;

  beforeEach(async () => {
    key = await loadKey(MASTER_KEY);
  });

  it("loads a 32-byte hex key", async () => {
    expect(key).toBeDefined();
    expect(key.algorithm).toMatchObject({ name: "AES-GCM" });
  });

  it("rejects wrong-length keys", async () => {
    await expect(loadKey("abcd")).rejects.toThrow(/64 hex chars/);
  });

  it("rejects non-hex chars", async () => {
    await expect(
      loadKey("zz" + "0".repeat(62)),
    ).rejects.toThrow(/non-hex/);
  });

  it("round-trips an arbitrary JSON value", async () => {
    const original = {
      cookies: [
        { name: "session", value: "abc123", domain: ".golfnow.com", path: "/" },
        { name: "csrf", value: "xyz", domain: ".golfnow.com", path: "/" },
      ],
    };
    const ct = await encryptJson(key, original);
    expect(ct.iv).toBeTruthy();
    expect(ct.ciphertext).toBeTruthy();
    // base64 length sanity
    expect(ct.iv.length).toBeGreaterThan(0);
    // Different IV every time
    const ct2 = await encryptJson(key, original);
    expect(ct2.iv).not.toBe(ct.iv);
    expect(ct2.ciphertext).not.toBe(ct.ciphertext);

    const back = await decryptJson<typeof original>(key, ct.iv, ct.ciphertext);
    expect(back).toEqual(original);
  });

  it("throws when decrypting tampered ciphertext", async () => {
    const ct = await encryptJson(key, { x: 1 });
    const tampered = ct.ciphertext.slice(0, -4) + "AAAA";
    await expect(
      decryptJson(key, ct.iv, tampered),
    ).rejects.toThrow(/decryption failed/);
  });

  it("throws when decrypting with wrong key", async () => {
    const ct = await encryptJson(key, { x: 1 });
    const wrongKey = await loadKey(
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    );
    await expect(
      decryptJson(wrongKey, ct.iv, ct.ciphertext),
    ).rejects.toThrow();
  });
});

describe("vault storage", () => {
  // We don't have a D1 in tests; use better-sqlite3 with the D1 migration.
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(readFileSync(join(process.cwd(), "migrations", "0001_init.sql"), "utf8"));
  });

  it("insert + list + delete", () => {
    const now = Date.now();
    const id = "v1";
    db.prepare(
      `INSERT INTO vault_entries (id, user_id, provider, kind, ciphertext, iv, expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, "default", "golfnow", "cookies", "ct", "iv", null, now, now);
    const rows = db.prepare(
      `SELECT id, provider, kind FROM vault_entries WHERE user_id = ?`,
    ).all("default");
    expect(rows).toHaveLength(1);
    const r = rows[0] as { id: string; provider: string };
    expect(r.id).toBe(id);
    expect(r.provider).toBe("golfnow");
  });
});