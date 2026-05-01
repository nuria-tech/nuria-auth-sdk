# AGENTS.md — @nuria-tech/auth-sdk

## Purpose
Browser-focused **OAuth 2.1** Authorization Code + PKCE (S256) SDK with
zero dependencies. PKCE mandatory on every flow; no `client_secret`
pathway. Supports React, Vue, Nuxt, Next.js, and Angular via separate
entrypoints. Designed for the Nuria backend (`https://auth.nuria.com.br`).

## Commands

```bash
pnpm build          # Compile to dist/ (ESM + CJS + .d.ts) via tsup
pnpm test           # Run full test suite with coverage (vitest)
pnpm test:watch     # Watch mode
pnpm test:coverage  # Coverage report only (v8, lcov output)
pnpm lint           # ESLint (flat config)
pnpm lint:fix       # Auto-fix lint issues
pnpm format         # Prettier
pnpm typecheck      # tsc --noEmit (type check without build)
```

## Project Structure

```
src/
  index.ts                        # Main exports
  client/
    create-client.ts              # createAuthClient() factory with defaults
    nuria-auth-client.ts          # DefaultAuthClient implementation
  core/
    types.ts                      # All public TypeScript interfaces
    pkce.ts                       # PKCE S256 challenge/verifier
    utils.ts                      # STORAGE_KEYS, normalizeTokenSet(), helpers
  errors/auth-error.ts            # AuthError class + AuthErrorCode enum
  storage/
    memory-storage-adapter.ts     # In-memory (default, no persistence)
    web-storage-adapter.ts        # localStorage / sessionStorage
    cookie-storage-adapter.ts     # Cookie-based (for SSR)
    browser-cookie-storage.ts     # Browser cookie helpers
  transport/fetch-transport.ts    # FetchAuthTransport (fetch + retries)
  utils/
    claims.ts                     # extractRoles(), extractScopes(), extractCompanyOrigin(), extractAvatarUrl(), extractDisplayName(), getInitials()
    oauth.ts                      # buildOAuthAuthorizeUrl()
    google.ts                     # renderGoogleSignInButton(), attachCustomGoogleButton(), promptGoogleOneTap(), cancelGooglePrompt(), disableGoogleAutoSelect() — wraps Google Identity Services (GIS / FedCM); validates id_token nonce client-side. attachCustomGoogleButton() mounts the GIS button as a transparent overlay over a caller-styled container so apps can ship their own branded button without losing FedCM user activation
    aws.ts                        # startAwsLogin(), parseAwsQueryCallback() — Authorization Code + PKCE for AWS IAM Identity Center; per-state PKCE bag in sessionStorage
  react/                          # useAuthSession, AuthProvider, useAuth
  vue/                            # useAuthSession (Vue 3 composable)
  nuxt/                           # createNuxtAuthClient(), createNuxtCookieStorageAdapter()
  next/                           # createNextAuthClient(), createNextCookieStorageAdapter()
  angular/                        # createAngularAuthFacade() — RxJS facade; createBearerInterceptor() — HttpInterceptorFn
tests/                            # Vitest test suite (*.spec.ts)
```

## Package Entrypoints

| Import | File | Contents |
|--------|------|----------|
| `@nuria-tech/auth-sdk` | `dist/index.js` | `createAuthClient`, storage adapters, transport, errors, types, `extractRoles`, `extractScopes`, `extractCompanyOrigin`, `extractAvatarUrl`, `extractDisplayName`, `getInitials`, `buildOAuthAuthorizeUrl`, Google + AWS IAM Identity Center (SSO) OAuth helpers |
| `@nuria-tech/auth-sdk/react` | `dist/react.js` | `useAuthSession`, `AuthProvider`, `useAuth` |
| `@nuria-tech/auth-sdk/vue` | `dist/vue.js` | `useAuthSession` |
| `@nuria-tech/auth-sdk/nuxt` | `dist/nuxt.js` | `createNuxtAuthClient`, `createNuxtCookieStorageAdapter` |
| `@nuria-tech/auth-sdk/next` | `dist/next.js` | `createNextAuthClient`, `createNextCookieStorageAdapter` |
| `@nuria-tech/auth-sdk/angular` | `dist/angular.js` | `createAngularAuthFacade`, `createBearerInterceptor` |

## Default Backend Endpoints

| Config | Default |
|--------|---------|
| `baseUrl` | `https://auth.nuria.com.br` |
| `authorizationEndpoint` | `${baseUrl}/v2/oauth/authorize` |
| `tokenEndpoint` | `${baseUrl}/v2/oauth/token` |
| `userinfoEndpoint` | `${baseUrl}/v2/oauth/userinfo` |
| `scope` | `openid profile email` |
| `enableRefreshToken` | `true` |

## OAuth profile

The SDK targets **OAuth 2.1**: PKCE is mandatory for every authorization
code flow. There is no `client_secret` pathway. `code_challenge_method`
is hardcoded to `S256`.

Two non-browser scenarios that the SDK does **not** drive directly but
that the kernel supports — see [Native and headless flows](#native-and-headless-flows-rfc-8252--rfc-8628):

- **Native CLI / desktop:** loopback redirect (RFC 8252). The CLI binds
  to `http://127.0.0.1:<port>/callback` and uses the standard authorize
  + token endpoints. The SDK is browser-only, so a native runtime ships
  this flow itself; the only kernel-side requirement is that the
  client's allow-list contain `http://127.0.0.1/<path>` (any port matches).
- **Headless devices:** RFC 8628 device authorization grant via
  `/v2/oauth/device/*`. The SDK exposes the **verification-page**
  helpers (`lookupDeviceUserCode`, `approveDeviceUserCode`,
  `denyDeviceUserCode`) used by the accounts portal; the polling side
  belongs to the device's own runtime.

**Federated providers do not use the redirect-fragment Implicit grant**
— it is forbidden by OAuth 2.1 (RFC 9700 / Browser-Based Apps BCP). The
two providers diverge because the spec offers no single answer that fits
both:

- **Google** uses **Google Identity Services (GIS / FedCM)**, the path
  Google officially endorses for SPAs after deprecating implicit. The
  SDK does not redirect — `accounts.google.com/gsi/client` is loaded
  on demand and renders the official button into a host element. The
  id_token comes back through a JS callback. Nonce is generated client-
  side, embedded via GIS `initialize({ nonce })`, and validated against
  the id_token claim with `timingSafeEqual` before the credential is
  surfaced to the consumer.
- **AWS IAM Identity Center** uses **Authorization Code + PKCE** in the
  browser. Customer-managed applications support PKCE-only public
  clients, so no `client_secret` is required. The PKCE bag
  (`{ codeVerifier, nonce, redirectUri, clientId, tokenEndpoint, returnSearch }`)
  is stored in `sessionStorage` keyed by `state` so concurrent tabs
  cannot clobber each other. After the redirect back, the SDK parses
  `?code&state`, exchanges at the issuer's `/token`, validates the
  id_token nonce, and clears the bag whether the exchange succeeds or
  fails (preventing verifier reuse).

Both flows ultimately pass an `idToken` to `loginWithGoogle` /
`loginWithAws`, which call `POST /v2/google` / `POST /v2/sso/aws` —
those backend endpoints are unchanged from the implicit-flow era.

## Auth Flows

| Method | Backend endpoint | Input |
|--------|-----------------|-------|
| `startLogin()` + `handleRedirectCallback()` | `/v2/oauth/authorize` → `/v2/oauth/token` | PKCE redirect |
| ~~`loginWithPassword({ email, password })`~~ _(deprecated)_ | `POST /v2/login` | Direct |
| `loginWithGoogle({ idToken })` | `POST /v2/google` | Google ID token |
| `loginWithAws({ idToken })` | `POST /v2/sso/aws` | AWS IAM Identity Center (SSO) ID token |
| `loginWithCodeSent()` + `completeLoginWithCode()` | `/v2/login-code/challenge` → `/v2/2fa/verify-login` | 2FA |
| `resetPassword({ email })` | `POST /v2/password/reset` | Public — sends reset email |
| `recoverPassword({ token, newPassword })` | `POST /v2/password/recover` | Recovery token in `Authorization: Bearer` header |
| `changePassword({ oldPassword, newPassword })` | `PATCH /v2/me/password` | Requires active session |
| `getLoginMethods()` | — (static) | Returns the resolved `loginMethods` config (`{ enabled, comingSoon }` of `'password' \| 'google' \| 'passwordless' \| 'aws_sso'`) — value passed to `createAuthClient` merged with `DEFAULT_LOGIN_METHODS` (`enabled: ['password','google']`, `comingSoon: ['passwordless','aws_sso']`). Unknown values are dropped; methods in `enabled` are stripped from `comingSoon`. |
| `startLogin()` (extends behaviour) | redirects to authorize endpoint | Also serializes `config.loginMethods.enabled` / `comingSoon` as CSV query params `login_methods_enabled` / `login_methods_coming_soon`. The kernel forwards them on the `/v2/oauth/authorize → accounts/signin` redirect, so the centralized login UI renders the right buttons for the calling app. Pure UI hint — kernel still enforces auth. `extraParams` cannot override these (reserved). |
| `logout()` | — (local only) | Clears storage + notifies listeners; no server call |
| `globalLogout({ returnTo? })` | `logoutEndpoint` (configurable) | Calls `logout()` then redirects to server logout |
| `revokeSession()` | `POST /v2/logout` | Best-effort server revoke of the current refresh token; does **not** clear the local session. Pair with `logout()` for full sign-out without a redirect. Errors are swallowed so callers' local cleanup always proceeds. |
| `revokeAllSessions()` | `POST /v2/logout/global` | Best-effort **SSO-portal** sign-out: Bearer-auth, revokes every refresh token of the authenticated subject (all devices, all OAuth apps). Does NOT clear local session and does NOT affect dev tokens (separate revocation trail keyed by JTI). Use this in accounts.nuria.com.br; per-app integrations stay with `revokeSession`. |

`LoginCodeChallengeOptions.destination` is deprecated and intentionally not
serialized by `startLoginCodeChallenge()` / `loginWithCodeSent()`. The kernel
always resolves the OTP destination from the stored user email/cellphone based
on `channel`.

## Storage Keys (localStorage / cookie)

| Key | Content |
|-----|---------|
| `nuria:session` | `Session` JSON `{ tokens: { accessToken, ... }, createdAt }` |
| `nuria:oauth:state` | PKCE state string (cleared after callback, always via `finally`) |
| `nuria:oauth:code_verifier` | PKCE verifier (cleared after callback, always via `finally`) |
| `nuria:oauth:nonce` | OIDC nonce string (cleared after callback, always via `finally`) |
| `nuria:google:nonce` | GIS nonce (cleared once the credential callback validates it; `disableGoogleAutoSelect()` also clears it) |
| `nuria:aws:pkce:<state>` | Per-flight AWS PKCE bag — `{ codeVerifier, nonce, redirectUri, clientId, tokenEndpoint, returnSearch }`. Removed by `parseAwsQueryCallback` whether the exchange succeeds or fails. |
| `nuria:auth:force_relogin_next` | One-shot marker armed by `logout()` (default) and consumed by the next `startLogin()` to inject `prompt=login`. Cleared on consumption *after* the redirect dispatch succeeds — if `onRedirect` throws, the marker remains armed for the user's retry. Cleared explicitly by `logout({ keepSso: true })`. |

## Architecture Rules

- **PKCE is mandatory** — cannot be disabled; `randomString()` uses rejection sampling to eliminate modulo bias (threshold = `256 - 256 % 66 = 204`)
- **All endpoints and `redirectUri` must use `https://`** — `http://` is only accepted for `localhost`, `127.0.0.1`, and `[::1]` (enforced in `createAuthClient`)
- **Nonce is always generated** in `startLogin()` and included in the authorization request; validated (timing-safe) against the `nonce` claim in the returned token when the server includes it
- **PKCE artifacts** (`state`, `nonce`, `codeVerifier`) are always cleaned from storage via `finally` — even when token exchange fails, nonce validation fails, or a network error occurs
- `init()` must be called once at app startup (e.g. `provideAppInitializer`) to hydrate session from storage before routing
- `isAuthenticated()` returns `true` when token is expired but `enableRefreshToken: true` — callers should use `getAccessToken()` to get an always-valid token
- `getClaims()` decodes the JWT payload client-side for UI convenience only — **JWT signature is NOT verified**; never use these claims for server-side authorization decisions
- `hasRole()`/`hasGroup()` support both comma-separated string and array claims
- `getAccessToken()` triggers proactive refresh **30s before expiry** when `enableRefreshToken: true`; refresh requests have a 10s timeout
- If `enableRefreshToken: false` and the token is **actually expired** (`expiresAt <= now`), `getAccessToken()` clears the session and returns `null` — it never returns an expired token
- If refresh fails (e.g. 401 from backend), session is cleared and `null` is returned — no crash
- Concurrent refresh calls are deduplicated via `refreshPromise`
- Cross-tab sync via `BroadcastChannel('nuria:auth:sync')` — fires on login/logout; `init()` does NOT broadcast; incoming messages are shape-validated before being applied
- `logout(options?)` clears local session only — no server call, no redirect. **Default also arms the one-shot `nuria:auth:force_relogin_next` marker** so the next `startLogin()` injects `prompt=login` (OIDC Core §3.1.2.1). Pass `{ keepSso: true }` to skip arming. Apps that ARE the IdP (e.g. accounts.nuria.com.br) opt out — see accounts repo `useLogout`. The marker survives across page reloads only when the storage adapter is persistent (`WebStorageAdapter` / `CookieStorageAdapter`); `MemoryStorageAdapter` loses it on reload.
- `startLogin()` reads the marker but consumes it **only after the redirect dispatches** (`onRedirect` resolved, or `window.location.assign` called). A throw before dispatch leaves the marker armed for retry. Explicit `options.prompt` always wins over the marker; `extraParams.prompt` overrides both.
- **`prompt` precedence:** `extraParams.prompt` > typed `options.prompt` > armed marker (→ `login`) > nothing. The marker is always consumed when read, regardless of which value won (so `startLogin({ prompt: 'none' })` after `logout()` consumes the marker even though `prompt=none` does not actually re-authenticate — explicit developer override).
- `globalLogout({ returnTo })` calls `logout()` (with default options, so it also arms the marker) then calls `logoutEndpoint` and redirects; `returnTo` only accepts `https://` URLs (or `http://localhost`).
- `revokeSession()` POSTs to `/v2/logout` with the current refresh token to revoke it server-side; does NOT touch the local session. Best-effort: 4xx (already revoked) and network errors are swallowed so callers can sequence `revokeSession()` → `logout()` without leaving the user stuck signed-in client-side if the server call fails. Timeout is 5s.
- `revokeAllSessions()` POSTs to `/v2/logout/global` (Bearer in `Authorization` header) to revoke **every** refresh token of the authenticated subject server-side. Same best-effort posture as `revokeSession`; same 5s timeout; same "doesn't touch local session" contract. Use only in the SSO portal — per-app callers want the per-row `revokeSession`. Dev tokens survive: the kernel keeps `DevTokenRevocation` keyed by JTI on a separate trail and `EvaluateAccess` bypasses the session kill-switch when a JWT carries a `jti`.

## Native and headless flows (RFC 8252 + RFC 8628)

Two scenarios the SDK does not directly drive but knows how to integrate
with at the verification surface.

### Loopback redirect — native CLI / desktop (RFC 8252)

The native runtime (Go CLI, Node CLI, Electron, etc.) binds to a
random ephemeral port on `127.0.0.1` and uses that as the OAuth
`redirect_uri`:

```
http://127.0.0.1:<port>/callback
```

It then issues the **standard** `/v2/oauth/authorize` + `/v2/oauth/token`
exchange (PKCE-mandatory, just like the browser SDK does). No special
endpoints are involved — the only adjustment is in redirect-URI matching
on the kernel: when both the registered and requested URIs are loopback
(`127.0.0.1` or `[::1]`, `http`), port comparison is skipped per RFC 8252
§7.3. Path and query are still enforced exactly. `localhost` is **not**
loopback (RFC 8252 §8.3) — the IP literal is mandatory.

To enable the flow on an OAuth client, register one canonical port-less
URI in the management API:

```
POST /v2/management/oauth-clients/<id>/redirect-uris
  { "uri": "http://127.0.0.1/callback" }
```

### Device authorization grant (RFC 8628)

For devices with no local browser (TVs, IoT, SSH terminals, CI). The
device flow is split between two actors:

- **Device side (SDK does NOT cover):** call
  `POST /v2/oauth/device/authorize`, render the user code + verification
  URI, then poll `POST /v2/oauth/token` with
  `grant_type=urn:ietf:params:oauth:grant-type:device_code` until the
  user approves. Implemented in the device's own runtime — out of scope
  for a browser SDK.
- **Verification side (this SDK):** the user lands at
  `https://accounts.nuria.com.br/device?user_code=...`, confirms what
  they're authorizing, and approves with their existing session. The
  SDK exposes three helpers on the auth client:

```ts
auth.lookupDeviceUserCode(userCode)   // GET  /v2/oauth/device?user_code=
auth.approveDeviceUserCode(userCode)  // POST /v2/oauth/device/approve  (Bearer)
auth.denyDeviceUserCode(userCode)     // POST /v2/oauth/device/deny     (Bearer)
```

`lookupDeviceUserCode` returns `{ userCode, clientId, clientName, scope,
expiresAt }` for the confirmation UI. Approve/deny require an active
session — the SDK calls `getAccessToken()` (so silent refresh is in
effect) and throws `AuthError(UNAUTHENTICATED)` if there's no session.
Both endpoints throw on unknown / expired / non-pending codes
(anti-enumeration — collapsed by design).

**See also:** the kernel's `CONTRACT_V2.md` has the full request/response
shape, error codes, and AWS CLI command to provision
`NuriaAuth.OAuthDeviceCode`.

## Adding a New Framework Integration

1. Create `src/[framework]/index.ts`
2. Implement a `StorageAdapter` wrapper if the framework has its own cookie/storage API
3. Add entrypoint to `tsup.config.ts` `entry` object
4. Add to `package.json` `exports` map
5. Write tests in `tests/[framework]-entrypoint.spec.ts`

## Token Response Normalization (`normalizeTokenSet`)

The SDK reads backend responses flexibly:

| Token field | Accepted keys |
|------------|--------------|
| `accessToken` | `access_token`, `accessToken`, `Token`, `token` |
| `refreshToken` | `refresh_token`, `refreshToken`, `RefreshToken` |
| `authProvider` | `auth_provider`, `authProvider` |
| `expiresAt` | computed from `expires_in` (seconds), or `ExpiresAt`/`expiresAt` (Unix ms **or** ISO string) |

`expiresAt` resolution order:
1. If `expires_in` present → `now + expires_in * 1000`
2. Else if `ExpiresAt`/`expiresAt` is a number → use directly
3. Else if it's an ISO string → `new Date(v).getTime()`
4. Else → `undefined` (no expiry tracking)

## Publishing

Uses GitHub OIDC Trusted Publishing — no long-lived npm tokens.
Trigger: `git tag vX.Y.Z && git push --tags`

## Coverage Thresholds

Lines: 70%, Functions: 80%, Branches: 60%, Statements: 70%
