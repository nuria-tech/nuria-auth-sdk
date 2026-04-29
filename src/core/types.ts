export interface TokenClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  /**
   * Nuria-issued access tokens emit `avatar_url` (snake_case) only when a
   * real avatar is available — Google login. Omitted for password / AWS SSO
   * logins so consumers can fall back to initials. Standard OIDC `picture`
   * is also accepted by the bundled claim helpers.
   */
  avatar_url?: string;
  phone_number?: string;
  roles?: string | string[];
  groups?: string | string[];
  auth_provider?: string;
  [key: string]: unknown;
}

export interface TokenSet {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
  expiresAt?: number;
  authProvider?: string;
}

export interface Session {
  tokens: TokenSet;
  createdAt: number;
  provider?: string;
}

export interface StartLoginOptions {
  loginHint?: string;
  scopes?: string[];
  extraParams?: Record<string, string>;
}

export interface LoginCodeChallengeOptions {
  email: string;
  channel?: 'email' | 'sms';
  destination?: string;
  purpose?: string;
}

export interface GoogleLoginOptions {
  idToken: string;
}

export interface AwsLoginOptions {
  idToken: string;
}

export interface PasswordLoginOptions {
  email: string;
  password: string;
}

/**
 * Login flow identifiers — closed set so consumers (login UIs) can switch on
 * the literal type without coercion.
 */
export type LoginMethod = 'password' | 'google' | 'passwordless' | 'aws_sso';

/**
 * Which login flows a UI should expose. Static config — passed at SDK init,
 * not fetched from the backend. UIs read it via `auth.getLoginMethods()` and
 * gate each button on the result.
 */
export interface LoginMethodsConfig {
  /** Rendered as fully working buttons / forms. */
  enabled: LoginMethod[];
  /** Rendered as disabled buttons with an "Em breve" badge. */
  comingSoon: LoginMethod[];
}

export interface LoginMethodsConfigInput {
  enabled?: LoginMethod[];
  comingSoon?: LoginMethod[];
}

export interface VerifyLoginCodeOptions {
  challengeId: string;
  code: string;
}

export interface TwoFactorChallenge {
  challengeId: string;
  channel: string;
  destinationMasked: string;
  expiresAt: number;
  purpose: string;
}

export interface StorageAdapter {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export interface AuthTransportRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}

export interface AuthTransportResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
}

export interface AuthTransport {
  request<T = unknown>(
    url: string,
    req?: AuthTransportRequest,
  ): Promise<AuthTransportResponse<T>>;
}

export interface TransportInterceptor {
  onRequest?: (
    url: string,
    req: AuthTransportRequest,
  ) => Promise<AuthTransportRequest> | AuthTransportRequest;
  onResponse?: <T>(
    res: AuthTransportResponse<T>,
  ) => Promise<AuthTransportResponse<T>> | AuthTransportResponse<T>;
  onErrorResponse?: (status: number) => Promise<void> | void;
}

export interface AuthConfig {
  clientId: string;
  baseUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  redirectUri: string;
  scope?: string;
  logoutEndpoint?: string;
  userinfoEndpoint?: string;
  storage?: StorageAdapter;
  transport?: AuthTransport;
  onRedirect?: (url: string) => void | Promise<void>;
  enableRefreshToken?: boolean;
  silentRefreshIntervalMs?: number;
  /**
   * Which login flows the UI should expose. Defaults to `password + google`
   * enabled and `passwordless + aws_sso` advertised as "coming soon" — that
   * matches the legacy Nuria signin page state. Override per app/deploy.
   * Either field can be omitted to fall back to its default.
   */
  loginMethods?: LoginMethodsConfigInput;
  now?: () => number;
}

export interface ResolvedAuthConfig extends AuthConfig {
  baseUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  silentRefreshIntervalMs: number;
  loginMethods: LoginMethodsConfig;
}

export interface AuthClient {
  init(): Promise<void>;
  startLogin(options?: StartLoginOptions): Promise<void>;
  handleRedirectCallback(callbackUrl?: string): Promise<Session>;
  getSession(): Session | null;
  getAccessToken(): Promise<string | null>;
  /** Clears the local session only (storage + in-memory). No server call, no redirect. */
  logout(): Promise<void>;
  /** Clears the local session AND calls the server logout endpoint, then redirects. */
  globalLogout(options?: { returnTo?: string }): Promise<void>;
  /**
   * Best-effort `POST /v2/logout` with the current refresh token to revoke
   * it server-side. Does NOT clear the local session — pair with
   * {@link AuthClient.logout} for a full local + server sign-out without
   * a redirect. Network/4xx errors are swallowed: the caller's local
   * cleanup must still proceed.
   */
  revokeSession(): Promise<void>;
  /**
   * Best-effort `POST /v2/logout/global` (Bearer required) to revoke
   * **every** refresh token belonging to the authenticated subject — not
   * just the one held by this client. Intended for the SSO portal
   * (accounts.nuria.com.br) "Sair" button: signing out at the account
   * center should kill every device, browser tab, and OAuth-integrated
   * app the subject ever logged into. Per-app integrations should keep
   * using {@link AuthClient.revokeSession} for local-only sign-out.
   *
   * Does NOT clear the local session — pair with {@link AuthClient.logout}
   * for full client-side cleanup. Existing 15-min access tokens still
   * drain naturally; dev tokens (`/v2/auth/dev-token`) survive because
   * they live on a separate revocation trail. Network/4xx errors are
   * swallowed for the same reason as `revokeSession`.
   */
  revokeAllSessions(): Promise<void>;
  isAuthenticated(): boolean;
  onAuthStateChanged(handler: (session: Session | null) => void): () => void;
  getClaims(): TokenClaims | null;
  hasRole(role: string): boolean;
  hasGroup(group: string): boolean;
  getUserinfo(): Promise<Record<string, unknown>>;
  checkSession(): Promise<boolean>;
  startLoginCodeChallenge(
    options: LoginCodeChallengeOptions,
  ): Promise<TwoFactorChallenge>;
  verifyLoginCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithCodeSent(
    options: LoginCodeChallengeOptions,
  ): Promise<TwoFactorChallenge>;
  completeLoginWithCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithGoogle(options: GoogleLoginOptions): Promise<Session>;
  loginWithAws(options: AwsLoginOptions): Promise<Session>;
  /** @deprecated Use `loginWithCodeSent` / `startLoginCodeChallenge` instead. */
  loginWithPassword(options: PasswordLoginOptions): Promise<Session>;
  resetPassword(options: { email: string }): Promise<void>;
  recoverPassword(options: {
    token: string;
    newPassword: string;
  }): Promise<void>;
  changePassword(options: {
    oldPassword: string;
    newPassword: string;
  }): Promise<void>;
  /**
   * Returns the resolved login-methods config for this client (the value
   * passed to `createAuthClient` merged with the SDK defaults). Synchronous
   * — no network call.
   */
  getLoginMethods(): LoginMethodsConfig;
  startSilentRefresh(intervalMs?: number): void;
  stopSilentRefresh(): void;
}
