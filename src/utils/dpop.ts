import { base64UrlEncode } from '../core/base64url';
import { randomString } from '../core/pkce';
import { AuthError, AuthErrorCode } from '../errors/auth-error';

/**
 * DPoP (RFC 9449) client-side proof signer. Holds an ES256 key pair and mints
 * the proof JWTs the Nuria kernel validates in `DpopProofValidator`:
 *
 *   header  { "typ": "dpop+jwt", "alg": "ES256", "jwk": <public EC key> }
 *   payload { "htm", "htu", "iat", "jti", "ath"? }
 *
 * Bind a session by attaching a proof to the token request (`htm`/`htu` of the
 * token endpoint, no `ath`); the kernel then stamps `cnf.jkt` onto the access
 * token. Present the bound token by attaching, to every resource request, the
 * access token under the `DPoP` auth scheme plus a fresh proof carrying `ath`
 * = base64url(SHA-256(accessToken)).
 *
 * The private key is generated non-extractable, so it never leaves the agent;
 * {@link persistDpopSigner} / {@link loadDpopSigner} round-trip the live
 * `CryptoKey` through IndexedDB (structured clone) without ever serializing the
 * raw key material.
 */

const SIGN_ALGORITHM: EcdsaParams & EcKeyGenParams = {
  name: 'ECDSA',
  namedCurve: 'P-256',
  hash: 'SHA-256',
} as EcdsaParams & EcKeyGenParams;

function getCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  throw new AuthError(
    AuthErrorCode.INVALID_CONFIG,
    'Web Crypto (crypto.subtle) is unavailable — DPoP requires a secure context',
  );
}

function jsonToBase64Url(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/** Parameters for a single DPoP proof. */
export interface DpopProofParams {
  /** HTTP method (`GET`, `POST`, …) — emitted uppercased as `htm`. */
  htm: string;
  /** Target URL — `htu` is its scheme+authority+path (query/fragment stripped). */
  htu: string;
  /**
   * Access token to bind the proof to. Pass it on resource requests so the
   * proof carries `ath`; omit on the token request that first binds the token.
   */
  accessToken?: string;
}

export class DpopSigner {
  /** Cached RFC 7638 thumbprint (`jkt`) and the public JWK for the header. */
  private publicJwk: { kty: string; crv: string; x: string; y: string } | null =
    null;
  private thumbprint: string | null = null;

  constructor(
    private readonly keyPair: CryptoKeyPair,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The live key pair — pass to {@link persistDpopSigner} to store it. */
  getKeyPair(): CryptoKeyPair {
    return this.keyPair;
  }

  /** Public key as a JWK (the `jwk` proof header). */
  async getPublicJwk(): Promise<{
    kty: string;
    crv: string;
    x: string;
    y: string;
  }> {
    if (this.publicJwk) return this.publicJwk;
    const jwk = await getCrypto().subtle.exportKey('jwk', this.keyPair.publicKey);
    if (!jwk.x || !jwk.y) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'DPoP public key could not be exported as an EC JWK',
      );
    }
    // Only the canonical EC members, in the order RFC 7638 mandates for the
    // thumbprint. Reused verbatim as the proof header `jwk`.
    this.publicJwk = { crv: jwk.crv ?? 'P-256', kty: 'EC', x: jwk.x, y: jwk.y };
    return this.publicJwk;
  }

  /** RFC 7638 JWK SHA-256 thumbprint (base64url) — the token's `cnf.jkt`. */
  async getThumbprint(): Promise<string> {
    if (this.thumbprint) return this.thumbprint;
    const jwk = await this.getPublicJwk();
    // Canonical form: lexicographically ordered members, no whitespace.
    const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
    const digest = await getCrypto().subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonical),
    );
    this.thumbprint = base64UrlEncode(digest);
    return this.thumbprint;
  }

  /** Builds and signs a DPoP proof JWT for one request. */
  async createProof(params: DpopProofParams): Promise<string> {
    const jwk = await this.getPublicJwk();
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk };

    const payload: Record<string, unknown> = {
      htm: params.htm.toUpperCase(),
      htu: normalizeHtu(params.htu),
      iat: Math.floor(this.now() / 1000),
      jti: randomString(32),
    };
    if (params.accessToken) {
      payload.ath = await computeAth(params.accessToken);
    }

    const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
    const signature = await getCrypto().subtle.sign(
      SIGN_ALGORITHM,
      this.keyPair.privateKey,
      new TextEncoder().encode(signingInput),
    );
    // WebCrypto ECDSA already returns the IEEE P1363 (r‖s) form JOSE expects.
    return `${signingInput}.${base64UrlEncode(signature)}`;
  }
}

/**
 * `htu` is the request URL with the query and fragment stripped (RFC 9449
 * §4.3). Anything that isn't a valid absolute URL is passed through unchanged
 * so the server-side mismatch check is the single source of truth.
 */
function normalizeHtu(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** base64url(SHA-256(ascii(accessToken))) — the RFC 9449 `ath` claim. */
async function computeAth(accessToken: string): Promise<string> {
  const ascii = new Uint8Array(accessToken.length);
  for (let i = 0; i < accessToken.length; i++) {
    ascii[i] = accessToken.charCodeAt(i) & 0xff;
  }
  const digest = await getCrypto().subtle.digest('SHA-256', ascii);
  return base64UrlEncode(digest);
}

/**
 * Creates a DPoP signer with a fresh, non-extractable ES256 key pair. Generate
 * one per browser session (or persist it with {@link persistDpopSigner}) and
 * pass it as `dpop` to `createAuthClient` to enable sender-constrained tokens.
 */
export async function createDpopSigner(options?: {
  now?: () => number;
}): Promise<DpopSigner> {
  const keyPair = await getCrypto().subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // non-extractable private key — never leaves the runtime
    ['sign', 'verify'],
  );
  return new DpopSigner(keyPair, options?.now);
}

// ── IndexedDB persistence ──────────────────────────────────────────────────

const DEFAULT_DB = 'nuria-auth';
const DEFAULT_STORE = 'dpop';
const DEFAULT_KEY = 'signer';

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new AuthError(
          AuthErrorCode.STORAGE_ERROR,
          'IndexedDB is unavailable — cannot persist the DPoP key',
        ),
      );
      return;
    }
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface DpopPersistenceOptions {
  dbName?: string;
  storeName?: string;
  key?: string;
}

/**
 * Stores the signer's `CryptoKeyPair` in IndexedDB so the same DPoP key (and
 * therefore the same `cnf.jkt` binding) survives reloads. The private key is
 * non-extractable; only the opaque key handle is persisted.
 */
export async function persistDpopSigner(
  signer: DpopSigner,
  options: DpopPersistenceOptions = {},
): Promise<void> {
  const dbName = options.dbName ?? DEFAULT_DB;
  const storeName = options.storeName ?? DEFAULT_STORE;
  const db = await openDb(dbName, storeName);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(signer.getKeyPair(), options.key ?? DEFAULT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Loads a previously {@link persistDpopSigner}d signer, or `null` when none is
 * stored. Pair with `createDpopSigner` + `persistDpopSigner` on a cache miss to
 * establish a stable per-device DPoP key.
 */
export async function loadDpopSigner(
  options: DpopPersistenceOptions & { now?: () => number } = {},
): Promise<DpopSigner | null> {
  const dbName = options.dbName ?? DEFAULT_DB;
  const storeName = options.storeName ?? DEFAULT_STORE;
  const db = await openDb(dbName, storeName);
  try {
    const keyPair = await new Promise<CryptoKeyPair | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(options.key ?? DEFAULT_KEY);
        req.onsuccess = () => resolve(req.result as CryptoKeyPair | undefined);
        req.onerror = () => reject(req.error);
      },
    );
    if (!keyPair?.privateKey || !keyPair?.publicKey) return null;
    return new DpopSigner(keyPair, options.now);
  } finally {
    db.close();
  }
}
