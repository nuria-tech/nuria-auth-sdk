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
- State parameter generation and validation
- Redirect URL validation (open redirect prevention)
- Timing-safe string comparison for state validation

## Security Controls (Current)

- PKCE S256 is always used in OAuth Authorization Code flow.
- `state` is validated using timing-safe comparison.
- OAuth callback removes stored `state` only after successful token exchange (improves retry safety on transient failures).
- `logout({ returnTo })` validation:
  - accepts `https://` URLs
  - accepts `http://` only for local development hosts (`localhost`, `127.0.0.1`, `[::1]`)
  - rejects URLs with embedded credentials
- Browser cookie storage uses safe encode/decode for values.

## Secure Usage Recommendations

- Prefer `MemoryStorageAdapter` whenever possible.
- If persistence is required, treat `localStorage`/`sessionStorage`/JS-readable cookies as XSS-sensitive.
- Prefer server-side `HttpOnly` cookie sessions (BFF pattern) for high-security apps.
- Never accept `returnTo` from untrusted input without server-side allowlisting.
- Keep dependencies updated and run `pnpm audit` regularly in CI.
