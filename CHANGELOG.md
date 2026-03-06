# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

## [1.0.3] - 2026-03-05

### Fixed

- Type-level and test compatibility after `AuthClient` expansion:
  - Updated React/Angular test mocks to include new auth methods.
  - Added Node test typing support (`@types/node`, tsconfig `types`) for e2e tests.
  - Fixed React provider test typing for required `children`.
- Build/test reliability updates for expanded test matrix.

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
