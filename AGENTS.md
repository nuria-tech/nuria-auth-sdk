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
    claims.ts                     # extractRoles(), extractCompanyOrigin(), extractAvatarUrl(), extractDisplayName(), getInitials()
    oauth.ts                      # buildOAuthAuthorizeUrl()
    google.ts                     # renderGoogleSignInButton(), promptGoogleOneTap(), cancelGooglePrompt(), disableGoogleAutoSelect() — wraps Google Identity Services (GIS / FedCM); validates id_token nonce client-side
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
| `@nuria-tech/auth-sdk` | `dist/index.js` | `createAuthClient`, storage adapters, transport, errors, types, `extractRoles`, `extractCompanyOrigin`, `extractAvatarUrl`, `extractDisplayName`, `getInitials`, `buildOAuthAuthorizeUrl`, Google + AWS IAM Identity Center (SSO) OAuth helpers |
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
code flow. There is no `client_secret` pathway; backend-issued URLs use
the kernel-side launch-link flow (PKCE preserved, verifier in DDB) — see
[Server-side launch links](#server-side-launch-links-backend-issued).
`code_challenge_method` is hardcoded to `S256`.

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

## Storage Keys (localStorage / cookie)

| Key | Content |
|-----|---------|
| `nuria:session` | `Session` JSON `{ tokens: { accessToken, ... }, createdAt }` |
| `nuria:oauth:state` | PKCE state string (cleared after callback, always via `finally`) |
| `nuria:oauth:code_verifier` | PKCE verifier (cleared after callback, always via `finally`) |
| `nuria:oauth:nonce` | OIDC nonce string (cleared after callback, always via `finally`) |
| `nuria:google:nonce` | GIS nonce (cleared once the credential callback validates it; `disableGoogleAutoSelect()` also clears it) |
| `nuria:aws:pkce:<state>` | Per-flight AWS PKCE bag — `{ codeVerifier, nonce, redirectUri, clientId, tokenEndpoint, returnSearch }`. Removed by `parseAwsQueryCallback` whether the exchange succeeds or fails. |

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
- `logout()` clears local session only — no server call, no redirect
- `globalLogout({ returnTo })` calls `logout()` then calls `logoutEndpoint` and redirects; `returnTo` only accepts `https://` URLs (or `http://localhost`)
- `revokeSession()` POSTs to `/v2/logout` with the current refresh token to revoke it server-side; does NOT touch the local session. Best-effort: 4xx (already revoked) and network errors are swallowed so callers can sequence `revokeSession()` → `logout()` without leaving the user stuck signed-in client-side if the server call fails. Timeout is 5s.
- `revokeAllSessions()` POSTs to `/v2/logout/global` (Bearer in `Authorization` header) to revoke **every** refresh token of the authenticated subject server-side. Same best-effort posture as `revokeSession`; same 5s timeout; same "doesn't touch local session" contract. Use only in the SSO portal — per-app callers want the per-row `revokeSession`. Dev tokens survive: the kernel keeps `DevTokenRevocation` keyed by JTI on a separate trail and `EvaluateAccess` bypasses the session kill-switch when a JWT carries a `jti`.

## Server-side launch links (backend-issued)

The SDK is a browser library — backends that need to mint authorize URLs
don't use it. They go straight to the kernel:

```
POST /v2/oauth/launch-link              ← Bearer App Token
  body: { clientId, redirectUri, scope?, loginHint?, ttlSeconds? }
  → { launchUrl, state, expiresAt }

POST /v2/oauth/launch-link/exchange     ← Bearer App Token (same one that minted)
  body: { state, code }
  → { access_token, refresh_token, ... }   // same shape as /v2/oauth/token
```

Why it matters for SDK consumers: a SPA running `auth.startLogin()`
generates verifier + challenge in `sessionStorage`. A backend can't do
that — there's no browser session at the moment the URL is being built.
The kernel covers the gap by storing the verifier in DDB
(`NuriaAuth.OAuthLaunchState`) keyed by an opaque state string. The
issuer's `redirect_uri` handler trades `(state, code)` for tokens.

**Compliance:** PKCE is preserved, not bypassed. Same `code_verifier` →
`code_challenge_method=S256` cryptographic binding as the browser flow.
This is the OAuth-2.1-clean way to handle confidential-client scenarios
without introducing a `client_secret` pathway.

**See also:** the kernel's `CONTRACT_V2.md` has the full request/response
shape, error codes, and AWS CLI commands to provision the DDB table.

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

Lines: 70%, Functions: 90%, Branches: 60%, Statements: 70%
