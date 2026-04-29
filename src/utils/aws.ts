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
}

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
      typeof parsed.returnSearch !== 'string'
    ) {
      return null;
    }
    return parsed as AwsPkceBag;
  } catch {
    return null;
  }
}

function decodeJwtNonce(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
    return typeof payload.nonce === 'string' ? payload.nonce : null;
  } catch {
    return null;
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

  const bag: AwsPkceBag = {
    codeVerifier,
    nonce,
    redirectUri: options.redirectUri,
    clientId: options.clientId,
    tokenEndpoint,
    returnSearch: options.returnSearch ?? '',
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
        const data = (await response.json()) as { error?: string; error_description?: string };
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

    const tokenNonce = decodeJwtNonce(idToken);
    if (!tokenNonce || !timingSafeEqual(bag.nonce, tokenNonce)) {
      throw new AuthError(
        AuthErrorCode.STATE_MISMATCH,
        'AWS id_token nonce validation failed — possible replay attack',
      );
    }

    return { idToken, returnSearch: bag.returnSearch };
  } finally {
    sessionStorage.removeItem(bagKey(state));
  }
}
