export type AuthMode = 'whitelabel' | 'redirect';

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
  user?: Record<string, unknown>;
  createdAt: number;
}

export interface StartLoginOptions {
  provider?: string;
  loginHint?: string;
  returnTo?: string;
  scopes?: string[];
  extraParams?: Record<string, string>;
}

export interface StorageAdapter {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export interface AuthTransportRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
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

export interface WhitelabelConfig {
  authBaseUrl?: string;
  flow: 'password' | 'code_exchange';
  endpoints?: {
    passwordLogin?: string;
    authorize?: string;
    token?: string;
    refresh?: string;
    revoke?: string;
    userinfo?: string;
  };
  mapTokenResponse?: (raw: Record<string, unknown>) => TokenSet;
}

export interface RedirectConfig {
  accountsBaseUrl?: string;
  clientId?: string;
  scope?: string[];
  authorizePath?: string;
  tokenPath?: string;
  logoutPath?: string;
  authorizeParamsMapper?: (
    baseParams: Record<string, string>,
    options: StartLoginOptions,
  ) => Record<string, string>;
}

export interface NuriaAuthConfig {
  mode: AuthMode;
  storage?: StorageAdapter;
  transport?: AuthTransport;
  now?: () => number;
  redirectUri?: string;
  enableRefreshToken?: boolean;
  whitelabel?: WhitelabelConfig;
  redirect?: RedirectConfig;
  onRedirect?: (url: string) => void | Promise<void>;
}

export interface NuriaAuthClient {
  startLogin(options?: StartLoginOptions): Promise<void>;
  buildAuthorizeUrl(options?: StartLoginOptions): Promise<string>;
  handleRedirectCallback(callbackUrl?: string): Promise<Session>;
  signIn(credentials: Record<string, unknown>): Promise<Session>;
  exchangeCode(code: string): Promise<Session>;
  getSession(): Session | null;
  getAccessToken(): Promise<string | null>;
  refresh(): Promise<Session>;
  logout(options?: { returnTo?: string }): Promise<void>;
  isAuthenticated(): boolean;
  onAuthStateChanged(handler: (session: Session | null) => void): () => void;
}
