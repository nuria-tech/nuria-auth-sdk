import { AuthError, AuthErrorCode } from '../errors/auth-error';
import type { StorageAdapter, TokenSet } from './types';

export const STORAGE_KEYS = {
  session: 'nuria:session',
  state: 'nuria:oauth:state',
  codeVerifier: 'nuria:oauth:code_verifier',
  nonce: 'nuria:oauth:nonce',
  // One-shot marker set by `logout()` (default behavior) and consumed by
  // the next `startLogin()` call to force `prompt=login` — i.e. the IdP
  // must render its login UI even if the SSO session is still warm.
  // Cleared after consumption so subsequent logins resume normal SSO.
  forceReloginNext: 'nuria:auth:force_relogin_next',
};

export function normalizeTokenSet(
  raw: Record<string, unknown>,
  now: () => number,
): TokenSet {
  const accessToken = (raw.access_token ??
    raw.accessToken ??
    raw.Token ??
    raw.token) as string;
  if (!accessToken || typeof accessToken !== 'string') {
    throw new AuthError(
      AuthErrorCode.TOKEN_EXCHANGE_FAILED,
      'Missing access token in token response',
    );
  }
  const expiresIn = Number(raw.expires_in ?? raw.expiresIn ?? 0) || undefined;
  const expiresAtFromResponse = (() => {
    const v = raw.ExpiresAt ?? raw.expiresAt;
    if (!v) return undefined;
    const n = Number(v);
    if (!isNaN(n) && n > 0) return n;
    const d = new Date(String(v)).getTime();
    return isNaN(d) ? undefined : d;
  })();
  const computedExpiresAt =
    expiresIn != null
      ? now() + expiresIn * 1000
      : expiresAtFromResponse
        ? expiresAtFromResponse
        : undefined;
  return {
    accessToken,
    tokenType: (raw.token_type ?? raw.tokenType ?? raw.TokenType) as
      | string
      | undefined,
    expiresIn,
    refreshToken: (raw.refresh_token ??
      raw.refreshToken ??
      raw.RefreshToken) as string | undefined,
    idToken: (raw.id_token ?? raw.idToken) as string | undefined,
    scope: raw.scope as string | undefined,
    expiresAt: computedExpiresAt,
    authProvider: (raw.auth_provider ?? raw.authProvider) as string | undefined,
  };
}

export async function safeGet(
  storage: StorageAdapter,
  key: string,
): Promise<string | null> {
  try {
    return await storage.get(key);
  } catch (cause) {
    throw new AuthError(
      AuthErrorCode.STORAGE_ERROR,
      `Failed reading key: ${key}`,
      cause,
    );
  }
}

export async function safeSet(
  storage: StorageAdapter,
  key: string,
  value: string,
): Promise<void> {
  try {
    await storage.set(key, value);
  } catch (cause) {
    throw new AuthError(
      AuthErrorCode.STORAGE_ERROR,
      `Failed writing key: ${key}`,
      cause,
    );
  }
}

export async function safeRemove(
  storage: StorageAdapter,
  key: string,
): Promise<void> {
  try {
    await storage.remove(key);
  } catch (cause) {
    throw new AuthError(
      AuthErrorCode.STORAGE_ERROR,
      `Failed removing key: ${key}`,
      cause,
    );
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new AuthError(AuthErrorCode.CALLBACK_ERROR, 'Invalid callback URL');
  }
}
