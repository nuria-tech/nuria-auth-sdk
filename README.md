# @nuria/auth-sdk

TypeScript authentication SDK for Nuria frontend projects with two official modes:

- `whitelabel`: embedded login UI integrated with `ms-auth`
- `redirect`: redirect-based login integrated with `accounts`

## Architecture

### Modules

- `src/client`: public client/factory and mode-specific orchestration.
- `src/core`: shared types, PKCE utilities, storage helpers, URL/normalization helpers.
- `src/storage`: pluggable persistence adapters.
- `src/transport`: configurable HTTP transport (fetch + timeout + retries + interceptors).
- `src/errors`: typed auth error model and error codes.

### Flow summary

#### Redirect mode (`accounts`)

1. `buildAuthorizeUrl()` generates `state` and PKCE (`code_verifier`, `code_challenge`), persists state + verifier.
2. `startLogin()` redirects using adapter callback (`onRedirect`) or browser navigation.
3. `handleRedirectCallback()` parses callback URL, validates `state`, exchanges code for tokens.
4. Session is normalized and stored via configured storage adapter.

#### Whitelabel mode (`ms-auth`)

- `flow: "password"`: `signIn(credentials)` calls configured password endpoint and maps token response.
- `flow: "code_exchange"`: `startLogin()` / `buildAuthorizeUrl()` + `exchangeCode(code)` with PKCE.

## Installation

```bash
npm install @nuria/auth-sdk
```

## Public API

```ts
import { createNuriaAuthClient } from '@nuria/auth-sdk';

interface NuriaAuthClient {
  startLogin(options?: StartLoginOptions): Promise<void>;
  buildAuthorizeUrl(options?: StartLoginOptions): Promise<string>;
  handleRedirectCallback(callbackUrl?: string): Promise<Session>;
  signIn(credentials: any): Promise<Session>;
  exchangeCode(code: string): Promise<Session>;
  getSession(): Session | null;
  getAccessToken(): Promise<string | null>;
  refresh(): Promise<Session>;
  logout(options?: { returnTo?: string }): Promise<void>;
  isAuthenticated(): boolean;
  onAuthStateChanged(handler: (session: Session | null) => void): () => void;
}
```

Core exported types:

- `NuriaAuthConfig`
- `Session`
- `TokenSet`
- `AuthError` + `AuthErrorCode`
- `StorageAdapter`
- `AuthTransport`

## Configuration

### Redirect mode (`accounts`)

```ts
import { createNuriaAuthClient } from '@nuria/auth-sdk';

const auth = createNuriaAuthClient({
  mode: 'redirect',
  redirectUri: 'https://app.example.com/callback',
  enableRefreshToken: true,
  redirect: {
    accountsBaseUrl: 'https://accounts.nuria.com.br',
    clientId: 'your-client-id',
    scope: ['openid', 'profile', 'email'],
    authorizePath: '/oauth2/authorize',
    tokenPath: '/oauth2/token',
    logoutPath: '/logout',
    authorizeParamsMapper: (baseParams, options) => ({
      ...baseParams,
      ...(options.provider ? { provider: options.provider } : {}),
    }),
  },
});
```

```ts
await auth.startLogin({
  provider: 'google',
  returnTo: 'https://app.example.com/dashboard',
  extraParams: { ui: 'compact' },
});
```

Callback:

```ts
await auth.handleRedirectCallback(window.location.href);
```

### Whitelabel mode (`ms-auth`)

#### Password flow

```ts
const auth = createNuriaAuthClient({
  mode: 'whitelabel',
  whitelabel: {
    flow: 'password',
    authBaseUrl: 'https://ms-auth.nuria.com.br',
    endpoints: {
      passwordLogin: '/auth/login',
      refresh: '/oauth2/token',
    },
    mapTokenResponse: (raw) => ({
      accessToken: raw.access_token ?? raw.jwt,
      refreshToken: raw.refresh_token ?? raw.refresh,
      expiresIn: raw.expires_in,
    }),
  },
  enableRefreshToken: true,
});

await auth.signIn({ username: 'user@example.com', password: '***' });
```

#### Code exchange flow

```ts
const auth = createNuriaAuthClient({
  mode: 'whitelabel',
  redirectUri: 'https://app.example.com/callback',
  whitelabel: {
    flow: 'code_exchange',
    authBaseUrl: 'https://ms-auth.nuria.com.br',
    endpoints: {
      authorize: '/oauth2/authorize',
      token: '/oauth2/token',
    },
  },
});

await auth.startLogin();
// later
await auth.handleRedirectCallback(window.location.href);
```

## Storage adapters

Default storage is `MemoryStorageAdapter` (secure-by-default for XSS exposure).

```ts
import { WebStorageAdapter } from '@nuria/auth-sdk';

const storage = new WebStorageAdapter(window.sessionStorage);
```

Cookie adapter for SSR/custom environments:

```ts
import { CookieStorageAdapter } from '@nuria/auth-sdk';

const storage = new CookieStorageAdapter({
  getCookie: async (name) => readCookie(name),
  setCookie: async (name, value) => writeCookie(name, value),
  removeCookie: async (name) => deleteCookie(name),
});
```

## Transport customization

```ts
import { FetchAuthTransport } from '@nuria/auth-sdk';

const transport = new FetchAuthTransport({
  timeoutMs: 10000,
  retries: 1,
  interceptors: [
    {
      onRequest: async (_url, req) => ({
        ...req,
        headers: { ...(req.headers ?? {}), 'X-App': 'frontend-a' },
      }),
    },
  ],
});
```

## React example

```tsx
import { useEffect, useMemo, useState } from 'react';
import { createNuriaAuthClient } from '@nuria/auth-sdk';

export function AuthButton() {
  const auth = useMemo(
    () =>
      createNuriaAuthClient({
        mode: 'redirect',
        redirectUri: `${window.location.origin}/callback`,
        redirect: { clientId: 'web-client' },
      }),
    [],
  );

  const [authenticated, setAuthenticated] = useState(auth.isAuthenticated());

  useEffect(() => auth.onAuthStateChanged((session) => setAuthenticated(Boolean(session))), [auth]);

  if (authenticated) {
    return <button onClick={() => auth.logout()}>Logout</button>;
  }
  return <button onClick={() => auth.startLogin({ provider: 'google' })}>Login</button>;
}
```

## Next.js SSR-safe example

```ts
// lib/auth.ts
import { createNuriaAuthClient, CookieStorageAdapter } from '@nuria/auth-sdk';

export function createServerAuth(cookieApi: {
  get: (name: string) => string | undefined;
  set: (name: string, value: string) => void;
  delete: (name: string) => void;
}) {
  return createNuriaAuthClient({
    mode: 'redirect',
    redirectUri: process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL,
    storage: new CookieStorageAdapter({
      getCookie: async (name) => cookieApi.get(name) ?? null,
      setCookie: async (name, value) => cookieApi.set(name, value),
      removeCookie: async (name) => cookieApi.delete(name),
    }),
    redirect: {
      accountsBaseUrl: process.env.NEXT_PUBLIC_ACCOUNTS_BASE_URL,
      clientId: process.env.NEXT_PUBLIC_AUTH_CLIENT_ID,
    },
  });
}
```

## Security recommendations

- Default storage is in-memory to reduce persistence/XSS blast radius.
- Use `sessionStorage` only if UX requires page reload persistence.
- Avoid `localStorage` for long-lived sensitive tokens.
- Prefer httpOnly secure cookies for SSR-managed sessions when possible.
- Validate callback origin/path before invoking callback handling.
- Keep tokens out of logs, analytics payloads, and error reports.
- Enable short access token TTL + refresh token rotation server-side.

### Storage trade-offs

- `memory`: safest client-side default, but clears on reload/tab close.
- `sessionStorage`: survives reload per-tab, still JavaScript-readable.
- `localStorage`: persistent and high convenience, highest XSS impact.
- cookies via callbacks: supports SSR and stronger cookie strategies when configured correctly.

## Troubleshooting

- **Clock skew**: tokens may look expired too early. Mitigate by server-side NTP and optionally refreshing a few seconds before expiry.
- **State mismatch**: ensure the same storage context/tab is used between `startLogin` and callback; clear stale oauth keys and retry.
- **Refresh failure**: verify refresh grant support, refresh endpoint mapping, and `enableRefreshToken: true`.

## Assumptions

- OAuth-compatible token endpoints accept JSON payloads.
- Callback and redirect URI registration is handled externally.
- Backend may return non-standard payload in whitelabel mode; `mapTokenResponse` covers custom mapping.
