export interface TokenSet {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
  expiresAt?: number;
}

export interface Session {
  tokens: TokenSet;
  createdAt: number;
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
}

export interface AuthClient {
  startLogin(options?: StartLoginOptions): Promise<void>;
  handleRedirectCallback(callbackUrl?: string): Promise<Session>;
  getSession(): Session | null;
  getAccessToken(): Promise<string | null>;
  logout(options?: { returnTo?: string }): Promise<void>;
  isAuthenticated(): boolean;
  onAuthStateChanged(handler: (session: Session | null) => void): () => void;
  getUserinfo(): Promise<Record<string, unknown>>;
  startLoginCodeChallenge(
    options: LoginCodeChallengeOptions,
  ): Promise<TwoFactorChallenge>;
  verifyLoginCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithCodeSent(
    options: LoginCodeChallengeOptions,
  ): Promise<TwoFactorChallenge>;
  completeLoginWithCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithGoogle(options: GoogleLoginOptions): Promise<Session>;
  loginWithPassword(options: PasswordLoginOptions): Promise<Session>;
  resetPassword(options: { email: string }): Promise<void>;
  recoverPassword(options: { token: string; newPassword: string }): Promise<void>;
  changePassword(options: { oldPassword: string; newPassword: string }): Promise<void>;
}
