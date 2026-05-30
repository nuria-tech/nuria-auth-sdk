/**
 * Base64URL (RFC 4648 §5) codec shared by the WebAuthn and DPoP helpers.
 *
 * The browser WebAuthn API speaks `ArrayBuffer`/`Uint8Array` for challenges,
 * credential ids and signatures, while the Nuria kernel exchanges them as
 * base64url strings (no padding). DPoP proof JWTs are likewise base64url.
 * These two functions are the single conversion choke point so encoding bugs
 * can't drift between call sites.
 */

/** Encodes raw bytes to an unpadded base64url string. */
export function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // Chunk to stay well under argument-count limits for very large buffers
  // (attestation objects can be a few KB) without building a giant array.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decodes an unpadded (or padded) base64url string to bytes. */
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
