import { AuthError, AuthErrorCode } from '../errors/auth-error';
import { createCodeChallenge, randomString } from '../core/pkce';
import { timingSafeEqual } from '../core/utils';

/**
 * sessionStorage key prefix for the per-state PKCE bag. Each in-flight login
 * gets its own key (`<prefix><state>`) so concurrent tabs do not clobber
 * each other.
 */
export const AWS_STORAGE_KEYS = {
  pkcePrefix: 'nuria:aws:pkce:',
} as const;

interface AwsPkceBag {
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  clientId: string;
  tokenEndpoint: string;
  returnSearch: string;
  /** Unix-seconds timestamp of bag creation; used to GC abandoned flows. */
  createdAt: number;
}

/**
 * Maximum lifetime of an AWS PKCE bag. AWS authorize requests timeout in
 * minutes; anything older than this is an abandoned flow that we sweep on
 * the next `startAwsLogin` so `sessionStorage` doesn't accumulate stale
 * verifiers across the tab's lifetime.
 */
const AWS_PKCE_BAG_TTL_MS = 10 * 60 * 1000;

export interface StartAwsLoginOptions {
  /**
   * Client ID of the customer-managed application registered in AWS
   * IAM Identity Center.
   */
  clientId: string;
  /** Callback URL registered in the customer-managed application. */
  redirectUri: string;
  /**
   * Issuer URL of the IAM Identity Center instance — copy from the
   * customer-managed application's "Issuer URL" field
   * (`https://identitycenter.amazonaws.com/ssoins-XXXX/`). Both
   * `${issuerUrl}/authorize` and `${issuerUrl}/token` are derived
   * unless `authorizationEndpoint` / `tokenEndpoint` override them.
   */
  issuerUrl?: string;
  /** Fully-qualified authorization endpoint — overrides `issuerUrl`. */
  authorizationEndpoint?: string;
  /** Fully-qualified token endpoint — overrides `issuerUrl`. */
  tokenEndpoint?: string;
  /** OAuth scopes; defaults to `'openid email profile'`. */
  scopes?: string[];
  /** window.location.search to restore after callback. */
  returnSearch?: string;
  onRedirect?: (url: string) => void;
}

export interface AwsCallbackResult {
  idToken: string;
  returnSearch: string;
}

function resolveAuthorizationEndpoint(opts: StartAwsLoginOptions): string {
  if (opts.authorizationEndpoint) return opts.authorizationEndpoint;
  if (!opts.issuerUrl) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'startAwsLogin: provide either `issuerUrl` or `authorizationEndpoint`',
    );
  }
  return `${opts.issuerUrl.replace(/\/+$/, '')}/authorize`;
}

function resolveTokenEndpoint(opts: StartAwsLoginOptions): string {
  if (opts.tokenEndpoint) return opts.tokenEndpoint;
  if (!opts.issuerUrl) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'startAwsLogin: provide either `issuerUrl` or `tokenEndpoint`',
    );
  }
  return `${opts.issuerUrl.replace(/\/+$/, '')}/token`;
}

function bagKey(state: string): string {
  return `${AWS_STORAGE_KEYS.pkcePrefix}${state}`;
}

function readBag(state: string): AwsPkceBag | null {
  const raw = sessionStorage.getItem(bagKey(state));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AwsPkceBag>;
    if (
      typeof parsed.codeVerifier !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.redirectUri !== 'string' ||
      typeof parsed.clientId !== 'string' ||
      typeof parsed.tokenEndpoint !== 'string' ||
      typeof parsed.returnSearch !== 'string' ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null;
    }
    return parsed as AwsPkceBag;
  } catch {
    return null;
  }
}

/**
 * Sweeps abandoned PKCE bags older than {@link AWS_PKCE_BAG_TTL_MS}. Called
 * at the start of every `startAwsLogin`, so a tab that initiates a long
 * series of AWS logins without ever completing the callback won't leak
 * verifiers into `sessionStorage` indefinitely.
 *
 * Bags missing `createdAt` (legacy entries written before the field was
 * introduced) are also evicted on first sweep.
 */
function gcExpiredBags(now: number): void {
  if (typeof sessionStorage === 'undefined') return;
  const expired: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (!key || !key.startsWith(AWS_STORAGE_KEYS.pkcePrefix)) continue;
    const raw = sessionStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<AwsPkceBag>;
      const createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : 0;
      if (now - createdAt > AWS_PKCE_BAG_TTL_MS) expired.push(key);
    } catch {
      expired.push(key);
    }
  }
  for (const key of expired) sessionStorage.removeItem(key);
}

interface AwsIdTokenClaims {
  nonce: string | null;
  aud: string | null;
  exp: number | null;
}

function decodeIdTokenClaims(jwt: string): AwsIdTokenClaims {
  const empty: AwsIdTokenClaims = { nonce: null, aud: null, exp: null };
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return empty;
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
    // `aud` may be a string or an array per RFC 7519 — accept either, but
    // we only use it for an exact-match check below.
    let aud: string | null = null;
    if (typeof payload.aud === 'string') aud = payload.aud;
    else if (Array.isArray(payload.aud)) {
      const first = payload.aud.find((v) => typeof v === 'string');
      if (typeof first === 'string') aud = first;
    }
    return {
      nonce: typeof payload.nonce === 'string' ? payload.nonce : null,
      aud,
      exp: typeof payload.exp === 'number' ? payload.exp : null,
    };
  } catch {
    return empty;
  }
}

/**
 * Initiates the AWS IAM Identity Center OAuth 2.1 Authorization Code + PKCE
 * flow for a customer-managed application. Generates a code_verifier
 * (S256 challenge), state and nonce; stores the PKCE bag keyed by `state`
 * in sessionStorage; redirects to the authorization endpoint with
 * `response_type=code`.
 *
 * Replaces the legacy implicit (`response_type=id_token`) flow. The id_token
 * is no longer carried in the URL fragment — it is fetched server-to-server
 * by the browser at the token endpoint after the code is returned.
 */
export async function startAwsLogin(
  options: StartAwsLoginOptions,
): Promise<void> {
  const codeVerifier = randomString(96);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = randomString(32);
  const nonce = randomString(32);

  const tokenEndpoint = resolveTokenEndpoint(options);
  const authorizationEndpoint = resolveAuthorizationEndpoint(options);

  // Evict any abandoned bags from prior aborted flows before adding a new
  // one. Without this sweep, a long-lived tab that re-initiates login
  // without ever completing a callback accumulates verifiers in
  // sessionStorage forever.
  gcExpiredBags(Date.now());

  const bag: AwsPkceBag = {
    codeVerifier,
    nonce,
    redirectUri: options.redirectUri,
    clientId: options.clientId,
    tokenEndpoint,
    returnSearch: options.returnSearch ?? '',
    createdAt: Date.now(),
  };
  sessionStorage.setItem(bagKey(state), JSON.stringify(bag));

  const scope = (options.scopes ?? ['openid', 'email', 'profile']).join(' ');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const separator = authorizationEndpoint.includes('?') ? '&' : '?';
  const url = `${authorizationEndpoint}${separator}${params.toString()}`;

  if (options.onRedirect) {
    options.onRedirect(url);
    return;
  }
  window.location.replace(url);
}

/**
 * Parses an AWS IAM Identity Center authorization-code callback from the URL
 * query, exchanges the code at the token endpoint with the stored
 * code_verifier, validates the nonce in the returned id_token, and resolves
 * with the id_token.
 *
 * Returns `null` when the URL has no `code` parameter (caller should treat
 * the page as a non-callback navigation). Throws `AuthError` for explicit
 * failure modes — provider error in the URL, missing/expired PKCE bag,
 * token-exchange failure, or nonce mismatch.
 */
export async function parseAwsQueryCallback(
  search: string,
): Promise<AwsCallbackResult | null> {
  if (!search) return null;
  const params = new URLSearchParams(
    search.startsWith('?') ? search.substring(1) : search,
  );

  const errorCode = params.get('error');
  if (errorCode) {
    const description = params.get('error_description');
    throw new AuthError(
      AuthErrorCode.CALLBACK_ERROR,
      description ? `${errorCode}: ${description}` : errorCode,
    );
  }

  const code = params.get('code');
  if (!code) return null;

  const state = params.get('state');
  if (!state) {
    throw new AuthError(
      AuthErrorCode.MISSING_STATE,
      'AWS callback is missing `state`',
    );
  }

  const bag = readBag(state);
  if (!bag) {
    throw new AuthError(
      AuthErrorCode.STATE_MISMATCH,
      'AWS callback state does not match any in-flight login',
    );
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: bag.redirectUri,
      client_id: bag.clientId,
      code_verifier: bag.codeVerifier,
    });

    let response: Response;
    try {
      response = await fetch(bag.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (cause) {
      throw new AuthError(
        AuthErrorCode.NETWORK_ERROR,
        'AWS token endpoint request failed',
        cause,
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const data = (await response.json()) as {
          error?: string;
          error_description?: string;
        };
        detail = data.error_description ?? data.error ?? '';
      } catch {
        // body is not JSON — fall through with empty detail
      }
      throw new AuthError(
        AuthErrorCode.TOKEN_EXCHANGE_FAILED,
        detail
          ? `AWS token exchange failed: ${detail}`
          : `AWS token exchange failed (HTTP ${response.status})`,
      );
    }

    const tokens = (await response.json()) as { id_token?: string };
    const idToken = tokens.id_token;
    if (!idToken || typeof idToken !== 'string') {
      throw new AuthError(
        AuthErrorCode.TOKEN_EXCHANGE_FAILED,
        'AWS token response is missing id_token',
      );
    }

    // Defense in depth: the Nuria backend must re-verify the id_token's
    // signature and claims against the AWS JWKS, but we surface obvious
    // problems here so we never forward a token that's already
    // expired/wrong-audience to the kernel — and so a misconfigured
    // tokenEndpoint that returns *any* JWT can't ride through.
    const claims = decodeIdTokenClaims(idToken);
    if (!claims.nonce || !timingSafeEqual(bag.nonce, claims.nonce)) {
      throw new AuthError(
        AuthErrorCode.STATE_MISMATCH,
        'AWS id_token nonce validation failed — possible replay attack',
      );
    }
    if (claims.exp !== null && claims.exp * 1000 <= Date.now()) {
      throw new AuthError(
        AuthErrorCode.TOKEN_EXCHANGE_FAILED,
        'AWS id_token is already expired',
      );
    }
    if (claims.aud !== null && claims.aud !== bag.clientId) {
      throw new AuthError(
        AuthErrorCode.TOKEN_EXCHANGE_FAILED,
        'AWS id_token audience does not match this client',
      );
    }

    return { idToken, returnSearch: bag.returnSearch };
  } finally {
    sessionStorage.removeItem(bagKey(state));
  }
}
