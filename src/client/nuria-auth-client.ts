import { AuthError, AuthErrorCode } from '../errors/auth-error';
import { createCodeChallenge, randomString } from '../core/pkce';
import {
  normalizeTokenSet,
  parseUrl,
  resolveUrl,
  safeGet,
  safeRemove,
  safeSet,
  timingSafeEqual,
  STORAGE_KEYS,
} from '../core/utils';
import type {
  NuriaAuthClient,
  NuriaAuthConfig,
  Session,
  StartLoginOptions,
  TokenSet,
  AuthTransport,
} from '../core/types';
import { MemoryStorageAdapter } from '../storage/memory-storage-adapter';
import { FetchAuthTransport } from '../transport/fetch-transport';

const DEFAULTS = {
  whitelabelBaseUrl: 'https://ms-auth.nuria.com.br',
  accountsBaseUrl: 'https://accounts.nuria.com.br',
  authorizePath: '/oauth2/authorize',
  tokenPath: '/oauth2/token',
  logoutPath: '/logout',
  passwordLoginPath: '/auth/login',
  refreshPath: '/oauth2/token',
  revokePath: '/oauth2/revoke',
  userinfoPath: '/oauth2/userinfo',
};

export class DefaultNuriaAuthClient implements NuriaAuthClient {
  private session: Session | null = null;
  private refreshPromise: Promise<Session> | null = null;
  private readonly listeners = new Set<(session: Session | null) => void>();
  private readonly storage;
  private readonly transport: AuthTransport;
  private readonly now: () => number;

  constructor(private readonly config: NuriaAuthConfig) {
    this.storage = config.storage ?? new MemoryStorageAdapter();
    this.transport = config.transport ?? new FetchAuthTransport();
    this.now = config.now ?? (() => Date.now());
  }

  async startLogin(options: StartLoginOptions = {}): Promise<void> {
    const url = await this.buildAuthorizeUrl(options);
    if (this.config.onRedirect) {
      await this.config.onRedirect(url);
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(url);
      return;
    }
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'Missing onRedirect callback for non-browser runtime',
    );
  }

  async buildAuthorizeUrl(options: StartLoginOptions = {}): Promise<string> {
    const state = randomString(32);
    const codeVerifier = randomString(96);
    const codeChallenge = await createCodeChallenge(codeVerifier);

    await safeSet(this.storage, STORAGE_KEYS.state, state);
    await safeSet(this.storage, STORAGE_KEYS.codeVerifier, codeVerifier);

    if (this.config.mode === 'redirect') {
      const redirect = this.config.redirect ?? {};
      const base = redirect.accountsBaseUrl ?? DEFAULTS.accountsBaseUrl;
      const authorizePath = redirect.authorizePath ?? DEFAULTS.authorizePath;
      const baseParams: Record<string, string> = {
        response_type: 'code',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      };
      if (this.config.redirectUri)
        baseParams.redirect_uri = this.config.redirectUri;
      if (redirect.clientId) baseParams.client_id = redirect.clientId;
      const scope = options.scopes ?? redirect.scope;
      if (scope?.length) baseParams.scope = scope.join(' ');
      if (options.loginHint) baseParams.login_hint = options.loginHint;
      if (options.returnTo) baseParams.return_to = options.returnTo;
      let params = baseParams;
      if (redirect.authorizeParamsMapper) {
        params = redirect.authorizeParamsMapper(baseParams, options);
      }
      if (options.extraParams) {
        params = { ...params, ...options.extraParams };
      }
      const url = new URL(resolveUrl(base, authorizePath));
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, v);
      });
      return url.toString();
    }

    if (this.config.mode === 'whitelabel') {
      if (this.config.whitelabel?.flow !== 'code_exchange') {
        throw new AuthError(
          AuthErrorCode.UNSUPPORTED_OPERATION,
          'buildAuthorizeUrl only available in code_exchange or redirect flow',
        );
      }
      const base =
        this.config.whitelabel.authBaseUrl ?? DEFAULTS.whitelabelBaseUrl;
      const authorizePath =
        this.config.whitelabel.endpoints?.authorize ?? DEFAULTS.authorizePath;
      const url = new URL(resolveUrl(base, authorizePath));
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return url.toString();
    }

    throw new AuthError(AuthErrorCode.UNSUPPORTED_MODE, 'Unsupported mode');
  }

  async handleRedirectCallback(callbackUrl?: string): Promise<Session> {
    const input =
      callbackUrl ??
      (typeof window !== 'undefined' ? window.location.href : '');
    if (!input)
      throw new AuthError(
        AuthErrorCode.CALLBACK_ERROR,
        'callbackUrl required in non-browser runtime',
      );
    const url = parseUrl(input);
    const error = url.searchParams.get('error');
    if (error) {
      throw new AuthError(
        AuthErrorCode.CALLBACK_ERROR,
        `Authorization error: ${error}`,
      );
    }
    const code = url.searchParams.get('code');
    if (!code)
      throw new AuthError(
        AuthErrorCode.MISSING_CODE,
        'Missing code in callback',
      );
    const state = url.searchParams.get('state');
    if (!state)
      throw new AuthError(
        AuthErrorCode.MISSING_STATE,
        'Missing state in callback',
      );

    const storedState = await safeGet(this.storage, STORAGE_KEYS.state);
    if (!storedState || !timingSafeEqual(storedState, state)) {
      throw new AuthError(
        AuthErrorCode.STATE_MISMATCH,
        'State validation failed',
      );
    }

    await safeRemove(this.storage, STORAGE_KEYS.state);
    return this.exchangeCode(code);
  }

  async signIn(credentials: Record<string, unknown>): Promise<Session> {
    this.assertMode('whitelabel');
    const cfg = this.config.whitelabel;
    if (!cfg || cfg.flow !== 'password') {
      throw new AuthError(
        AuthErrorCode.UNSUPPORTED_OPERATION,
        'signIn only available for whitelabel password flow',
      );
    }
    const url = resolveUrl(
      cfg.authBaseUrl ?? DEFAULTS.whitelabelBaseUrl,
      cfg.endpoints?.passwordLogin ?? DEFAULTS.passwordLoginPath,
    );
    const response = await this.transport.request<Record<string, unknown>>(
      url,
      { method: 'POST', body: credentials },
    );
    const tokens = cfg.mapTokenResponse
      ? cfg.mapTokenResponse(response.data)
      : normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
  }

  async exchangeCode(code: string): Promise<Session> {
    if (!code)
      throw new AuthError(AuthErrorCode.MISSING_CODE, 'Code is required');
    const verifier = await safeGet(this.storage, STORAGE_KEYS.codeVerifier);
    if (!verifier) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'Missing PKCE code_verifier in storage',
      );
    }

    if (this.config.mode === 'redirect') {
      const redirect = this.config.redirect ?? {};
      const url = resolveUrl(
        redirect.accountsBaseUrl ?? DEFAULTS.accountsBaseUrl,
        redirect.tokenPath ?? DEFAULTS.tokenPath,
      );
      const response = await this.transport.request<Record<string, unknown>>(
        url,
        {
          method: 'POST',
          body: {
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
            redirect_uri: this.config.redirectUri,
            client_id: redirect.clientId,
          },
        },
      );
      const tokens = normalizeTokenSet(response.data, this.now);
      await safeRemove(this.storage, STORAGE_KEYS.codeVerifier);
      return this.createSession(tokens);
    }

    if (this.config.mode === 'whitelabel') {
      const w = this.config.whitelabel;
      if (!w || w.flow !== 'code_exchange') {
        throw new AuthError(
          AuthErrorCode.UNSUPPORTED_OPERATION,
          'exchangeCode only available in code_exchange and redirect mode',
        );
      }
      const url = resolveUrl(
        w.authBaseUrl ?? DEFAULTS.whitelabelBaseUrl,
        w.endpoints?.token ?? DEFAULTS.tokenPath,
      );
      const response = await this.transport.request<Record<string, unknown>>(
        url,
        {
          method: 'POST',
          body: {
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
            redirect_uri: this.config.redirectUri,
          },
        },
      );
      const tokens = w.mapTokenResponse
        ? w.mapTokenResponse(response.data)
        : normalizeTokenSet(response.data, this.now);
      await safeRemove(this.storage, STORAGE_KEYS.codeVerifier);
      return this.createSession(tokens);
    }

    throw new AuthError(AuthErrorCode.UNSUPPORTED_MODE, 'Unsupported mode');
  }

  getSession(): Session | null {
    return this.session;
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.session) {
      await this.hydrateSession();
    }
    if (!this.session) return null;
    const exp = this.session.tokens.expiresAt;
    if (exp && exp <= this.now() && this.config.enableRefreshToken) {
      if (!this.refreshPromise) {
        this.refreshPromise = this.refresh().finally(() => {
          this.refreshPromise = null;
        });
      }
      await this.refreshPromise;
    }
    return this.session?.tokens.accessToken ?? null;
  }

  async refresh(): Promise<Session> {
    if (!this.config.enableRefreshToken) {
      throw new AuthError(
        AuthErrorCode.REFRESH_FAILED,
        'Refresh token support is disabled',
      );
    }
    if (!this.session) await this.hydrateSession();
    const refreshToken = this.session?.tokens.refreshToken;
    if (!refreshToken) {
      throw new AuthError(
        AuthErrorCode.REFRESH_FAILED,
        'No refresh token available',
      );
    }

    const url =
      this.config.mode === 'redirect'
        ? resolveUrl(
            this.config.redirect?.accountsBaseUrl ?? DEFAULTS.accountsBaseUrl,
            this.config.redirect?.tokenPath ?? DEFAULTS.tokenPath,
          )
        : resolveUrl(
            this.config.whitelabel?.authBaseUrl ?? DEFAULTS.whitelabelBaseUrl,
            this.config.whitelabel?.endpoints?.refresh ?? DEFAULTS.refreshPath,
          );

    const response = await this.transport.request<Record<string, unknown>>(
      url,
      {
        method: 'POST',
        body: {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.config.redirect?.clientId,
        },
      },
    );
    const tokens =
      this.config.mode === 'whitelabel' &&
      this.config.whitelabel?.mapTokenResponse
        ? this.config.whitelabel.mapTokenResponse(response.data)
        : normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
  }

  async logout(options?: { returnTo?: string }): Promise<void> {
    if (this.config.mode === 'whitelabel' && this.session) {
      const token =
        this.session.tokens.refreshToken ?? this.session.tokens.accessToken;
      const tokenTypeHint = this.session.tokens.refreshToken
        ? 'refresh_token'
        : 'access_token';
      const base =
        this.config.whitelabel?.authBaseUrl ?? DEFAULTS.whitelabelBaseUrl;
      const revokePath =
        this.config.whitelabel?.endpoints?.revoke ?? DEFAULTS.revokePath;
      try {
        await this.transport.request(resolveUrl(base, revokePath), {
          method: 'POST',
          body: { token, token_type_hint: tokenTypeHint },
        });
      } catch (err) {
        this.config.whitelabel?.onRevocationError?.(err);
      }
    }

    this.session = null;
    await safeRemove(this.storage, STORAGE_KEYS.session);
    await safeRemove(this.storage, STORAGE_KEYS.state);
    await safeRemove(this.storage, STORAGE_KEYS.codeVerifier);
    this.notify();

    if (this.config.mode === 'redirect') {
      const redirect = this.config.redirect ?? {};
      const url = new URL(
        resolveUrl(
          redirect.accountsBaseUrl ?? DEFAULTS.accountsBaseUrl,
          redirect.logoutPath ?? DEFAULTS.logoutPath,
        ),
      );
      if (options?.returnTo) {
        const returnTo = options.returnTo;
        if (returnTo.startsWith('//') || !/^https?:\/\//.test(returnTo)) {
          throw new AuthError(
            AuthErrorCode.INVALID_CONFIG,
            'returnTo must be an absolute https:// or http:// URL',
          );
        }
        url.searchParams.set('returnTo', returnTo);
      }
      if (this.config.onRedirect) {
        await this.config.onRedirect(url.toString());
      } else if (typeof window !== 'undefined') {
        window.location.assign(url.toString());
      }
    }
  }

  isAuthenticated(): boolean {
    return Boolean(this.session?.tokens.accessToken);
  }

  onAuthStateChanged(handler: (session: Session | null) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async getUserinfo(): Promise<Record<string, unknown>> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'Not authenticated — call signIn or handleRedirectCallback first',
      );
    }
    const url =
      this.config.mode === 'redirect'
        ? resolveUrl(
            this.config.redirect?.accountsBaseUrl ?? DEFAULTS.accountsBaseUrl,
            DEFAULTS.userinfoPath,
          )
        : resolveUrl(
            this.config.whitelabel?.authBaseUrl ?? DEFAULTS.whitelabelBaseUrl,
            this.config.whitelabel?.endpoints?.userinfo ??
              DEFAULTS.userinfoPath,
          );
    const response = await this.transport.request<Record<string, unknown>>(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return response.data;
  }

  private async createSession(tokens: TokenSet): Promise<Session> {
    this.session = {
      tokens,
      createdAt: this.now(),
    };
    await safeSet(
      this.storage,
      STORAGE_KEYS.session,
      JSON.stringify(this.session),
    );
    this.notify();
    return this.session;
  }

  private notify(): void {
    this.listeners.forEach((handler) => handler(this.session));
  }

  private async hydrateSession(): Promise<void> {
    const raw = await safeGet(this.storage, STORAGE_KEYS.session);
    if (!raw) return;
    try {
      this.session = JSON.parse(raw) as Session;
    } catch {
      await safeRemove(this.storage, STORAGE_KEYS.session);
      this.session = null;
    }
  }

  private assertMode(mode: 'whitelabel' | 'redirect'): void {
    if (this.config.mode !== mode) {
      throw new AuthError(
        AuthErrorCode.UNSUPPORTED_MODE,
        `Operation requires mode=${mode}`,
      );
    }
  }
}
