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

export interface PasswordLoginOptions {
  email: string;
  password: string;
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
  now?: () => number;
}

export interface ResolvedAuthConfig extends AuthConfig {
  baseUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
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
}
