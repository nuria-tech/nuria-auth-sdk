# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-02-28

### Added

- Initial release of `@nuria/auth-sdk`
- Support for `redirect` and `whitelabel` authentication modes
- PKCE (Proof Key for Code Exchange) with S256 challenge method
- `getUserinfo()` method to fetch user profile from the userinfo endpoint
- Token revocation on logout for whitelabel mode
- Browser cookie storage adapter (`createBrowserCookieStorage`)
- Web storage adapter for `localStorage` / `sessionStorage` (`WebStorageAdapter`)
- Server-side cookie storage adapter with async callbacks (`CookieStorageAdapter`)
- In-memory storage adapter (`MemoryStorageAdapter`)
- Fetch-based HTTP transport with retry logic and interceptor support (`FetchAuthTransport`)
- Token refresh via `refresh()` and automatic refresh on `getAccessToken()` when expired
- Auth state change listeners via `onAuthStateChanged()`
- ESM + CJS dual build output
