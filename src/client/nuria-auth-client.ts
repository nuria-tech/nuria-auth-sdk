import { createCodeChallenge, randomString } from '../core/pkce';
import type {
  AccountClient,
  ActorClaim,
  AssuranceLevel,
  AuthClient,
  AuthTransport,
  DeviceUserCodeLookup,
  GoogleCodeLoginOptions,
  LoginCodeChallengeOptions,
  LoginMethodsConfig,
  LogoutOptions,
  OidcLoginOptions,
  OidcProvider,
  PasskeyLoginOptions,
  PasswordLoginOptions,
  ResolvedAuthConfig,
  Session,
  StartLoginOptions,
  StepUpOptions,
  StorageAdapter,
  TokenClaims,
  TokenSet,
  TwoFactorChallenge,
  VerifyLoginCodeOptions,
} from '../core/types';
import {
  normalizeTokenSet,
  parseUrl,
  safeGet,
  safeRemove,
  safeSet,
  STORAGE_KEYS,
  timingSafeEqual,
} from '../core/utils';
import { AuthError, AuthErrorCode } from '../errors/auth-error';
import { MemoryStorageAdapter } from '../storage/memory-storage-adapter';
import { WebStorageAdapter } from '../storage/web-storage-adapter';
import { FetchAuthTransport } from '../transport/fetch-transport';
import {
  ACR_MULTI_FACTOR,
  readAssurance,
  satisfiesAcr,
  satisfiesMaxAge,
} from '../utils/step-up';
import {
  getPasskeyAssertion,
  type PasskeyAuthenticationOptionsJSON,
} from '../utils/webauthn';
import { DefaultAccountClient } from './account-client';

const BROADCAST_CHANNEL_NAME = 'nuria:auth:sync';

// Time before `expiresAt` at which the SDK proactively rotates the access
// token. Sized to absorb timer throttling: Chrome's intensive-throttling
// caps `setInterval` at 1 fire/min for backgrounded tabs (>5min hidden),
// Safari freezes timers entirely under memory pressure, and mobile battery
// savers can defer wakeups by minutes. A 5-min cushion means a tab that
// returns to focus mid-throttle still has time to refresh before the
// access token expires and downstream API calls start 401'ing.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Default home for transient OAuth state (state/nonce/PKCE verifier/login
 * markers). v8 keeps NO tokens here — only short-lived, single-use artifacts
 * that must survive the authorize redirect round-trip. `sessionStorage` is the
 * right scope: it persists across the same-tab navigation a redirect flow
 * needs, yet clears on tab close. Falls back to in-memory storage in SSR /
 * non-browser runtimes.
 */
function defaultStateStorage(): StorageAdapter {
  if (typeof sessionStorage !== 'undefined') {
    try {
      return new WebStorageAdapter(sessionStorage);
    } catch {
      /* sessionStorage can throw in sandboxed iframes — fall through */
    }
  }
  return new MemoryStorageAdapter();
}

function isPermanentRefreshFailure(error: unknown): boolean {
  if (!(error instanceof AuthError)) return false;
  if (error.code !== AuthErrorCode.HTTP_ERROR) return false;
  const status = error.details.status;
  if (status === undefined) return false;
  // 408/425/429 are retryable per HTTP semantics — the transport may
  // already retry, but if one bubbles up here a future tick can still
  // succeed once the limiter resets. Don't drop the session on those.
  if (status === 408 || status === 425 || status === 429) return false;
  return status >= 400 && status < 500;
}

export class DefaultAuthClient implements AuthClient {
  private session: Session | null = null;
  private refreshPromise: Promise<Session> | null = null;
  private readonly listeners = new Set<(session: Session | null) => void>();
  private readonly storage;
  private readonly transport: AuthTransport;
  private readonly now: () => number;
  private readonly channel: BroadcastChannel | null;
  private silentRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private reactivationListenerRemovers: Array<() => void> = [];

  /** v7 self-service account management. See {@link AccountClient}. */
  public readonly account: AccountClient;

  constructor(private readonly config: ResolvedAuthConfig) {
    this.storage = config.storage ?? defaultStateStorage();
    this.transport = config.transport ?? new FetchAuthTransport();
    // Reuses getAccessToken so account calls ride the same (silently
    // refreshed) session token as the rest of the SDK.
    this.account = new DefaultAccountClient(
      config.baseUrl,
      this.transport,
      () => this.getAccessToken(),
      (method, url, accessToken) =>
        this.buildAuthHeaders(method, url, accessToken),
    );
    // No global 401 → logout interceptor is wired here on purpose. The
    // refresh-failure path inside getAccessToken() already clears the session
    // and notifies. A blanket 401 interceptor would wrongly log the user out
    // on legitimate authentication failures from non-refresh endpoints —
    // e.g. changePassword with the wrong oldPassword (kernel maps it to 401),
    // or a transient userinfo 401 that the next getAccessToken would resolve
    // via silent refresh. Callers handle 401s on app-level requests.
    this.now = config.now ?? (() => Date.now());
    this.channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(BROADCAST_CHANNEL_NAME)
        : null;
    if (this.channel) {
      this.channel.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'SESSION_SYNC') {
          const incoming: unknown = e.data.session;
          // Validate shape before accepting — any same-origin script can post
          // to this channel, so we must not blindly trust the payload.
          if (incoming === null || this.isValidSession(incoming)) {
            this.session = incoming as Session | null;
            this.notify(false); // don't re-broadcast — already synced from another tab
          }
        }
      };
    }
  }

  async init(): Promise<void> {
    // v8: there are no tokens at rest to hydrate. If this browser carries the
    // non-sensitive "has session" marker, attempt a cookie-based silent
    // refresh to re-establish the in-memory access token (the refresh token
    // lives only in the __Host cookie). Failure just leaves us anonymous.
    if ((await safeGet(this.storage, STORAGE_KEYS.authed)) === '1') {
      try {
        await this.bootstrapFromCookie();
      } catch (error) {
        // Only wipe the "has session" marker when the server definitively
        // rejected our credentials (4xx). Transient failures — cold-start
        // Lambda timeouts, network blips, CORS hiccups on hard-refresh — leave
        // the marker intact so the middleware's getAccessToken() can retry in
        // the same page-load (the Lambda will be warm by then). Consistent with
        // the same guard in getAccessToken().
        if (isPermanentRefreshFailure(error)) {
          await safeRemove(this.storage, STORAGE_KEYS.authed);
        }
      }
    }
    this.notify(false); // local hydration only — don't broadcast to other tabs
    if (this.config.enableRefreshToken && typeof setInterval !== 'undefined') {
      this.startSilentRefresh();
    }
  }

  /**
   * Re-establishes the in-memory session from the HttpOnly refresh cookie.
   * Used on load (init) when the "has session" marker is present. Throws on
   * any failure so the caller can clear the marker.
   */
  private async bootstrapFromCookie(): Promise<Session> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async startLogin(options: StartLoginOptions = {}): Promise<void> {
    const state = randomString(32);
    const nonce = randomString(32);
    const codeVerifier = randomString(96);
    const codeChallenge = await createCodeChallenge(codeVerifier);

    await safeSet(this.storage, STORAGE_KEYS.state, state);
    await safeSet(this.storage, STORAGE_KEYS.nonce, nonce);
    await safeSet(this.storage, STORAGE_KEYS.codeVerifier, codeVerifier);

    const params: Record<string, string> = {
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };

    // Hand the resolved loginMethods to the centralized login UI (accounts)
    // so it renders the right buttons for *this* app. Pure UI hint — no
    // security boundary; the kernel is the authoritative gate. Survives the
    // /v2/oauth/authorize hop only if the kernel forwards these params.
    const lm = this.config.loginMethods;
    if (lm.enabled.length) params.login_methods_enabled = lm.enabled.join(',');
    if (lm.comingSoon.length)
      params.login_methods_coming_soon = lm.comingSoon.join(',');

    const scope = options.scopes?.join(' ') ?? this.config.scope;
    if (scope) params.scope = scope;
    if (options.loginHint) params.login_hint = options.loginHint;

    // Read (but do not yet consume) the one-shot force-relogin marker
    // armed by a previous `logout()` call (default behavior). Explicit
    // `options.prompt` always wins; otherwise we inject `prompt=login`.
    // The marker is consumed only AFTER the redirect is successfully
    // dispatched, so a throw in `new URL(...)` / `onRedirect` / etc.
    // leaves the marker armed for the user's retry.
    const forceRelogin =
      (await safeGet(this.storage, STORAGE_KEYS.forceReloginNext)) === '1';
    if (options.prompt) {
      params.prompt = options.prompt;
    } else if (forceRelogin) {
      params.prompt = 'login';
    }
    if (options.extraParams) {
      const RESERVED = new Set([
        'response_type',
        'client_id',
        'redirect_uri',
        'scope',
        'state',
        'nonce',
        'code_challenge',
        'code_challenge_method',
        'login_methods_enabled',
        'login_methods_coming_soon',
      ]);
      // `prompt` is intentionally NOT reserved: the typed `options.prompt`
      // is convenience, but apps may pass an OIDC space-separated combo
      // (e.g. "login consent") via extraParams, which then overrides.
      // `String(v)` defends against JS callers whose `extraParams` slips a
      // non-string past the static type — `URLSearchParams.set` would
      // otherwise coerce silently in surprising ways for nullish/object values.
      for (const [k, v] of Object.entries(options.extraParams)) {
        if (!RESERVED.has(k) && v !== undefined && v !== null) {
          params[k] = String(v);
        }
      }
    }

    const url = new URL(this.config.authorizationEndpoint);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const redirectUrl = url.toString();

    if (this.config.onRedirect) {
      await this.config.onRedirect(redirectUrl);
      // onRedirect resolved without throwing — safe to consume the marker.
      // If it had thrown, the catch (or absence of one) would propagate
      // and we'd never reach here, leaving the marker armed for retry.
      if (forceRelogin) {
        await safeRemove(this.storage, STORAGE_KEYS.forceReloginNext);
      }
      return;
    }
    if (typeof window !== 'undefined') {
      // Consume *before* assign so the localStorage write is committed
      // synchronously before the navigation starts. (WebStorage is sync;
      // for async adapters we still complete the write via await.)
      if (forceRelogin) {
        await safeRemove(this.storage, STORAGE_KEYS.forceReloginNext);
      }
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
      await this.clearPkceArtifacts();
      throw new AuthError(
        AuthErrorCode.CALLBACK_ERROR,
        desc
          ? `Authorization error: ${error} — ${desc}`
          : `Authorization error: ${error}`,
      );
    }

    const code = url.searchParams.get('code');
    if (!code) {
      await this.clearPkceArtifacts();
      throw new AuthError(
        AuthErrorCode.MISSING_CODE,
        'Missing code in callback',
      );
    }

    const state = url.searchParams.get('state');
    if (!state) {
      await this.clearPkceArtifacts();
      throw new AuthError(
        AuthErrorCode.MISSING_STATE,
        'Missing state in callback',
      );
    }

    const storedState = await safeGet(this.storage, STORAGE_KEYS.state);
    if (!storedState || !timingSafeEqual(storedState, state)) {
      await this.clearPkceArtifacts();
      throw new AuthError(
        AuthErrorCode.STATE_MISMATCH,
        'State validation failed',
      );
    }

    return this.exchangeCode(code);
  }

  private async clearPkceArtifacts(): Promise<void> {
    await safeRemove(this.storage, STORAGE_KEYS.state);
    await safeRemove(this.storage, STORAGE_KEYS.nonce);
    await safeRemove(this.storage, STORAGE_KEYS.codeVerifier);
  }

  getSession(): Session | null {
    return this.session;
  }

  /**
   * Builds the auth headers for a resource request. With DPoP enabled the
   * token rides under the `DPoP` scheme alongside a fresh `ath`-bound proof;
   * otherwise it's a plain Bearer header (the v6 behavior).
   */
  private async buildAuthHeaders(
    method: string,
    url: string,
    accessToken: string,
  ): Promise<Record<string, string>> {
    if (this.config.dpop) {
      const proof = await this.config.dpop.createProof({
        htm: method,
        htu: url,
        accessToken,
      });
      return { Authorization: `DPoP ${accessToken}`, DPoP: proof };
    }
    return { Authorization: `Bearer ${accessToken}` };
  }

  /**
   * DPoP proof header for a token-endpoint request (no `ath` — the token is
   * being minted, not presented). Empty when DPoP is disabled.
   */
  private async tokenRequestDpopHeaders(): Promise<Record<string, string>> {
    if (!this.config.dpop) return {};
    const proof = await this.config.dpop.createProof({
      htm: 'POST',
      htu: this.config.tokenEndpoint,
    });
    return { DPoP: proof };
  }

  async getAccessToken(): Promise<string | null> {
    // v8: no session in memory. If this browser is marked as authenticated,
    // try to re-mint the access token from the refresh cookie (e.g. the tab
    // was reloaded). Otherwise we are genuinely anonymous.
    if (!this.session) {
      if ((await safeGet(this.storage, STORAGE_KEYS.authed)) !== '1') {
        return null;
      }
      try {
        const session = await this.bootstrapFromCookie();
        return session.tokens.accessToken ?? null;
      } catch (error) {
        if (isPermanentRefreshFailure(error)) {
          await safeRemove(this.storage, STORAGE_KEYS.authed);
        }
        return null;
      }
    }
    const exp = this.session.tokens.expiresAt;
    if (exp && exp - REFRESH_BUFFER_MS <= this.now()) {
      if (this.config.enableRefreshToken) {
        if (!this.refreshPromise) {
          this.refreshPromise = this.doRefresh().finally(() => {
            this.refreshPromise = null;
          });
        }
        try {
          await this.refreshPromise;
        } catch (error) {
          // Only nuke the session when the server has *definitively*
          // rejected the refresh token — i.e. a 4xx that retrying
          // can't fix (invalid_grant, invalid_client, access_denied).
          // Network failures, timeouts, and 5xx are transient: the
          // backend may be restarting, the network blipping, or a
          // proxy returning a 502. Clearing the session in those
          // cases logs the user out for what is effectively a hiccup
          // and forces a re-login on the next page load. The next
          // silentRefresh tick (60s) will retry naturally.
          if (isPermanentRefreshFailure(error)) {
            this.session = null;
            await safeRemove(this.storage, STORAGE_KEYS.authed);
            this.notify();
          }
          return null;
        }
      } else if (exp <= this.now()) {
        // Token is actually expired and refresh is disabled — clear session
        this.session = null;
        await safeRemove(this.storage, STORAGE_KEYS.authed);
        this.notify();
        return null;
      }
    }
    return this.session?.tokens.accessToken ?? null;
  }

  async hasSessionMarker(): Promise<boolean> {
    return (await safeGet(this.storage, STORAGE_KEYS.authed)) === '1';
  }

  async logout(options: LogoutOptions = {}): Promise<void> {
    this.stopSilentRefresh();
    this.session = null;
    await safeRemove(this.storage, STORAGE_KEYS.authed);
    await safeRemove(this.storage, STORAGE_KEYS.state);
    await safeRemove(this.storage, STORAGE_KEYS.nonce);
    await safeRemove(this.storage, STORAGE_KEYS.codeVerifier);
    // Default: arm the one-shot `prompt=login` for the next startLogin so
    // the user can never be silently re-signed-in by the still-warm SSO
    // session. Apps that want classic SSO across logout (e.g. background
    // refresh failures that retry into the same identity) opt out with
    // `{ keepSso: true }`.
    if (options.keepSso) {
      await safeRemove(this.storage, STORAGE_KEYS.forceReloginNext);
    } else {
      await safeSet(this.storage, STORAGE_KEYS.forceReloginNext, '1');
    }
    this.notify();
  }

  async revokeSession(): Promise<void> {
    // Best-effort: a 4xx ("already revoked", "unknown token") or transient
    // network failure must NOT block the caller's local cleanup. Failing
    // here would leave the user stuck signed-in client-side after they
    // explicitly asked to sign out.
    //
    // v8: the refresh token is only in the HttpOnly `__Host-nuria_rt` cookie,
    // so `credentials: 'include'` is the only way to identify the session to
    // revoke server-side.
    try {
      await this.transport.request(`${this.config.baseUrl}/v2/logout`, {
        method: 'POST',
        credentials: 'include',
        body: {},
        timeoutMs: 5_000,
      });
    } catch {
      /* swallow — see comment above */
    }
  }

  async lookupDeviceUserCode(userCode: string): Promise<DeviceUserCodeLookup> {
    if (!userCode || typeof userCode !== 'string' || !userCode.trim()) {
      throw new AuthError(AuthErrorCode.INVALID_CONFIG, 'userCode is required');
    }
    const url = new URL(`${this.config.baseUrl}/v2/oauth/device`);
    url.searchParams.set('user_code', userCode.trim());
    const response = await this.transport.request<{
      user_code?: string;
      client_id?: string;
      client_name?: string;
      scope?: string | null;
      expires_at?: string;
    }>(url.toString(), {
      method: 'GET',
      timeoutMs: 5_000,
    });
    const body = response.data ?? {};
    return {
      userCode: body.user_code ?? userCode.trim(),
      clientId: body.client_id ?? '',
      clientName: body.client_name ?? '',
      scope: body.scope ?? undefined,
      expiresAt: body.expires_at ?? '',
    };
  }

  async approveDeviceUserCode(userCode: string): Promise<void> {
    if (!userCode || typeof userCode !== 'string' || !userCode.trim()) {
      throw new AuthError(AuthErrorCode.INVALID_CONFIG, 'userCode is required');
    }
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new AuthError(
        AuthErrorCode.UNAUTHENTICATED,
        'A valid session is required to approve a device code.',
      );
    }
    const url = `${this.config.baseUrl}/v2/oauth/device/approve`;
    await this.transport.request(url, {
      method: 'POST',
      headers: await this.buildAuthHeaders('POST', url, accessToken),
      body: { userCode: userCode.trim() },
      timeoutMs: 5_000,
    });
  }

  async denyDeviceUserCode(userCode: string): Promise<void> {
    if (!userCode || typeof userCode !== 'string' || !userCode.trim()) {
      throw new AuthError(AuthErrorCode.INVALID_CONFIG, 'userCode is required');
    }
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new AuthError(
        AuthErrorCode.UNAUTHENTICATED,
        'A valid session is required to deny a device code.',
      );
    }
    const url = `${this.config.baseUrl}/v2/oauth/device/deny`;
    await this.transport.request(url, {
      method: 'POST',
      headers: await this.buildAuthHeaders('POST', url, accessToken),
      body: { userCode: userCode.trim() },
      timeoutMs: 5_000,
    });
  }

  async revokeAllSessions(): Promise<void> {
    // Bearer-authenticated, no body. Same best-effort posture as
    // revokeSession — a transport failure can't strand the user on a
    // logout-already-clicked screen. The kernel uses the access token to
    // identify the subject and writes RefreshSubjectState.GlobalRevokedAt,
    // killing every refresh row for the user in one shot.
    //
    // Credentials are only included when we have no Bearer to identify the
    // subject — same rationale as revokeSession: a misconfigured baseUrl
    // shouldn't ride ambient cookies along when an explicit auth proof is
    // already in the request.
    const accessToken = this.session?.tokens.accessToken;
    try {
      await this.transport.request(`${this.config.baseUrl}/v2/logout/global`, {
        method: 'POST',
        credentials: accessToken ? undefined : 'include',
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
        timeoutMs: 5_000,
      });
    } catch {
      /* swallow — see comment above */
    }
  }

  async globalLogout(options?: { returnTo?: string }): Promise<void> {
    let canonicalReturnTo: string | undefined;
    if (options?.returnTo) {
      let returnToUrl: URL;
      try {
        returnToUrl = new URL(options.returnTo);
      } catch {
        throw new AuthError(
          AuthErrorCode.INVALID_CONFIG,
          'returnTo must be a valid absolute URL',
        );
      }
      const isHttps = returnToUrl.protocol === 'https:';
      const isLocalHttp =
        returnToUrl.protocol === 'http:' &&
        (returnToUrl.hostname === 'localhost' ||
          returnToUrl.hostname === '127.0.0.1' ||
          returnToUrl.hostname === '[::1]');
      if (!isHttps && !isLocalHttp) {
        throw new AuthError(
          AuthErrorCode.INVALID_CONFIG,
          'returnTo must use https:// (or http:// only for localhost)',
        );
      }
      if (returnToUrl.username || returnToUrl.password) {
        throw new AuthError(
          AuthErrorCode.INVALID_CONFIG,
          'returnTo must not include URL credentials',
        );
      }
      // Forward the canonicalized form (`URL.toString()`) — never the raw
      // user input. Trailing whitespace, embedded NUL bytes, and unicode
      // confusables can otherwise survive validation here yet bypass the
      // server-side allowlist comparison if the server canonicalizes too.
      canonicalReturnTo = returnToUrl.toString();
    }

    await this.logout();

    if (this.config.logoutEndpoint) {
      const url = new URL(this.config.logoutEndpoint);
      if (canonicalReturnTo) {
        url.searchParams.set('returnTo', canonicalReturnTo);
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
    const accessToken = this.session?.tokens.accessToken;
    if (!accessToken) return false;
    const exp = this.session?.tokens.expiresAt;
    if (exp == null || exp > this.now()) return true;
    // Token expired — still considered authenticated if refresh is enabled,
    // because getAccessToken() will silently renew it.
    return this.config.enableRefreshToken === true;
  }

  /**
   * Decodes and returns the claims from the access token payload.
   *
   * **Security note**: This is a client-side convenience only — the JWT
   * signature is NOT verified here. Never use these claims for server-side
   * authorization decisions. Always validate the token server-side.
   * Use these claims solely for UI rendering (e.g. displaying the user's name).
   */
  getClaims(): TokenClaims | null {
    const token = this.session?.tokens.accessToken;
    if (!token) return null;
    try {
      const parts = token.split('.');
      // A valid JWT must have exactly 3 parts: header.payload.signature
      if (parts.length !== 3) return null;
      const payload = parts[1];
      if (!payload) return null;
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64)) as TokenClaims;
    } catch {
      return null;
    }
  }

  getActor(): ActorClaim | null {
    const raw = this.getClaims()?.act;
    if (!raw || typeof raw !== 'object') return null;
    const sub = (raw as { sub?: unknown }).sub;
    if (typeof sub !== 'string' || !sub) return null;
    const name = (raw as { name?: unknown }).name;
    const email = (raw as { email?: unknown }).email;
    return {
      sub,
      name: typeof name === 'string' ? name : undefined,
      email: typeof email === 'string' ? email : undefined,
    };
  }

  getAssurance(): AssuranceLevel | null {
    if (!this.session) return null;
    return readAssurance(this.getClaims());
  }

  satisfiesStepUp(requiredAcr?: string, maxAgeSeconds?: number): boolean {
    const assurance = this.getAssurance();
    if (!assurance) return false;
    return (
      satisfiesAcr(assurance.acr, requiredAcr) &&
      satisfiesMaxAge(
        assurance.authTime,
        maxAgeSeconds,
        Math.floor(this.now() / 1000),
      )
    );
  }

  async stepUp(options: StepUpOptions = {}): Promise<void> {
    const extraParams: Record<string, string> = {
      acr_values: options.acr ?? ACR_MULTI_FACTOR,
    };
    if (options.maxAgeSeconds !== undefined) {
      extraParams.max_age = String(options.maxAgeSeconds);
    }
    // prompt=login forces the IdP to re-run the login UI even under a warm
    // SSO session, so the user actually performs the stronger/fresher factor.
    await this.startLogin({
      prompt: 'login',
      scopes: options.scopes,
      extraParams,
    });
  }

  hasRole(role: string): boolean {
    return this.parseClaim(this.getClaims()?.roles).includes(role);
  }

  hasGroup(group: string): boolean {
    return this.parseClaim(this.getClaims()?.groups).includes(group);
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
    const headers = await this.buildAuthHeaders(
      'GET',
      this.config.userinfoEndpoint,
      accessToken,
    );
    const response = await this.transport.request<Record<string, unknown>>(
      this.config.userinfoEndpoint,
      { headers },
    );
    return response.data;
  }

  async checkSession(): Promise<boolean> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return false;
    if (!this.config.userinfoEndpoint) return this.isAuthenticated();
    try {
      const headers = await this.buildAuthHeaders(
        'GET',
        this.config.userinfoEndpoint,
        accessToken,
      );
      await this.transport.request(this.config.userinfoEndpoint, { headers });
      return true;
    } catch {
      this.session = null;
      await safeRemove(this.storage, STORAGE_KEYS.authed);
      this.notify();
      return false;
    }
  }

  async startLoginCodeChallenge(
    options: LoginCodeChallengeOptions,
  ): Promise<TwoFactorChallenge> {
    if (!options?.email) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'email is required for startLoginCodeChallenge',
      );
    }

    const response = await this.transport.request<Record<string, unknown>>(
      `${this.config.baseUrl}/v2/login-code/challenge`,
      {
        method: 'POST',
        credentials: 'include',
        body: {
          email: options.email,
          channel: options.channel ?? 'email',
          purpose: options.purpose ?? 'login',
        },
      },
    );

    return {
      challengeId: String(response.data.challengeId ?? ''),
      channel: String(response.data.channel ?? ''),
      destinationMasked: String(response.data.destinationMasked ?? ''),
      expiresAt: Number(response.data.expiresAt ?? 0),
      purpose: String(response.data.purpose ?? 'login'),
    };
  }

  async verifyLoginCode(options: VerifyLoginCodeOptions): Promise<Session> {
    if (!options?.challengeId || !options?.code) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'challengeId and code are required for verifyLoginCode',
      );
    }

    const response = await this.transport.request<Record<string, unknown>>(
      `${this.config.baseUrl}/v2/2fa/verify-login`,
      {
        method: 'POST',
        credentials: 'include',
        body: {
          challengeId: options.challengeId,
          code: options.code,
        },
      },
    );
    const tokens = normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
  }

  async loginWithGoogleCode(options: GoogleCodeLoginOptions): Promise<Session> {
    if (!options?.code) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'code is required for loginWithGoogleCode',
      );
    }

    const response = await this.transport.request<Record<string, unknown>>(
      `${this.config.baseUrl}/v2/google/code`,
      {
        method: 'POST',
        credentials: 'include',
        body: {
          code: options.code,
          redirectUri: options.redirectUri,
        },
      },
    );
    const tokens = normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
  }

  async resetPassword(options: { email: string }): Promise<void> {
    if (!options?.email) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'email is required for resetPassword',
      );
    }
    await this.transport.request(`${this.config.baseUrl}/v2/password/reset`, {
      method: 'POST',
      body: { email: options.email },
    });
  }

  async recoverPassword(options: {
    token: string;
    newPassword: string;
  }): Promise<void> {
    if (!options?.token || !options?.newPassword) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'token and newPassword are required for recoverPassword',
      );
    }
    await this.transport.request(`${this.config.baseUrl}/v2/password/recover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.token}` },
      body: { newPassword: options.newPassword },
    });
  }

  async sendMagicLink(options: { email: string }): Promise<void> {
    if (!options?.email) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'email is required for sendMagicLink',
      );
    }
    await this.transport.request(`${this.config.baseUrl}/v2/login/magic/send`, {
      method: 'POST',
      body: { email: options.email },
    });
  }

  async loginWithMagicLink(options: { token: string }): Promise<Session> {
    if (!options?.token) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'token is required for loginWithMagicLink',
      );
    }
    const response = await this.transport.request<Record<string, unknown>>(
      `${this.config.baseUrl}/v2/login/magic/verify`,
      {
        method: 'POST',
        credentials: 'include',
        body: { token: options.token },
      },
    );
    const tokens = normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
  }

  startSilentRefresh(intervalMs?: number): void {
    this.stopSilentRefresh();

    const ms = intervalMs ?? this.config.silentRefreshIntervalMs ?? 60_000;

    this.silentRefreshTimer = setInterval(() => {
      if (this.session) {
        this.getAccessToken().catch(() => {
          // silent fail
        });
      }
    }, ms);

    // Reactivation listeners cover the gap left by `setInterval` when the
    // browser throttles or freezes timers in backgrounded tabs. Each fires
    // a one-shot `getAccessToken()` which refreshes only if we're inside
    // REFRESH_BUFFER_MS of expiry — cheap when not needed, life-saving
    // when the interval missed its tick.
    const triggerCheck = () => {
      if (this.session) this.getAccessToken().catch(() => {});
    };

    if (typeof document !== 'undefined') {
      // Tab returns from another tab / minimized window.
      const visHandler = () => {
        if (document.visibilityState === 'visible') triggerCheck();
      };
      document.addEventListener('visibilitychange', visHandler);
      this.reactivationListenerRemovers.push(() =>
        document.removeEventListener('visibilitychange', visHandler),
      );
    }

    if (typeof window !== 'undefined') {
      // bfcache restore (back/forward navigation on Safari/Firefox). The
      // page's JS state is frozen-and-thawed without a full reload, so
      // `init()` does NOT re-run — `pageshow` with `persisted=true` is
      // the only reliable signal that we're resuming from cache and the
      // access token may have expired during the freeze.
      const pageshowHandler = (event: PageTransitionEvent) => {
        if (event.persisted) triggerCheck();
      };
      window.addEventListener('pageshow', pageshowHandler);
      this.reactivationListenerRemovers.push(() =>
        window.removeEventListener('pageshow', pageshowHandler),
      );

      // Network came back. If we were offline through an expiry window,
      // the timer-driven refresh would have failed; retry now that we
      // can actually reach `tokenEndpoint`.
      const onlineHandler = () => triggerCheck();
      window.addEventListener('online', onlineHandler);
      this.reactivationListenerRemovers.push(() =>
        window.removeEventListener('online', onlineHandler),
      );
    }
  }

  stopSilentRefresh(): void {
    if (this.silentRefreshTimer !== null) {
      clearInterval(this.silentRefreshTimer);
      this.silentRefreshTimer = null;
    }
    for (const remove of this.reactivationListenerRemovers) remove();
    this.reactivationListenerRemovers = [];
  }

  async changePassword(options: {
    oldPassword: string;
    newPassword: string;
  }): Promise<void> {
    if (!options?.oldPassword || !options?.newPassword) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'oldPassword and newPassword are required for changePassword',
      );
    }
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new AuthError(AuthErrorCode.INVALID_CONFIG, 'Not authenticated');
    }
    const url = `${this.config.baseUrl}/v2/me/password`;
    await this.transport.request(url, {
      method: 'PATCH',
      headers: await this.buildAuthHeaders('PATCH', url, accessToken),
      body: {
        oldPassword: options.oldPassword,
        newPassword: options.newPassword,
      },
    });
  }

  getLoginMethods(): LoginMethodsConfig {
    // Return a defensive copy so callers can't mutate the resolved config.
    return {
      enabled: [...this.config.loginMethods.enabled],
      comingSoon: [...this.config.loginMethods.comingSoon],
    };
  }

  /**
   * Direct password login against `/v2/login`. First-class v2 method —
   * intended for the SSO portal (accounts.nuria.com.br) only. Consumer
   * SPAs should use `startLogin()` (OAuth Authorization Code + PKCE)
   * and let accounts handle the credential collection so the user sees
   * a single sign-in surface across apps.
   */
  async loginWithPassword(options: PasswordLoginOptions): Promise<Session> {
    if (!options?.email || !options?.password) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'email and password are required for loginWithPassword',
      );
    }

    const response = await this.transport.request<Record<string, unknown>>(
      `${this.config.baseUrl}/v2/login`,
      {
        method: 'POST',
        credentials: 'include',
        body: {
          email: options.email,
          password: options.password,
        },
      },
    );
    if (response.data.requiresPasswordReset === true) {
      throw new AuthError(
        AuthErrorCode.FORCE_PASSWORD_RESET,
        'Password hash must be upgraded — call forceResetPassword() with the reset token from AuthError.details.body',
        undefined,
        { body: response.data },
      );
    }
    const tokens = normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
  }

  async forceResetPassword(
    newPassword: string,
    resetToken: string,
  ): Promise<Session> {
    const response = await this.transport.request<Record<string, unknown>>(
      `${this.config.baseUrl}/v2/password/force-reset`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${resetToken}` },
        body: { newPassword },
      },
    );
    const tokens = normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
  }

  /**
   * Passwordless passkey login. Runs the WebAuthn assertion ceremony between
   * the kernel's begin/finish endpoints, then mints a session. Sends an
   * `email` only to scope the credential list; usernameless when omitted.
   */
  async loginWithPasskey(options: PasskeyLoginOptions = {}): Promise<Session> {
    const email = options.email?.trim();
    const begin =
      await this.transport.request<PasskeyAuthenticationOptionsJSON>(
        `${this.config.baseUrl}/v2/login/passkey/begin`,
        {
          method: 'POST',
          credentials: 'include',
          body: email ? { email } : {},
        },
      );
    const assertion = await getPasskeyAssertion(begin.data);
    const response = await this.transport.request<Record<string, unknown>>(
      `${this.config.baseUrl}/v2/login/passkey/finish`,
      {
        method: 'POST',
        credentials: 'include',
        body: assertion,
      },
    );
    const tokens = normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
  }

  async listOidcProviders(): Promise<OidcProvider[]> {
    const response = await this.transport.request<unknown>(
      `${this.config.baseUrl}/v2/login/oidc/providers`,
      { method: 'GET', timeoutMs: 5_000 },
    );
    const list = Array.isArray(response.data) ? response.data : [];
    return list.map((raw) => {
      const p = (raw ?? {}) as Record<string, unknown>;
      return {
        key: String(p.key ?? ''),
        displayName: String(p.displayName ?? ''),
        type: String(p.type ?? 'oidc'),
        beginUrl: String(p.beginUrl ?? ''),
      };
    });
  }

  async startOidcLogin(options: OidcLoginOptions): Promise<void> {
    const provider = options?.provider?.trim();
    if (!provider) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'provider is required for startOidcLogin',
      );
    }
    // returnUrl is forwarded to the kernel, which enforces its own
    // *.nuria.com.br allowlist. We still reject anything that isn't a valid
    // absolute URL so a typo can't be silently dropped server-side.
    if (options.returnUrl !== undefined) {
      try {
        new URL(options.returnUrl);
      } catch {
        throw new AuthError(
          AuthErrorCode.INVALID_CONFIG,
          'returnUrl must be a valid absolute URL',
        );
      }
    }

    const beginUrl = new URL(
      `${this.config.baseUrl}/v2/login/oidc/${encodeURIComponent(provider)}/begin`,
    );
    if (options.returnUrl) {
      beginUrl.searchParams.set('returnUrl', options.returnUrl);
    }

    const response = await this.transport.request<{ authorizeUrl?: string }>(
      beginUrl.toString(),
      { method: 'GET', timeoutMs: 5_000 },
    );
    const authorizeUrl = response.data?.authorizeUrl;
    if (!authorizeUrl) {
      throw new AuthError(
        AuthErrorCode.CALLBACK_ERROR,
        'OIDC begin did not return an authorize URL',
      );
    }

    if (this.config.onRedirect) {
      await this.config.onRedirect(authorizeUrl);
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(authorizeUrl);
      return;
    }
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'Missing onRedirect callback for non-browser runtime',
    );
  }

  async handleOidcCallback(callbackUrl?: string): Promise<Session> {
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
    const qs = new URLSearchParams(
      url.search.startsWith('?') ? url.search.slice(1) : url.search,
    );

    const error = qs.get('error');
    if (error) {
      const desc = qs.get('error_description');
      throw new AuthError(
        AuthErrorCode.CALLBACK_ERROR,
        desc
          ? `OIDC login error: ${error} — ${desc}`
          : `OIDC login error: ${error}`,
      );
    }

    const bridgeCode = qs.get('oidc_code');
    if (!bridgeCode) {
      throw new AuthError(
        AuthErrorCode.CALLBACK_ERROR,
        'OIDC callback has no oidc_code',
      );
    }

    // Exchange the short-lived bridge code for tokens. The access token is
    // returned in the JSON body — never in the URL — and the refresh token is
    // already in the __Host cookie set on the preceding /callback redirect.
    const response = await this.transport.request<{
      access_token?: string;
      token_type?: string;
      expires_at?: string;
    }>(`${this.config.baseUrl}/v2/login/oidc/redeem`, {
      method: 'POST',
      body: { code: bridgeCode },
      credentials: 'include',
      timeoutMs: 10_000,
    });

    const accessToken = response.data?.access_token;
    if (!accessToken) {
      throw new AuthError(
        AuthErrorCode.CALLBACK_ERROR,
        'OIDC redeem did not return an access_token',
      );
    }

    const tokens = normalizeTokenSet(
      {
        access_token: accessToken,
        token_type: response.data?.token_type ?? 'Bearer',
        expiresAt: response.data?.expires_at,
        auth_provider: 'oidc',
      },
      this.now,
    );
    return this.createSession(tokens);
  }

  private async exchangeCode(code: string): Promise<Session> {
    const verifier = await safeGet(this.storage, STORAGE_KEYS.codeVerifier);
    if (!verifier) {
      throw new AuthError(
        AuthErrorCode.TOKEN_EXCHANGE_FAILED,
        'Missing PKCE code_verifier in storage',
      );
    }

    const storedNonce = await safeGet(this.storage, STORAGE_KEYS.nonce);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
    });

    try {
      // Authorization-code exchange proves identity via the PKCE
      // code_verifier + the one-shot `code`. v8 sends `credentials: 'include'`
      // so the kernel's Set-Cookie for the HttpOnly `__Host-nuria_rt` refresh
      // token is actually stored by the browser — that cookie, not any JS
      // state, is what drives silent refresh from here on. With DPoP enabled,
      // the proof binds the issued access token to our key (cnf.jkt).
      const response = await this.transport.request<Record<string, unknown>>(
        this.config.tokenEndpoint,
        {
          method: 'POST',
          credentials: 'include',
          headers: await this.tokenRequestDpopHeaders(),
          body: body.toString(),
        },
      );
      const tokens = normalizeTokenSet(response.data, this.now);

      // Validate nonce from the returned token to prevent replay attacks.
      // The server must include the nonce claim in the access or ID token.
      if (storedNonce) {
        const claimsNonce = this.decodeTokenNonce(tokens.accessToken);
        const idClaimsNonce = tokens.idToken
          ? this.decodeTokenNonce(tokens.idToken)
          : null;
        const tokenNonce = claimsNonce ?? idClaimsNonce;
        if (tokenNonce === null || !timingSafeEqual(storedNonce, tokenNonce)) {
          throw new AuthError(
            AuthErrorCode.TOKEN_EXCHANGE_FAILED,
            'Nonce validation failed — possible token replay attack',
          );
        }
      }

      return this.createSession(tokens);
    } finally {
      // Always clean up PKCE artifacts — whether the exchange succeeds, nonce
      // validation fails, or a network error occurs. Leaving them in storage
      // would allow a stale verifier to be reused in a subsequent exchange.
      await this.clearPkceArtifacts();
    }
  }

  private decodeTokenNonce(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
      return typeof payload.nonce === 'string' ? payload.nonce : null;
    } catch {
      return null;
    }
  }

  private async doRefresh(): Promise<Session> {
    // v8: the refresh token is never in JS. We identify the session purely by
    // the HttpOnly `__Host-nuria_rt` cookie, so `credentials: 'include'` is
    // mandatory and no refresh_token is ever placed in the body. The kernel's
    // /v2/oauth/token resolves the cookie when the body omits the token, then
    // rotates and re-sets it via Set-Cookie. With DPoP enabled, the proof
    // re-binds the rotated token to our key.
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
    });
    const response = await this.transport.request<Record<string, unknown>>(
      this.config.tokenEndpoint,
      {
        method: 'POST',
        credentials: 'include',
        headers: await this.tokenRequestDpopHeaders(),
        body: body.toString(),
        timeoutMs: 10_000,
      },
    );
    const tokens = normalizeTokenSet(response.data, this.now);
    return this.createSession(tokens);
  }

  private isValidSession(value: unknown): value is Session {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return false;
    const s = value as Record<string, unknown>;
    return (
      typeof s.createdAt === 'number' &&
      typeof s.tokens === 'object' &&
      s.tokens !== null &&
      typeof (s.tokens as Record<string, unknown>).accessToken === 'string'
    );
  }

  private parseClaim(claim: string | string[] | undefined): string[] {
    if (!claim) return [];
    if (Array.isArray(claim)) return claim.map((s) => s.trim()).filter(Boolean);
    return claim
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private async createSession(tokens: TokenSet): Promise<Session> {
    // v8: the refresh token is NEVER kept in JS — it lives solely in the
    // HttpOnly `__Host-nuria_rt` cookie. Strip it from the in-memory session
    // so it can't leak via getSession(), the cross-tab broadcast, or any
    // accidental serialization. Only the short-lived access token is held.
    const { refreshToken: _discarded, ...safeTokens } = tokens;
    void _discarded;

    this.session = {
      tokens: safeTokens,
      createdAt: this.now(),
      provider: tokens.authProvider ?? this.session?.provider,
    };
    // Persist only the non-sensitive "has session" marker (NOT the token), so
    // a later page load knows to attempt a cookie-based silent refresh.
    await safeSet(this.storage, STORAGE_KEYS.authed, '1');
    this.notify();
    return this.session;
  }

  private notify(broadcast = true): void {
    // Isolate listener throws — a buggy subscriber must not break the rest of
    // the fan-out, the cross-tab broadcast, or the await that triggered notify.
    this.listeners.forEach((handler) => {
      try {
        handler(this.session);
      } catch (err) {
        if (typeof console !== 'undefined') {
          // Log only message + code, never the raw error: a subscriber may
          // throw an `AuthError` whose `details.body` carries a token or
          // other sensitive fragment of an upstream HTTP response.
          const message = err instanceof Error ? err.message : 'unknown error';
          const code = err instanceof AuthError ? ` [${err.code}]` : '';
          console.error(
            `[nuria-auth] onAuthStateChanged listener threw${code}: ${message}`,
          );
        }
      }
    });
    if (broadcast) {
      this.channel?.postMessage({
        type: 'SESSION_SYNC',
        session: this.session,
      });
    }
  }
}
