const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

function getCryptoImpl(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API unavailable');
}

export function randomString(length = 64): string {
  const crypto = getCryptoImpl();
  // Rejection sampling: discard bytes >= threshold to eliminate modulo bias.
  // ALPHABET.length = 66; threshold = 256 - (256 % 66) = 204
  const THRESHOLD = 256 - (256 % ALPHABET.length);
  const result: string[] = [];
  while (result.length < length) {
    const bytes = new Uint8Array(Math.ceil((length - result.length) * 1.4));
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (result.length >= length) break;
      if (b < THRESHOLD) result.push(ALPHABET[b % ALPHABET.length]!);
    }
  }
  return result.join('');
}

function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function verifierToBytes(verifier: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(verifier.length);
  for (let i = 0; i < verifier.length; i++) {
    bytes[i] = verifier.charCodeAt(i);
  }
  return bytes;
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const crypto = getCryptoImpl();
  const buffer = verifierToBytes(verifier);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return toBase64Url(new Uint8Array(digest));
}
