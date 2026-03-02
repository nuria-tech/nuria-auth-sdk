import { AuthError, AuthErrorCode } from '../errors/auth-error';
import { createCodeChallenge, randomString } from '../core/pkce';
import {
  normalizeTokenSet,
  parseUrl,
  safeGet,
  safeRemove,
  safeSet,
  timingSafeEqual,
  STORAGE_KEYS,
} from '../core/utils';
import type {
  AuthClient,
  AuthConfig,
  Session,
  StartLoginOptions,
  TokenSet,
  AuthTransport,
} from '../core/types';
import { MemoryStorageAdapter } from '../storage/memory-storage-adapter';
import { FetchAuthTransport } from '../transport/fetch-transport';

export class DefaultAuthClient implements AuthClient {
  private session: Session | null = null;
  private refreshPromise: Promise<Session> | null = null;
  private readonly listeners = new Set<(session: Session | null) => void>();
  private readonly storage;
  private readonly transport: AuthTransport;
  private readonly now: () => number;

  constructor(private readonly config: AuthConfig) {
    this.storage = config.storage ?? new MemoryStorageAdapter();
    this.transport = config.transport ?? new FetchAuthTransport();
    this.now = config.now ?? (() => Date.now());
  }

  async startLogin(options: StartLoginOptions = {}): Promise<void> {
    const state = randomString(32);
    const codeVerifier = randomString(96);
    const codeChallenge = await createCodeChallenge(codeVerifier);

    await safeSet(this.storage, STORAGE_KEYS.state, state);
    await safeSet(this.storage, STORAGE_KEYS.codeVerifier, codeVerifier);

    const params: Record<string, string> = {
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };

    const scope = options.scopes?.join(' ') ?? this.config.scope;
    if (scope) params.scope = scope;
    if (options.loginHint) params.login_hint = options.loginHint;
    if (options.extraParams) {
      const RESERVED = new Set([
        'response_type',
        'client_id',
        'redirect_uri',
        'state',
        'code_challenge',
        'code_challenge_method',
      ]);
      for (const [k, v] of Object.entries(options.extraParams)) {
        if (!RESERVED.has(k)) params[k] = v;
      }
    }

    const url = new URL(this.config.authorizationEndpoint);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const redirectUrl = url.toString();

    if (this.config.onRedirect) {
      await this.config.onRedirect(redirectUrl);
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(redirectUrl);
      return;
    }
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'Missing onRedirect callback for non-browser runtime',
    );
  }

  async handleRedirectCallback(callbackUrl?: string): Promise<Session> {
    const input =
      callbackUrl ??
      (typeof window !== 'undefined' ? window.location.href : '');
    if (!input) {
      throw new AuthError(
        AuthErrorCode.CALLBACK_ERROR,
        'callbackUrl required in non-browser runtime',
      );
    }

    const url = parseUrl(input);
    const error = url.searchParams.get('error');
    if (error) {
      const desc = url.searchParams.get('error_description');
      throw new AuthError(
        AuthErrorCode.CALLBACK_ERROR,
        desc
          ? `Authorization error: ${error} — ${desc}`
          : `Authorization error: ${error}`,
      );
    }

    const code = url.searchParams.get('code');
    if (!code) {
      throw new AuthError(
        AuthErrorCode.MISSING_CODE,
        'Missing code in callback',
      );
    }

    const state = url.searchParams.get('state');
    if (!state) {
      throw new AuthError(
        AuthErrorCode.MISSING_STATE,
        'Missing state in callback',
      );
    }

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
        this.refreshPromise = this.doRefresh().finally(() => {
          this.refreshPromise = null;
        });
      }
      await this.refreshPromise;
    }
    return this.session?.tokens.accessToken ?? null;
  }

  async logout(options?: { returnTo?: string }): Promise<void> {
    if (options?.returnTo) {
      const returnTo = options.returnTo;
      if (returnTo.startsWith('//') || !/^https?:\/\//.test(returnTo)) {
        throw new AuthError(
          AuthErrorCode.INVALID_CONFIG,
          'returnTo must be an absolute https:// or http:// URL',
        );
      }
    }

    this.session = null;
    await safeRemove(this.storage, STORAGE_KEYS.session);
    await safeRemove(this.storage, STORAGE_KEYS.state);
    await safeRemove(this.storage, STORAGE_KEYS.codeVerifier);
    this.notify();

    if (this.config.logoutEndpoint) {
      const url = new URL(this.config.logoutEndpoint);
      if (options?.returnTo) {
        url.searchParams.set('returnTo', options.returnTo);
      }
      const logoutUrl = url.toString();
      if (this.config.onRedirect) {
        await this.config.onRedirect(logoutUrl);
      } else if (typeof window !== 'undefined') {
        window.location.assign(logoutUrl);
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
        'Not authenticated — call handleRedirectCallback first',
      );
    }
    if (!this.config.userinfoEndpoint) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'config.userinfoEndpoint is required for getUserinfo',
      );
    }
    const response = await this.transport.request<Record<string, unknown>>(
      this.config.userinfoEndpoint,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return response.data;
  }

  private async exchangeCode(code: string): Promise<Session> {
    const verifier = await safeGet(this.storage, STORAGE_KEYS.codeVerifier);
    if (!verifier) {
      throw new AuthError(
        AuthErrorCode.TOKEN_EXCHANGE_FAILED,
        'Missing PKCE code_verifier in storage',
      );
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
    });

    const response = await this.transport.request<Record<string, unknown>>(
      this.config.tokenEndpoint,
      {
        method: 'POST',
        body: body.toString(),
      },
    );
    const tokens = normalizeTokenSet(response.data, this.now);
    await safeRemove(this.storage, STORAGE_KEYS.codeVerifier);
    return this.createSession(tokens);
  }

  private async doRefresh(): Promise<Session> {
    const refreshToken = this.session?.tokens.refreshToken;
    if (!refreshToken) {
      throw new AuthError(
        AuthErrorCode.REFRESH_FAILED,
        'No refresh token available',
      );
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });

    const response = await this.transport.request<Record<string, unknown>>(
      this.config.tokenEndpoint,
      {
        method: 'POST',
        body: body.toString(),
      },
    );
    const tokens = normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
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
      const parsed = JSON.parse(raw) as Session;
      if (typeof parsed?.tokens?.accessToken !== 'string') {
        await safeRemove(this.storage, STORAGE_KEYS.session);
        return;
      }
      this.session = parsed;
    } catch {
      await safeRemove(this.storage, STORAGE_KEYS.session);
      this.session = null;
    }
  }
}
