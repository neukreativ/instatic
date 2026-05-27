/**
 * AES-256-GCM encryption for AI provider credentials.
 *
 * Plaintext API keys are encrypted at the repository boundary; the
 * `CryptoKey` is derived once from the master secret (`masterKey.ts`) and
 * reused across calls. Each record gets a fresh 96-bit random IV — never
 * reused — so two rows storing the same plaintext have different
 * ciphertexts.
 *
 * Uses Bun's native `crypto.subtle` (WHATWG Web Crypto API). Same pattern
 * already used in `server/plugins/host/handlers/crypto.ts` — no vendored
 * crypto library.
 *
 * The plain key bytes never leave this module's call frame. Callers receive
 * `{ ciphertext, iv }` for persistence; on decrypt they hand both back and
 * receive plaintext. The repository never serialises the plaintext over
 * HTTP — gated by `ai-credentials-never-leak.test.ts`.
 */

const ALG_NAME = 'AES-GCM' as const
const IV_BYTE_LENGTH = 12 // 96 bits — the AES-GCM recommended size

export interface EncryptedSecret {
  ciphertext: Uint8Array
  iv: Uint8Array
}

/**
 * Encrypt a UTF-8 string with the master key. Returns ciphertext + IV; both
 * must be persisted together to permit decryption.
 */
export async function encryptSecret(
  masterKey: CryptoKey,
  plaintext: string,
): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH))
  const data = new TextEncoder().encode(plaintext)
  // BufferSource cast: Bun's TypeScript lib types Uint8Array as
  // `Uint8Array<ArrayBufferLike>`, while WebCrypto's `BufferSource` insists
  // on `ArrayBufferView<ArrayBuffer>`. Functionally identical; the cast is
  // the standard escape hatch for this mismatch.
  const buffer = await crypto.subtle.encrypt(
    { name: ALG_NAME, iv: iv as BufferSource },
    masterKey,
    data as BufferSource,
  )
  return { ciphertext: new Uint8Array(buffer), iv }
}

/**
 * Decrypt an `EncryptedSecret`. Throws if the ciphertext was tampered with,
 * the IV is wrong, or the key doesn't match.
 *
 * The caller MUST scope the returned string to a single-call boundary
 * (driver invocation). Storing it in a long-lived variable or logging it
 * defeats the at-rest protection.
 */
export async function decryptSecret(
  masterKey: CryptoKey,
  encrypted: EncryptedSecret,
): Promise<string> {
  const buffer = await crypto.subtle.decrypt(
    { name: ALG_NAME, iv: encrypted.iv as BufferSource },
    masterKey,
    encrypted.ciphertext as BufferSource,
  )
  return new TextDecoder().decode(buffer)
}
