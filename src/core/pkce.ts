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
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function verifierToBytes(verifier: string): Uint8Array {
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
