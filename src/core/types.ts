/**
 * RFC 8693 §4.1 actor claim. Identifies the real principal acting on
 * behalf of the token's `sub` — populated only when a session was minted
 * through the support-impersonation flow; null on every regular login.
 *
 * Wire shape mirrors the kernel's `ActorReference` DTO:
 * `{ "sub": "<guid>", "name": "...", "email": "..." }`.
 */
export interface ActorClaim {
  /** GUID of the support agent driving the impersonated session. */
  sub: string;
  name?: string;
  email?: string;
}

export interface TokenClaims {
  // ── RFC 7519 standard claims ───────────────────────────────────────
  /** Subject identifier (RFC 7519 §4.1.2). For Nuria tokens, the user/app GUID. */
  sub?: string;
  /** Issuer (RFC 7519 §4.1.1). Nuria tokens emit `https://auth.nuria.com.br`. */
  iss?: string;
  /** Audience (RFC 7519 §4.1.3). Nuria tokens emit `nuria` today. */
  aud?: string | string[];
  /** Expiration time, epoch seconds (RFC 7519 §4.1.4). */
  exp?: number;
  /** Issued at, epoch seconds (RFC 7519 §4.1.6). */
  iat?: number;
  /** Not before, epoch seconds (RFC 7519 §4.1.5). Not currently emitted by Nuria. */
  nbf?: number;
  /** JWT id (RFC 7519 §4.1.7). Nuria stamps this on dev tokens for revocation. */
  jti?: string;
  // ── OIDC ──────────────────────────────────────────────────────────
  nonce?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  phone_number?: string;
  // ── Nuria-specific ────────────────────────────────────────────────
  /** `user` | `application` — distinguishes session subjects from machine principals. */
  subject_type?: string;
  /** Same value as `sub` / `sid`, kept for callers that key by the kernel's GUID. */
  subject_guid?: string;
  /** Phone number stamped at issue time (or `"NA"` when none). */
  subject_phone?: string;
  /**
   * Numeric origin company id (e.g. `180` for Nuria itself). Stringified
   * because the JWT carries it as a string claim.
   */
  company_origin?: string | number;
  /**
   * Nuria-issued access tokens emit `avatar_url` (snake_case) only when a
   * real avatar is available — Google login. Omitted for password / AWS SSO
   * logins so consumers can fall back to initials. Standard OIDC `picture`
   * is also accepted by the bundled claim helpers.
   */
  avatar_url?: string;
  /**
   * Space-separated OAuth scopes (RFC 6749 §3.3). Distinct from {@link roles}
   * — read it via {@link extractScopes} when you need capabilities like
   * `profile:write`, `myconnect:read`, `nuria:developer`.
   */
  scope?: string;
  /** Roles list, when present. The kernel keeps roles in DDB and exposes them via /v2/verify; first-party tokens don't carry them. */
  roles?: string | string[];
  /** Groups list, when present. Same shape/source as {@link roles}. */
  groups?: string | string[];
  auth_provider?: string;
  /**
   * RFC 8693 §4.1 actor claim — present only on tokens minted via the
   * support-impersonation flow. See {@link ActorClaim}.
   */
  act?: ActorClaim;
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
  /**
   * OIDC `prompt` parameter (Core 1.0 §3.1.2.1). Set to `login` or
   * `select_account` to force the IdP to render its login UI even when an
   * SSO session is still valid — typically what an app wants right after
   * its own logout, so the user is not silently re-authenticated.
   * `none` requests no UI (returns `login_required` if no session).
   * `consent` re-shows the consent screen.
   *
   * If omitted AND a previous `logout()` ran with default options, the
   * SDK injects `prompt=login` automatically (one-shot, then cleared).
   */
  prompt?: 'none' | 'login' | 'consent' | 'select_account';
  extraParams?: Record<string, string>;
}

export interface LogoutOptions {
  /**
   * Preserve the upstream SSO session for the next `startLogin()`. Default
   * is `false` — i.e. logout *forces re-authentication* on the next sign-in
   * (the SDK persists a one-shot marker that `startLogin()` reads and
   * translates into `prompt=login`).
   *
   * Set to `true` only when the app intentionally wants the silent-SSO
   * behavior, e.g. on background session refresh failures where the user
   * should glide back into the app without retyping credentials.
   */
  keepSso?: boolean;
}

export interface LoginCodeChallengeOptions {
  email: string;
  channel?: 'email' | 'sms';
  purpose?: string;
}

export interface GoogleCodeLoginOptions {
  /** Authorization code obtido pelo `createGoogleCodeClient` no frontend. */
  code: string;
  /** Redirect URI passada pra `initCodeClient`. Deixe ausente para fluxo
   *  popup — o backend usa o sentinel `"postmessage"` do GIS. Passe a URL
   *  exata só pra fluxo redirect com URI cadastrada no GCP. */
  redirectUri?: string;
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
  /**
   * Enables DPoP (RFC 9449) sender-constrained access tokens. When set, the
   * SDK attaches a DPoP proof to its token requests — so the kernel binds the
   * issued token to this key via `cnf.jkt` — and presents the bound token on
   * resource requests under the `DPoP` auth scheme with a fresh `ath` proof.
   * Create one with `createDpopSigner()` (optionally persisted across reloads
   * via `persistDpopSigner`/`loadDpopSigner`). Left unset, tokens are plain
   * Bearer tokens exactly as before.
   */
  dpop?: DpopProofSigner;
  now?: () => number;
}

/**
 * The DPoP capability the auth client depends on — the subset of
 * {@link DpopSigner} it calls. Typed structurally so a custom signer can be
 * supplied without importing the concrete class.
 */
export interface DpopProofSigner {
  createProof(params: {
    htm: string;
    htu: string;
    accessToken?: string;
  }): Promise<string>;
  getThumbprint(): Promise<string>;
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
  /**
   * Clears the local session only (storage + in-memory). No server call,
   * no redirect.
   *
   * Default behavior: persists a one-shot marker so the next
   * {@link AuthClient.startLogin} call adds `prompt=login` to the
   * authorize URL — the IdP renders its login UI even if the SSO
   * session is still warm. Pass `{ keepSso: true }` to preserve the
   * silent-SSO path.
   */
  logout(options?: LogoutOptions): Promise<void>;
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
  /**
   * Returns the RFC 8693 `act` claim when the current session was minted
   * through support impersonation, or `null` for regular sessions and
   * malformed payloads. UI surfaces should use this to render an
   * "acting as" banner so the impersonator is never invisible to the
   * end user. Defensive parsing mirrors the kernel: a missing or broken
   * `act` claim must never fail the call — it returns `null`.
   */
  getActor(): ActorClaim | null;
  hasRole(role: string): boolean;
  hasGroup(group: string): boolean;
  getUserinfo(): Promise<Record<string, unknown>>;
  checkSession(): Promise<boolean>;
  startLoginCodeChallenge(
    options: LoginCodeChallengeOptions,
  ): Promise<TwoFactorChallenge>;
  verifyLoginCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithGoogleCode(options: GoogleCodeLoginOptions): Promise<Session>;
  /**
   * Direct password login against `/v2/login`. First-class v2 method —
   * intended for the SSO portal (accounts.nuria.com.br) only. Consumer
   * SPAs should always use `startLogin()` (OAuth Authorization Code +
   * PKCE) and let accounts handle the credential collection so the user
   * sees a single sign-in surface across apps.
   */
  loginWithPassword(options: PasswordLoginOptions): Promise<Session>;
  /**
   * Passwordless passkey (WebAuthn) login against
   * `/v2/login/passkey/begin|finish`. Drives `navigator.credentials.get()`
   * and, on success, establishes a session exactly like the other login
   * methods. Intended for the SSO portal; consumer SPAs should use
   * `startLogin()`. Requires a browser with WebAuthn support.
   */
  loginWithPasskey(options?: PasskeyLoginOptions): Promise<Session>;
  /**
   * Lists the federated OIDC identity providers the kernel has configured
   * (`GET /v2/login/oidc/providers`). Render one "Sign in with …" button per
   * entry and pass its {@link OidcProvider.key} to {@link startOidcLogin}.
   * Public read — no session required.
   */
  listOidcProviders(): Promise<OidcProvider[]>;
  /**
   * Starts an SP-initiated login against a federated OIDC IdP. Fetches the
   * provider's authorize URL (`/v2/login/oidc/{provider}/begin`) — which the
   * kernel mints with state/nonce/PKCE — and redirects the browser to it.
   * The kernel handles the code exchange on its callback and redirects back
   * to `returnUrl` with the access token in the URL fragment; complete the
   * flow with {@link handleOidcCallback}.
   */
  startOidcLogin(options: OidcLoginOptions): Promise<void>;
  /**
   * Completes an OIDC IdP login by reading the access token the kernel placed
   * in the callback URL fragment (`#access_token=…&expires_at=…`) and
   * establishing a session. The refresh token rides in the `__Host` cookie,
   * so silent refresh works without it being exposed to JS. Returns the new
   * session. Throws {@link AuthErrorCode.CALLBACK_ERROR} when the fragment
   * carries an `error`, or no token is present.
   */
  handleOidcCallback(callbackUrl?: string): Promise<Session>;
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
  /**
   * Looks up a pending RFC 8628 device-flow `user_code` and returns the
   * client metadata the verification UI needs to confirm "you are about
   * to authorize &lt;client&gt;" before approving. Public read — does NOT
   * mutate the device-flow row. Throws on unknown / expired / non-pending
   * codes (collapsed by design — anti-enumeration).
   */
  lookupDeviceUserCode(userCode: string): Promise<DeviceUserCodeLookup>;
  /**
   * Approves the pending device-flow `user_code` with the current user
   * session, binding the caller's subject onto the row. Requires an
   * authenticated session; pairs with the device's polling on
   * `POST /v2/oauth/token` (`grant_type=urn:ietf:params:oauth:grant-type:device_code`),
   * which will then succeed with access + refresh tokens.
   */
  approveDeviceUserCode(userCode: string): Promise<void>;
  /**
   * Marks a pending device-flow `user_code` as denied. Requires an
   * authenticated session (so anonymous abuse can't DOS another user's
   * device flow). Idempotent for already-denied codes.
   */
  denyDeviceUserCode(userCode: string): Promise<void>;
  /**
   * v7 — self-service account management for the signed-in subject: 2FA
   * (TOTP), OAuth consents, known devices, federated-identity links and
   * LGPD data rights. Every method is Bearer-authenticated against the
   * current session. Purely additive: the v6 surface above is unchanged.
   */
  readonly account: AccountClient;
}

/** A consent grant as returned by `GET /v2/me/consents`. */
export interface ConsentInfo {
  clientId: string;
  clientName?: string;
  scopes: string;
  grantedAt: string;
  updatedAt?: string;
}

/** A known device as returned by `GET /v2/me/devices`. */
export interface DeviceInfo {
  deviceKey: string;
  ipAddress?: string;
  userAgent?: string;
  trusted: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** A linked federated identity as returned by `GET /v2/me/identities`. */
export interface FederatedIdentityInfo {
  provider: string;
  providerSubject: string;
  email?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface TwoFactorStatus {
  totpEnabled: boolean;
}

/** A configured federated OIDC IdP as returned by `GET /v2/login/oidc/providers`. */
export interface OidcProvider {
  /** Stable key used in the begin/callback URLs (e.g. `azuread`, `okta`). */
  key: string;
  /** Human-readable label for the "Sign in with …" button. */
  displayName: string;
  /** Provider family (currently always `oidc`). */
  type: string;
  /** Absolute URL of this provider's begin endpoint. */
  beginUrl: string;
}

/** Options for {@link AuthClient.startOidcLogin}. */
export interface OidcLoginOptions {
  /** Provider key from {@link OidcProvider.key}. */
  provider: string;
  /**
   * Absolute URL to return to after the IdP round-trip. The kernel only
   * honors `*.nuria.com.br` destinations; anything else falls back to the
   * accounts portal. The access token arrives in the URL fragment of this
   * destination — read it with {@link AuthClient.handleOidcCallback}.
   */
  returnUrl?: string;
}

/** A registered passkey as returned by `GET /v2/me/passkeys`. */
export interface PasskeyInfo {
  credentialId: string;
  name?: string;
  /** Authenticator model id (AAGUID), when the authenticator disclosed one. */
  aaguid?: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** Options for passwordless passkey login (`AuthClient.loginWithPasskey`). */
export interface PasskeyLoginOptions {
  /**
   * Email to scope the credential lookup to. Omit for a usernameless flow —
   * the authenticator offers any resident credential for the RP and the
   * kernel resolves the subject from the assertion (avoids account
   * enumeration on the begin call).
   */
  email?: string;
}

/**
 * One-time TOTP enrollment material. The plaintext `secret` and `otpauthUri`
 * are returned only at enrollment start (render the QR / manual key) and never
 * again — the server keeps only the encrypted secret.
 */
export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
}

/**
 * LGPD right-of-access export (`GET /v2/me/data`). Kept loosely typed — it is a
 * snapshot document for the user to download, not an API the SDK introspects.
 */
export interface DataExport {
  format?: string;
  version?: number;
  generatedAt?: string;
  [key: string]: unknown;
}

/**
 * Self-service account management surface (v7). Reached via
 * {@link AuthClient.account}. All calls require a valid session.
 */
export interface AccountClient {
  // ── Two-factor (TOTP) ──────────────────────────────────────────────
  /** Current 2FA status for the signed-in user. */
  getTwoFactorStatus(): Promise<TwoFactorStatus>;
  /** Begins TOTP enrollment; returns the one-time secret + otpauth URI. */
  enrollTotp(): Promise<TotpEnrollment>;
  /** Confirms enrollment with a code from the authenticator app. */
  confirmTotp(code: string): Promise<void>;
  /** Disables TOTP for the account. */
  disableTotp(): Promise<void>;

  // ── OAuth consents ─────────────────────────────────────────────────
  /** Lists the apps the user has granted access to. */
  listConsents(): Promise<ConsentInfo[]>;
  /** Revokes a previously granted consent by client id. */
  revokeConsent(clientId: string): Promise<void>;

  // ── Known devices ──────────────────────────────────────────────────
  listDevices(): Promise<DeviceInfo[]>;
  trustDevice(deviceKey: string): Promise<void>;
  untrustDevice(deviceKey: string): Promise<void>;
  forgetDevice(deviceKey: string): Promise<void>;

  // ── Passkeys (WebAuthn / FIDO2) ────────────────────────────────────
  /** Lists the passkeys registered to the signed-in user. */
  listPasskeys(): Promise<PasskeyInfo[]>;
  /**
   * Registers a new passkey for the signed-in user. Drives
   * `navigator.credentials.create()` between the kernel's begin/finish
   * calls; `name` is an optional friendly label. Requires a browser with
   * WebAuthn support and a valid session.
   */
  enrollPasskey(name?: string): Promise<void>;
  /** Removes a registered passkey by its credential id. */
  deletePasskey(credentialId: string): Promise<void>;

  // ── Federated identity links ───────────────────────────────────────
  listIdentities(): Promise<FederatedIdentityInfo[]>;
  unlinkIdentity(provider: string): Promise<void>;

  // ── LGPD data-subject rights ───────────────────────────────────────
  /** Right of access: downloads a structured export of all personal data. */
  exportData(): Promise<DataExport>;
  /**
   * Right to erasure: anonymizes the account and revokes all access.
   * Irreversible. `confirmEmail` must equal the signed-in user's email — a
   * deliberate interlock the server re-checks.
   */
  eraseAccount(confirmEmail: string): Promise<void>;
}

/**
 * Result of <see cref="AuthClient.lookupDeviceUserCode"/>. Mirrors the
 * <c>GET /v2/oauth/device?user_code=</c> response on the kernel.
 */
export interface DeviceUserCodeLookup {
  userCode: string;
  clientId: string;
  clientName: string;
  scope?: string;
  expiresAt: string;
}
