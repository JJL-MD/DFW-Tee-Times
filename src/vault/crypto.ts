/**
 * Vault crypto — AES-GCM encryption using WebCrypto.
 *
 * Master key is a 32-byte hex string sourced from Workers Secrets
 * (VAULT_MASTER_KEY). Per-entry IVs are random 12 bytes.
 *
 * Output format: base64(IV) + ":" + base64(ciphertext+tag)
 * Stored in D1 alongside the vault entry row.
 */
const ALG = "AES-GCM";
const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;

export interface CipherText {
  iv: string; // base64
  ciphertext: string; // base64 (includes auth tag)
}

export class VaultCryptoError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "VaultCryptoError";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function loadKey(masterKeyHex: string): Promise<CryptoKey> {
  if (masterKeyHex.length !== KEY_LENGTH_BITS / 4) {
    throw new VaultCryptoError(
      `VAULT_MASTER_KEY must be ${KEY_LENGTH_BITS / 4} hex chars (got ${masterKeyHex.length})`,
    );
  }
  const raw = new Uint8Array(KEY_LENGTH_BITS / 8);
  for (let i = 0; i < raw.length; i++) {
    const byte = parseInt(masterKeyHex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new VaultCryptoError("VAULT_MASTER_KEY contains non-hex chars");
    }
    raw[i] = byte;
  }
  // Cast to ArrayBuffer explicitly so BufferSource accepts it under
  // TS lib settings that distinguish SharedArrayBuffer from ArrayBuffer.
  return crypto.subtle.importKey(
    "raw",
    raw.buffer as ArrayBuffer,
    { name: ALG, length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJson(
  key: CryptoKey,
  plaintext: unknown,
): Promise<CipherText> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const data = new TextEncoder().encode(JSON.stringify(plaintext));
  const ct = await crypto.subtle.encrypt({ name: ALG, iv }, key, data);
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ct)),
  };
}

export async function decryptJson<T = unknown>(
  key: CryptoKey,
  iv: string,
  ciphertext: string,
): Promise<T> {
  const ivBytes = base64ToBytes(iv);
  const ctBytes = base64ToBytes(ciphertext);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: ALG, iv: ivBytes }, key, ctBytes);
  } catch (err) {
    throw new VaultCryptoError(
      "decryption failed — wrong key or tampered ciphertext",
      err,
    );
  }
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}