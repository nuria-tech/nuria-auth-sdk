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
- Package published to npm.org (`https://registry.npmjs.org`) with Trusted Publishing (OIDC) — no long-lived tokens
- Minimum Node.js version raised to 20 (Node 18 reached EOL April 2025)
