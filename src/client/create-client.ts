import { DefaultAuthClient } from './nuria-auth-client';
import { AuthError, AuthErrorCode } from '../errors/auth-error';
import type { AuthClient, AuthConfig, ResolvedAuthConfig } from '../core/types';

const DEFAULT_AUTH_BASE_URL = 'https://ms-auth-v2.nuria.com.br';
const DEFAULT_AUTHORIZATION_PATH = '/v2/oauth/authorize';
const DEFAULT_TOKEN_PATH = '/v2/oauth/token';
const DEFAULT_SCOPE = 'openid profile email';

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

  return parsed.toString().replace(/\/+$/, '');
}

function resolveEndpoint(
  baseUrl: string,
  explicit: string | undefined,
  fallbackPath: string,
): string {
  if (explicit) {
    try {
      return new URL(explicit).toString();
    } catch {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'OAuth endpoints must be valid absolute URLs',
      );
    }
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
  };

  return new DefaultAuthClient(resolvedConfig);
}
