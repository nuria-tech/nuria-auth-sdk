import type {
  AuthClient,
  AuthConfig,
  LoginMethod,
  LoginMethodsConfig,
  LoginMethodsConfigInput,
  ResolvedAuthConfig,
} from '../core/types';
import { AuthError, AuthErrorCode } from '../errors/auth-error';
import { DefaultAuthClient } from './nuria-auth-client';

const DEFAULT_AUTH_BASE_URL = 'https://ms-auth-v2.nuria.com.br';
const DEFAULT_AUTHORIZATION_PATH = '/v2/oauth/authorize';
const DEFAULT_TOKEN_PATH = '/v2/oauth/token';
const DEFAULT_USERINFO_PATH = '/v2/oauth/userinfo';
const DEFAULT_SCOPE = 'openid profile email';

const SUPPORTED_LOGIN_METHODS: readonly LoginMethod[] = [
  'password',
  'google',
  'passwordless',
  'aws_sso',
];

export const DEFAULT_LOGIN_METHODS: LoginMethodsConfig = {
  enabled: ['password', 'google'],
  comingSoon: ['passwordless', 'aws_sso'],
};

function pickLoginMethods(
  raw: LoginMethod[] | undefined,
  fallback: LoginMethod[],
): LoginMethod[] {
  if (!Array.isArray(raw)) return [...fallback];
  const seen = new Set<LoginMethod>();
  for (const m of raw) {
    if (typeof m !== 'string') continue;
    const key = m.trim().toLowerCase() as LoginMethod;
    if (SUPPORTED_LOGIN_METHODS.includes(key)) seen.add(key);
  }
  return Array.from(seen);
}

function resolveLoginMethods(
  input: LoginMethodsConfigInput | undefined,
): LoginMethodsConfig {
  const enabled = pickLoginMethods(input?.enabled, DEFAULT_LOGIN_METHODS.enabled);
  const enabledSet = new Set(enabled);
  // Don't list a method as "coming soon" if it's already enabled — UIs would
  // render the working button next to a duplicate "Em breve" badge.
  const comingSoon = pickLoginMethods(
    input?.comingSoon,
    DEFAULT_LOGIN_METHODS.comingSoon,
  ).filter((m) => !enabledSet.has(m));
  return { enabled, comingSoon };
}

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

  // logoutEndpoint feeds window.location.assign in globalLogout() — anything
  // accepted here is a user-controlled redirect destination. Enforce the same
  // https-only / localhost-http rule we apply to other endpoints so a misconfig
  // can't open-redirect through globalLogout.
  let logoutEndpoint = config.logoutEndpoint;
  if (logoutEndpoint !== undefined) {
    let parsedLogout: URL;
    try {
      parsedLogout = new URL(logoutEndpoint);
    } catch {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'config.logoutEndpoint must be a valid absolute URL',
      );
    }
    if (!isSecureUrl(parsedLogout)) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'config.logoutEndpoint must use https:// (or http:// only for localhost)',
      );
    }
    logoutEndpoint = parsedLogout.toString();
  }

  const resolvedConfig: ResolvedAuthConfig = {
    ...config,
    baseUrl,
    logoutEndpoint,
    scope: String(config.scope ?? '').trim() || DEFAULT_SCOPE,
    enableRefreshToken: config.enableRefreshToken ?? true,
    silentRefreshIntervalMs: config.silentRefreshIntervalMs ?? 60_000,
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
    loginMethods: resolveLoginMethods(config.loginMethods),
  };

  return new DefaultAuthClient(resolvedConfig);
}
