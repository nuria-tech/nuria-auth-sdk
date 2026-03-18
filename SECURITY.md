# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

To report a security vulnerability, email us at:

**suporte@nuria.com.br**

Include as much detail as possible:

- Description of the vulnerability
- Steps to reproduce (proof of concept if possible)
- Affected version(s)
- Potential impact

## What to Expect

- Acknowledgment within 2 business days
- A fix or mitigation plan communicated privately before any public disclosure
- Credit in the release notes if you wish (with your permission)

## Disclosure Policy

We follow responsible disclosure:

1. Reporter notifies us privately
2. We investigate and develop a fix
3. We release the fix and coordinate a disclosure timeline with the reporter
4. Public disclosure happens after affected users have had reasonable time to update

## Scope

This SDK runs entirely in browser/client environments (public OAuth 2.0 client). There are no server-side secrets managed by this library. Relevant security concerns include:

- Token storage and XSS exposure
- PKCE implementation correctness
- State and nonce parameter generation and validation
- Redirect URL validation (open redirect prevention)
- Timing-safe string comparison for sensitive comparisons
- Cross-tab session synchronization integrity

## Security Controls (Current)

### OAuth / OIDC Flow

- **PKCE S256** is always used — the `plain` method is not supported.
- **PKCE random strings use rejection sampling** — `randomString()` discards bytes ≥ `256 - (256 % 66) = 204` before applying modulo, so all 66 characters in the alphabet are equally likely. This eliminates the modulo bias present in a naive `byte % alphabetLength` approach.
- **State** is generated with `crypto.getRandomValues`, stored before redirect, and validated using timing-safe comparison on callback.
- **Nonce** is generated with `crypto.getRandomValues`, stored before redirect, included in the authorization request, and validated (timing-safe) against the `nonce` claim in the returned token. If the server includes a nonce claim and it does not match, the exchange is rejected with `TOKEN_EXCHANGE_FAILED`.
- **Timing-safe comparisons** — `state` and `nonce` are validated with a constant-time XOR loop (`timingSafeEqual`) to prevent timing side-channel attacks.
- **PKCE artifacts** (`state`, `nonce`, `codeVerifier`) are always removed from storage via a `finally` block — even on token exchange failure, nonce mismatch, or network error. This prevents stale verifiers from being reused.
- Token exchange uses `application/x-www-form-urlencoded` body per RFC 6749.

### Endpoint and URL Security

- All endpoints (`baseUrl`, `authorizationEndpoint`, `tokenEndpoint`, `userinfoEndpoint`) and `redirectUri` must use `https://`. HTTP is only permitted for `localhost`, `127.0.0.1`, and `[::1]` (enforced in `createAuthClient`). An invalid or non-https `redirectUri` throws `INVALID_CONFIG` at construction time.
- `logout({ returnTo })`:
  - accepts `https://` URLs
  - accepts `http://` only for local development hosts (`localhost`, `127.0.0.1`, `[::1]`)
  - rejects protocol-relative URLs, `javascript:` URLs, and URLs with embedded credentials

### Token Handling

- `getClaims()` decodes the JWT payload client-side for **UI convenience only**. The JWT signature is **not verified**. Do not use decoded claims for authorization decisions — always validate tokens server-side.
- `getAccessToken()` never returns an expired token. When `enableRefreshToken: false` and the token has actually expired, the session is cleared and `null` is returned.
- Token refresh requests have a 10-second timeout to prevent the UI from hanging on unresponsive token endpoints.
- HTTP response bodies are read as text and then parsed as JSON, regardless of the declared `Content-Type`, preventing errors from mismatched headers.

### Cross-Tab Sync

- Session sync via `BroadcastChannel` validates the shape of incoming `SESSION_SYNC` messages before applying them. Malformed payloads (e.g. injected by another same-origin script) are silently discarded.

### Cookie Storage

- `createBrowserCookieStorage` applies consistent cookie attributes (`SameSite`, `path`, `domain`) on both `set` and `remove` operations.
- Cookie values are `encodeURIComponent`-encoded on write and decoded on read; the regex parser correctly handles values containing `=` characters (e.g. base64-encoded tokens).

### Session Hydration

- Sessions loaded from storage are validated for correct shape (`tokens.accessToken: string`, `createdAt: number`) before being applied. Corrupted or malformed session data is removed and ignored.

## Secure Usage Recommendations

- Prefer `MemoryStorageAdapter` whenever possible (default).
- If persistence is required, treat `localStorage`/`sessionStorage`/JS-readable cookies as XSS-sensitive — an attacker with script execution can read them.
- Prefer server-side `HttpOnly` cookie sessions (BFF pattern) for high-security applications — tokens never reach JavaScript.
- Never pass `returnTo` values from untrusted input directly; always allowlist on the server.
- Do not rely on `getClaims()` / `hasRole()` / `hasGroup()` for authorization logic — these decode the token client-side without signature verification. Use server-side introspection or a verified session.
- Keep dependencies updated and run `pnpm audit` regularly in CI.
