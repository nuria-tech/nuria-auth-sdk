import { AuthError, AuthErrorCode } from '../errors/auth-error';
import type { StorageAdapter, TokenSet } from './types';

export const STORAGE_KEYS = {
  session: 'nuria:session',
  state: 'nuria:oauth:state',
  codeVerifier: 'nuria:oauth:code_verifier',
};

export function normalizeTokenSet(raw: any, now: () => number): TokenSet {
  const accessToken = raw?.access_token ?? raw?.accessToken;
  if (!accessToken || typeof accessToken !== 'string') {
    throw new AuthError(AuthErrorCode.TOKEN_EXCHANGE_FAILED, 'Missing access token in token response');
  }
  const expiresIn = Number(raw?.expires_in ?? raw?.expiresIn ?? 0) || undefined;
  return {
    accessToken,
    tokenType: raw?.token_type ?? raw?.tokenType,
    expiresIn,
    refreshToken: raw?.refresh_token ?? raw?.refreshToken,
    idToken: raw?.id_token ?? raw?.idToken,
    scope: raw?.scope,
    expiresAt: expiresIn ? now() + expiresIn * 1000 : undefined,
  };
}

export async function safeGet(storage: StorageAdapter, key: string): Promise<string | null> {
  try {
    return await storage.get(key);
  } catch (cause) {
    throw new AuthError(AuthErrorCode.STORAGE_ERROR, `Failed reading key: ${key}`, cause);
  }
}

export async function safeSet(storage: StorageAdapter, key: string, value: string): Promise<void> {
  try {
    await storage.set(key, value);
  } catch (cause) {
    throw new AuthError(AuthErrorCode.STORAGE_ERROR, `Failed writing key: ${key}`, cause);
  }
}

export async function safeRemove(storage: StorageAdapter, key: string): Promise<void> {
  try {
    await storage.remove(key);
  } catch (cause) {
    throw new AuthError(AuthErrorCode.STORAGE_ERROR, `Failed removing key: ${key}`, cause);
  }
}

export function resolveUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new AuthError(AuthErrorCode.CALLBACK_ERROR, 'Invalid callback URL');
  }
}
