import { DefaultAuthClient } from './nuria-auth-client';
import { AuthError, AuthErrorCode } from '../errors/auth-error';
import type { AuthClient, AuthConfig, ResolvedAuthConfig } from '../core/types';

const DEFAULT_AUTH_BASE_URL = 'https://ms-auth-v2.nuria.com.br';
const DEFAULT_AUTHORIZATION_PATH = '/v2/oauth/authorize';
const DEFAULT_TOKEN_PATH = '/v2/oauth/token';
const DEFAULT_USERINFO_PATH = '/v2/oauth/userinfo';
const DEFAULT_SCOPE = 'openid profile email';

function isSecureUrl(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  // Allow http:// only for localhost in development
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]')
  );
}

function normalizeBaseUrl(value?: string): string {
  const raw = String(value ?? DEFAULT_AUTH_BASE_URL).trim();
  if (!raw) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.baseUrl must be a valid absolute URL',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.baseUrl must be a valid absolute URL',
    );
  }

  if (!isSecureUrl(parsed)) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.baseUrl must use https:// (or http:// only for localhost)',
    );
  }

  return parsed.toString().replace(/\/+$/, '');
}

function resolveEndpoint(
  baseUrl: string,
  explicit: string | undefined,
  fallbackPath: string,
): string {
  if (explicit) {
    let parsed: URL;
    try {
      parsed = new URL(explicit);
    } catch {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'OAuth endpoints must be valid absolute URLs',
      );
    }
    if (!isSecureUrl(parsed)) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'OAuth endpoints must use https:// (or http:// only for localhost)',
      );
    }
    return parsed.toString();
  }

  return new URL(fallbackPath, `${baseUrl}/`).toString();
}

export function createAuthClient(config: AuthConfig): AuthClient {
  if (!config?.clientId) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.clientId is required',
    );
  }
  if (!config.redirectUri) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.redirectUri is required',
    );
  }
  let redirectUriParsed: URL;
  try {
    redirectUriParsed = new URL(config.redirectUri);
  } catch {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.redirectUri must be a valid absolute URL',
    );
  }
  if (!isSecureUrl(redirectUriParsed)) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.redirectUri must use https:// (or http:// only for localhost)',
    );
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const resolvedConfig: ResolvedAuthConfig = {
    ...config,
    baseUrl,
    scope: String(config.scope ?? '').trim() || DEFAULT_SCOPE,
    enableRefreshToken: config.enableRefreshToken ?? true,
    authorizationEndpoint: resolveEndpoint(
      baseUrl,
      config.authorizationEndpoint,
      DEFAULT_AUTHORIZATION_PATH,
    ),
    tokenEndpoint: resolveEndpoint(
      baseUrl,
      config.tokenEndpoint,
      DEFAULT_TOKEN_PATH,
    ),
    userinfoEndpoint: resolveEndpoint(
      baseUrl,
      config.userinfoEndpoint,
      DEFAULT_USERINFO_PATH,
    ),
  };

  return new DefaultAuthClient(resolvedConfig);
}
