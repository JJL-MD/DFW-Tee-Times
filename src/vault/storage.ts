/**
 * Vault storage — D1 row CRUD with AES-GCM ciphertext.
 */
import {
  VaultEntrySchema,
  type Provider,
  type VaultCookie,
  type VaultEntry,
  type VaultKind,
} from "../types";
import { encryptJson, decryptJson, loadKey } from "./crypto";

export interface VaultEntryInput {
  provider: Provider;
  kind: VaultKind;
  payload: VaultCookie[] | { username: string; password: string };
  userId?: string;
  expiresAt?: number | null;
}

export interface VaultRow {
  id: string;
  userId: string;
  provider: Provider;
  kind: VaultKind;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export class VaultStorage {
  private readonly db: D1Database;
  private readonly userId: string;

  constructor(db: D1Database, userId: string = "default") {
    this.db = db;
    this.userId = userId;
  }

  /** Encrypt + insert/replace. */
  async put(
    input: VaultEntryInput,
    masterKeyHex: string,
  ): Promise<VaultEntry> {
    const key = await loadKey(masterKeyHex);
    const { iv, ciphertext } = await encryptJson(key, input.payload);
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = input.expiresAt ?? null;
    await this.db
      .prepare(
        `INSERT INTO vault_entries
         (id, user_id, provider, kind, ciphertext, iv, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider) DO UPDATE SET
           kind = excluded.kind,
           ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        input.userId ?? this.userId,
        input.provider,
        input.kind,
        ciphertext,
        iv,
        expiresAt,
        now,
        now,
      )
      .run();
    return VaultEntrySchema.parse({
      id,
      userId: input.userId ?? this.userId,
      provider: input.provider,
      kind: input.kind,
      ciphertext,
      iv,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Read + decrypt. Returns the payload (cookies array or username/password) and the row. */
  async get(
    provider: Provider,
    masterKeyHex: string,
  ): Promise<{ row: VaultEntry; payload: VaultCookie[] | { username: string; password: string } } | null> {
    const result = await this.db
      .prepare(
        `SELECT id, user_id, provider, kind, ciphertext, iv, expires_at, created_at, updated_at
         FROM vault_entries WHERE user_id = ? AND provider = ?`,
      )
      .bind(this.userId, provider)
      .first<{
        id: string;
        user_id: string;
        provider: Provider;
        kind: VaultKind;
        ciphertext: string;
        iv: string;
        expires_at: number | null;
        created_at: number;
        updated_at: number;
      }>();
    if (!result) return null;
    const row = VaultEntrySchema.parse({
      id: result.id,
      userId: result.user_id,
      provider: result.provider,
      kind: result.kind,
      ciphertext: result.ciphertext,
      iv: result.iv,
      expiresAt: result.expires_at,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    });
    const key = await loadKey(masterKeyHex);
    const payload = await decryptJson<VaultCookie[] | { username: string; password: string }>(key, row.iv, row.ciphertext);
    return { row, payload };
  }

  /** List rows (without decrypting). */
  async list(): Promise<VaultRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, user_id, provider, kind, expires_at, created_at, updated_at
         FROM vault_entries WHERE user_id = ?
         ORDER BY provider ASC`,
      )
      .bind(this.userId)
      .all<{
        id: string;
        user_id: string;
        provider: Provider;
        kind: VaultKind;
        expires_at: number | null;
        created_at: number;
        updated_at: number;
      }>();
    return (rows.results ?? []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      provider: r.provider,
      kind: r.kind,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async delete(provider: Provider): Promise<boolean> {
    const res = await this.db
      .prepare(`DELETE FROM vault_entries WHERE user_id = ? AND provider = ?`)
      .bind(this.userId, provider)
      .run();
    return res.success;
  }

  /**
   * Decrypt + return cookies (shorthand). Throws if kind !== 'cookies'.
   */
  async getCookies(
    provider: Provider,
    masterKeyHex: string,
  ): Promise<VaultCookie[] | null> {
    const got = await this.get(provider, masterKeyHex);
    if (!got) return null;
    if (got.row.kind !== "cookies") {
      throw new Error(`vault entry for ${provider} is kind=${got.row.kind}, expected cookies`);
    }
    return got.payload as VaultCookie[];
  }
}