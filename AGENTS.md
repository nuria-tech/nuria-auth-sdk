# AGENTS.md — @nuria-tech/auth-sdk

## Purpose
Browser-focused OAuth 2.0 Authorization Code + PKCE (S256) SDK with zero dependencies.
Supports React, Vue, Nuxt, Next.js, and Angular via separate entrypoints.
Designed for the Nuria backend (`https://ms-auth-v2.nuria.com.br`).

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
| `@nuria-tech/auth-sdk` | `dist/index.js` | `createAuthClient`, storage adapters, transport, errors, types |
| `@nuria-tech/auth-sdk/react` | `dist/react.js` | `useAuthSession`, `AuthProvider`, `useAuth` |
| `@nuria-tech/auth-sdk/vue` | `dist/vue.js` | `useAuthSession` |
| `@nuria-tech/auth-sdk/nuxt` | `dist/nuxt.js` | `createNuxtAuthClient`, `createNuxtCookieStorageAdapter` |
| `@nuria-tech/auth-sdk/next` | `dist/next.js` | `createNextAuthClient`, `createNextCookieStorageAdapter` |
| `@nuria-tech/auth-sdk/angular` | `dist/angular.js` | `createAngularAuthFacade`, `createBearerInterceptor` |

## Default Backend Endpoints

| Config | Default |
|--------|---------|
| `baseUrl` | `https://ms-auth-v2.nuria.com.br` |
| `authorizationEndpoint` | `${baseUrl}/v2/oauth/authorize` |
| `tokenEndpoint` | `${baseUrl}/v2/oauth/token` |
| `userinfoEndpoint` | `${baseUrl}/v2/oauth/userinfo` |
| `scope` | `openid profile email` |
| `enableRefreshToken` | `true` |

## Auth Flows

| Method | Backend endpoint | Input |
|--------|-----------------|-------|
| `startLogin()` + `handleRedirectCallback()` | `/v2/oauth/authorize` → `/v2/oauth/token` | PKCE redirect |
| `loginWithPassword({ email, password })` | `POST /v2/login` | Direct |
| `loginWithGoogle({ idToken })` | `POST /v2/google` | Google ID token |
| `loginWithCodeSent()` + `completeLoginWithCode()` | `/v2/login-code/challenge` → `/v2/2fa/verify-login` | 2FA |
| `resetPassword({ email })` | `POST /v2/password/reset` | Public — sends reset email |
| `recoverPassword({ token, newPassword })` | `POST /v2/password/recover` | Recovery token in `Authorization: Bearer` header |
| `changePassword({ oldPassword, newPassword })` | `PATCH /v2/me/password` | Requires active session |

## Storage Keys (localStorage / cookie)

| Key | Content |
|-----|---------|
| `nuria:session` | `Session` JSON `{ tokens: { accessToken, ... }, createdAt }` |
| `nuria:oauth:state` | PKCE state string (cleared after callback) |
| `nuria:oauth:code_verifier` | PKCE verifier (cleared after callback) |

## Architecture Rules

- **PKCE is mandatory** — cannot be disabled
- `init()` must be called once at app startup (e.g. `provideAppInitializer`) to hydrate session from storage before routing
- `isAuthenticated()` returns `true` when token is expired but `enableRefreshToken: true` — callers should use `getAccessToken()` to get an always-valid token
- `getClaims()` decodes the JWT payload via `atob()` — no signature verification (trust the server)
- `hasRole()`/`hasGroup()` support both comma-separated string and array claims
- `getAccessToken()` triggers proactive refresh **30s before expiry** (not after) when `enableRefreshToken: true`
- If refresh fails (e.g. 401 from backend), session is cleared and `null` is returned — no crash
- Concurrent refresh calls are deduplicated via `refreshPromise`
- Cross-tab sync via `BroadcastChannel('nuria:auth:sync')` — fires on login/logout; `init()` does NOT broadcast
- `logout({ returnTo })` only accepts `https://` URLs (or `http://localhost`)

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
