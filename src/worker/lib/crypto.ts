/**
 * AES-256-GCM encryption for ad-platform OAuth tokens at rest.
 * Output format: base64(iv[12] || ciphertext+tag).
 * Key: TOKEN_ENCRYPTION_KEY secret, base64-encoded 32 bytes.
 */
const IV_BYTES = 12;

async function importKey(b64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64Key), (ch) => ch.charCodeAt(0));
  if (raw.byteLength !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function encryptSecret(plaintext: string, b64Key: string): Promise<string> {
  const key = await importKey(b64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(IV_BYTES + ct.byteLength);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return toB64(out);
}

export async function decryptSecret(payload: string, b64Key: string): Promise<string> {
  const key = await importKey(b64Key);
  const bytes = Uint8Array.from(atob(payload), (ch) => ch.charCodeAt(0));
  const iv = bytes.slice(0, IV_BYTES);
  const ct = bytes.slice(IV_BYTES);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
