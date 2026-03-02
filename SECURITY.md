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
