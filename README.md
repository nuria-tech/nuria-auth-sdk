# @nuria-tech/auth-sdk

A minimal, browser-native TypeScript SDK for OAuth 2.0 Authorization Code flow with PKCE. Redirect-only — no embedded UI, no password flows.

## Features

- Authorization Code flow + PKCE (S256, mandatory)
- State parameter generation and validation
- Token exchange via standard form-encoded request
- Automatic token refresh (optional)
- Pluggable storage adapters (memory, sessionStorage, cookies)
- Configurable HTTP transport with retry and interceptors
- Zero production dependencies — uses Web Crypto API and fetch

## Installation

```bash
npm install @nuria-tech/auth-sdk
```

Published on [npm](https://www.npmjs.com/package/@nuria-tech/auth-sdk).

## Quick start

```ts
import { createAuthClient } from '@nuria-tech/auth-sdk';

const auth = createAuthClient({
  clientId: 'your-client-id',
  authorizationEndpoint: 'https://your-auth-server.example.com/authorize',
  tokenEndpoint: 'https://your-auth-server.example.com/token',
  redirectUri: 'https://your-app.example.com/callback',
  scope: 'openid profile email',
});

// Redirect to login
await auth.startLogin();

// In your callback page
const session = await auth.handleRedirectCallback(window.location.href);
console.log(session.tokens.accessToken);
```

## Configuration

```ts
interface AuthConfig {
  // Required
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;

  // Optional
  scope?: string;              // default scope sent with every login
  logoutEndpoint?: string;     // if set, logout() redirects here
  userinfoEndpoint?: string;   // required for getUserinfo()
  storage?: StorageAdapter;    // default: MemoryStorageAdapter
  transport?: AuthTransport;   // default: FetchAuthTransport
  onRedirect?: (url: string) => void | Promise<void>;  // override browser redirect
  enableRefreshToken?: boolean; // enable automatic token refresh
  now?: () => number;          // override Date.now() for testing
}
```

> **Security note:** Do not include `clientSecret` in browser apps. This SDK is designed for public clients (SPAs, mobile). PKCE provides the proof of possession without a client secret.

## Public API

```ts
interface AuthClient {
  startLogin(options?: StartLoginOptions): Promise<void>;
  handleRedirectCallback(callbackUrl?: string): Promise<Session>;
  getSession(): Session | null;
  getAccessToken(): Promise<string | null>;
  logout(options?: { returnTo?: string }): Promise<void>;
  isAuthenticated(): boolean;
  onAuthStateChanged(handler: (session: Session | null) => void): () => void;
  getUserinfo(): Promise<Record<string, unknown>>;
}
```

### `startLogin(options?)`

Generates PKCE `code_verifier` + `code_challenge` (S256), stores them in the configured storage, and redirects to `authorizationEndpoint`. The `state` parameter is always included and validated on callback.

```ts
await auth.startLogin({
  scopes: ['openid', 'profile'],     // overrides config.scope
  loginHint: 'user@example.com',
  extraParams: { prompt: 'login' },
});
```

### `handleRedirectCallback(callbackUrl?)`

Parses the callback URL, validates `state`, exchanges `code` for tokens using a form-encoded POST to `tokenEndpoint`, and clears transient PKCE storage. Throws typed `AuthError` on any failure.
Token endpoint calls are sent with `credentials: 'include'` to support `HttpOnly` refresh-token cookies.

```ts
// In your /callback route
const session = await auth.handleRedirectCallback(window.location.href);
```

### `getAccessToken()`

Returns the current access token. If the token is expired and `enableRefreshToken: true`, automatically refreshes it (concurrent calls are deduplicated).
Refresh calls to `tokenEndpoint` are sent with `credentials: 'include'`.
If no `refresh_token` is available in JS memory/storage, SDK still attempts refresh using cookie-based session (HttpOnly) when the server supports it.

### `logout(options?)`

Clears the local session. If `logoutEndpoint` is configured, redirects to it. Validates `returnTo` to prevent open redirect attacks.

```ts
await auth.logout({ returnTo: 'https://your-app.example.com' });
```

### `onAuthStateChanged(handler)`

Subscribes to session changes. Returns an unsubscribe function.

```ts
const unsubscribe = auth.onAuthStateChanged((session) => {
  console.log(session ? 'logged in' : 'logged out');
});
```

## Storage adapters

Default is `MemoryStorageAdapter` (most secure for XSS resistance, clears on reload).

```ts
import { WebStorageAdapter } from '@nuria-tech/auth-sdk';

// sessionStorage: persists per tab, JS-readable
const auth = createAuthClient({
  ...config,
  storage: new WebStorageAdapter(window.sessionStorage),
});
```

Cookie adapter for SSR:

```ts
import { CookieStorageAdapter } from '@nuria-tech/auth-sdk';

const auth = createAuthClient({
  ...config,
  storage: new CookieStorageAdapter({
    getCookie: async (name) => getCookieFromRequest(name),
    setCookie: async (name, value) => setResponseCookie(name, value),
    removeCookie: async (name) => clearResponseCookie(name),
  }),
});
```

## Transport customization

```ts
import { FetchAuthTransport } from '@nuria-tech/auth-sdk';

const auth = createAuthClient({
  ...config,
  transport: new FetchAuthTransport({
    timeoutMs: 10_000,
    retries: 1,
    interceptors: [
      {
        onRequest: async (_url, req) => ({
          ...req,
          headers: { ...(req.headers ?? {}), 'X-App-Version': '1.0.0' },
        }),
      },
    ],
  }),
});
```

## React example

```tsx
import { useMemo, useState, useEffect } from 'react';
import { createAuthClient } from '@nuria-tech/auth-sdk';

const auth = createAuthClient({
  clientId: 'your-client-id',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: `${window.location.origin}/callback`,
});

export function App() {
  const [session, setSession] = useState(auth.getSession());

  useEffect(() => auth.onAuthStateChanged(setSession), []);

  if (!session) {
    return <button onClick={() => auth.startLogin()}>Login</button>;
  }
  return <button onClick={() => auth.logout()}>Logout</button>;
}
```

## Next.js SSR example

```ts
// lib/auth.ts
import { createAuthClient, CookieStorageAdapter } from '@nuria-tech/auth-sdk';

export function createServerAuth(cookieApi: {
  get: (name: string) => string | undefined;
  set: (name: string, value: string) => void;
  delete: (name: string) => void;
}) {
  return createAuthClient({
    clientId: process.env.NEXT_PUBLIC_AUTH_CLIENT_ID!,
    authorizationEndpoint: `${process.env.NEXT_PUBLIC_AUTH_BASE_URL}/authorize`,
    tokenEndpoint: `${process.env.NEXT_PUBLIC_AUTH_BASE_URL}/token`,
    redirectUri: process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL!,
    storage: new CookieStorageAdapter({
      getCookie: async (name) => cookieApi.get(name) ?? null,
      setCookie: async (name, value) => cookieApi.set(name, value),
      removeCookie: async (name) => cookieApi.delete(name),
    }),
    onRedirect: (url) => { redirect(url); },
  });
}
```

## Security notes

- **No secrets:** Never include a `clientSecret` in browser/mobile apps. This SDK supports public clients only.
- **PKCE is mandatory:** S256 code challenge is always used. Plain PKCE is not supported.
- **State validation:** State is always generated and validated on callback.
- **Memory storage default:** Tokens are stored in memory by default to minimize XSS exposure.
- **Use sessionStorage cautiously:** Survives page reload but is still JS-readable.
- **Avoid localStorage** for sensitive tokens.
- **Validate `returnTo`:** The `logout()` method rejects non-`https://` or `http://` `returnTo` values.

## Storage trade-offs

| Adapter | Persists reload | XSS risk | SSR compatible |
|---------|----------------|----------|----------------|
| `MemoryStorageAdapter` | No | Lowest | No |
| `WebStorageAdapter(sessionStorage)` | Per tab | Medium | No |
| `WebStorageAdapter(localStorage)` | Yes | High | No |
| `CookieStorageAdapter` | Configurable | Low (httpOnly) | Yes |

## Troubleshooting

- **State mismatch:** Ensure the same storage instance/tab is used between `startLogin()` and `handleRedirectCallback()`. Clear `nuria:oauth:state` and retry.
- **Missing code_verifier:** The `nuria:oauth:code_verifier` key was not found in storage. Ensure `startLogin()` was called before `handleRedirectCallback()`.
- **Token refresh fails:** Ensure `enableRefreshToken: true` is set and the auth server supports the `refresh_token` grant for your client.

## CI/CD

This repository uses GitHub Actions (`.github/workflows/ci-publish.yml`):

- **PR and `main` push:** typecheck, lint, test (coverage), build — runs on Node 20, 22
- **Tag `v*` push:** validates tag matches `package.json` version, then publishes to npm via Trusted Publishing (OIDC — no stored tokens)

### Publishing

1. Update `version` in `package.json`
2. Push a tag: `git tag v1.0.0 && git push --tags`
3. The workflow validates the version and publishes to npm

> **One-time setup:** after the first manual publish, configure Trusted Publishing at **npmjs.com → package → Settings → Automated Publishing** with repository `nuria-tech/nuria-auth-sdk` and workflow `ci-publish.yml`.

## License

MIT — see [LICENSE](./LICENSE).
