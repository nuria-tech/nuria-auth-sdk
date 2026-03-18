# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.1] - 2026-03-18

### Security

- **PKCE modulo bias eliminated** — `randomString()` now uses rejection sampling (threshold = `256 − 256 % 66 = 204`) so all 66 characters in the alphabet are selected with equal probability. The previous modulo approach produced a measurable, though low-impact, statistical bias.
- **Timing-safe state validation** — `handleRedirectCallback()` and `exchangeCode()` now compare OAuth `state` and `nonce` values with `timingSafeEqual()`, a constant-time XOR comparison, preventing timing side-channel attacks.
- **Concurrent refresh deduplicated** — simultaneous `getAccessToken()` calls when the token is expired now share a single in-flight refresh request via `refreshPromise`. Previously, two concurrent callers could both trigger independent refresh requests, leading to a race condition.

## [1.1.0] - 2026-03-18

### Added

- `init()` — hydrates session from storage and notifies listeners; use with `APP_INITIALIZER` / `provideAppInitializer` to avoid re-login on page reload
- `getClaims()` — decodes the JWT access token payload via native `atob()`, no external dependency; returns `TokenClaims | null`
- `hasRole(role)` — checks the `roles` claim; supports comma-separated string and array
- `hasGroup(group)` — checks the `groups` claim; supports comma-separated string and array
- `TokenClaims` interface: standard OIDC claims + `roles`, `groups`, `auth_provider`, index signature
- `TokenSet.authProvider` — extracted from `auth_provider` or `authProvider` in the token response
- `Session.provider` — persisted from `tokens.authProvider`; preserved across silent refresh
- `userinfoEndpoint` now has a default (`${baseUrl}/v2/oauth/userinfo`); no longer throws when omitted
- Cross-tab sync via `BroadcastChannel('nuria:auth:sync')` — login/logout in one tab automatically updates all other open tabs; `init()` does not broadcast (local hydration only)
- Angular entrypoint: `createBearerInterceptor(auth)` — returns an `HttpInterceptorFn` that attaches `Authorization: Bearer <token>` and triggers silent refresh if needed
- `@angular/common >= 16` added as optional peer dependency (required for `HttpInterceptorFn` types)
- CI: pnpm upgraded from v9 to v10 to match local development environment

### Fixed

- `isAuthenticated()` now returns `true` when the access token is expired but `enableRefreshToken: true`, because `getAccessToken()` will silently renew it. Previously it returned `false`, causing guards to redirect to login unnecessarily.

### Changed

- `ResolvedAuthConfig.userinfoEndpoint` is now `string` (required) — always resolved with a default, no longer `string | undefined`

## [1.0.7] - 2026-03-18

### Added

- `resetPassword({ email })` — calls `POST /v2/password/reset`; does not require authentication
- `recoverPassword({ token, newPassword })` — calls `POST /v2/password/recover` with the reset token as `Authorization: Bearer`
- `changePassword({ oldPassword, newPassword })` — calls `PATCH /v2/me/password`; requires an active session
- Unit tests for `resetPassword`, `recoverPassword`, and `changePassword` in `create-client.spec.ts`
- Updated React and Angular test mocks to include the new password management methods

### Fixed

- `doRefresh()` no longer throws when `refreshToken` is absent from the session; it omits the `refresh_token` parameter from the body so that cookie-based (HttpOnly) refresh flows continue to work
- `getAccessToken()` now proactively refreshes 30 seconds before expiry instead of after
- `getAccessToken()` catches refresh errors, clears the stale session, and returns `null` instead of propagating the error to the caller

## [1.0.6] - 2026-03-10

### Changed

- Updated `pnpm-lock.yaml` to include complete dependency trees for framework peer deps (`@angular/core`, `next`, `nuxt`)

## [1.0.5] - 2026-03-10

### Fixed

- Wrapped global `fetch` in an arrow function inside `FetchAuthTransport` to prevent "Illegal invocation" errors in environments where `fetch` is detached from the global context

### Changed

- Updated installation instructions to use `--legacy-peer-deps` for environments where peer dep resolution requires it
- Declared `@angular/core`, `next`, and `nuxt` as optional peer dependencies

## [1.0.4] - 2026-03-06

### Security

- Hardened `logout({ returnTo })` validation:
  - Allows `https://` URLs by default.
  - Allows `http://` only for local development hosts (`localhost`, `127.0.0.1`, `[::1]`).
  - Rejects URLs containing embedded credentials.
- `isAuthenticated()` now considers token expiry (`expiresAt`) when present.
- Browser cookie storage now safely encodes/decodes values and escapes cookie key matching.

### Fixed

- OAuth callback flow now removes stored `state` only after successful token exchange, improving retry behavior on transient exchange failures.
- Added regression tests for:
  - expired session auth-state behavior,
  - `returnTo` protocol/host restrictions,
  - callback failure retry safety,
  - cookie special-character value handling.

## [1.0.3] - 2026-03-05

### Fixed

- Type-level and test compatibility after `AuthClient` expansion:
  - Updated React/Angular test mocks to include new auth methods.
  - Added Node test typing support (`@types/node`, tsconfig `types`) for e2e tests.
  - Fixed React provider test typing for required `children`.
- Build/test reliability updates for expanded test matrix.

## [1.0.2] - 2026-03-05

### Added

- New login methods in `AuthClient`:
  - `startLoginCodeChallenge(options)`
  - `verifyLoginCode(options)`
  - `loginWithCodeSent(options)` (alias)
  - `completeLoginWithCode(options)` (alias)
  - `loginWithGoogle(options)`
  - `loginWithPassword(options)`
- Auth flow matrix/documentation updates for Google, password, and code-sent flows.

### Changed

- Token normalization now accepts backend envelope variants (`Token`, `RefreshToken`, `ExpiresAt`) in addition to OAuth-style fields.

## [1.0.1] - 2026-03-04

### Added

- Framework entrypoints:
  - `@nuria-tech/auth-sdk/react` (`useAuthSession`, `AuthProvider`, `useAuth`)
  - `@nuria-tech/auth-sdk/vue` (`useAuthSession`)
  - `@nuria-tech/auth-sdk/nuxt` (Nuxt cookie adapter helpers)
  - `@nuria-tech/auth-sdk/next` (Next cookie adapter helpers)
  - `@nuria-tech/auth-sdk/angular` (RxJS facade via `createAngularAuthFacade`)
- Initial framework entrypoint tests and examples structure.

### Changed

- Package exports map expanded to include framework-specific bundles/types.

## [1.0.0] - 2026-03-03

### Added

- Initial release of `@nuria-tech/auth-sdk`
- OAuth 2.0 Authorization Code flow with mandatory PKCE (S256)
- `createAuthClient(config)` factory with explicit endpoint configuration
- `startLogin()` — generates PKCE state + code_verifier, redirects to authorization endpoint
- `handleRedirectCallback()` — validates state, exchanges code for tokens, clears PKCE storage
- `getAccessToken()` — returns current token; auto-refreshes on expiry when `enableRefreshToken: true`
- `getUserinfo()` — fetches user profile from configured `userinfoEndpoint`
- `logout()` — clears session; redirects to `logoutEndpoint` if configured; validates `returnTo`
- `isAuthenticated()` and `onAuthStateChanged()` for reactive auth state
- Browser cookie storage adapter (`createBrowserCookieStorage`)
- Web storage adapter for `sessionStorage` / `localStorage` (`WebStorageAdapter`)
- Server-side cookie storage adapter with async callbacks (`CookieStorageAdapter`)
- In-memory storage adapter (`MemoryStorageAdapter`) — secure default
- Fetch-based HTTP transport with retry logic, timeouts, and interceptor support (`FetchAuthTransport`)
- ESM + CJS dual build output with TypeScript declarations
- `.gitattributes` enforcing LF line endings across the repository

### Security

- `extraParams` in `startLogin()` cannot override reserved OAuth parameters (`state`, `code_challenge`, `code_challenge_method`, etc.)
- `handleRedirectCallback()` now includes `error_description` from the authorization server in the thrown `AuthError` message
- `hydrateSession()` validates that the stored session contains a string `accessToken` before accepting it; malformed entries are cleared from storage

### Changed

- Package renamed from `@nuria/auth-sdk` to `@nuria-tech/auth-sdk` to match the NPM/GitHub organization scope
- Package published to npm.org (`https://registry.npmjs.org`) with Trusted Publishing (OIDC) - no long-lived tokens
- Minimum Node.js version raised to 20 (Node 18 reached EOL April 2025)
