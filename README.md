# @nuria-tech/auth-sdk

[![npm version](https://img.shields.io/npm/v/@nuria-tech/auth-sdk.svg)](https://www.npmjs.com/package/@nuria-tech/auth-sdk)
[![CI](https://github.com/nuria-tech/nuria-auth-sdk/actions/workflows/ci-publish.yml/badge.svg)](https://github.com/nuria-tech/nuria-auth-sdk/actions/workflows/ci-publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

TypeScript SDK for OAuth 2.0 Authorization Code + PKCE, focused on browser apps and framework integrations (React, Vue, Nuxt, Next, Angular).

## Why this SDK

- PKCE S256 + state validation by default
- Redirect (PKCE) and direct credential flows (password, Google, code)
- Optional automatic refresh with concurrency dedupe
- Storage adapters for browser/SSR scenarios
- Framework helpers in dedicated entrypoints

## Minimal Requirements

- ECMAScript Target: ES2018
- Browsers: Any modern browser with support for Fetch API, URLSearchParams, and Web Crypto API
- Node.js: >= 20.0.0 (required natively by package.json)

### Important note on legacy Node.js (e.g., Node 18 or other past versions)

The Node.js >= 20.0.0 exists because the SDK relies onn the global fetch and crypto (Web Crypto API) objects. Older Node versions lack native support for these APIs.

- If you use SSR: Executing the authentication flow on server using Node < 20.0.0 will cause fatal errors.
- If you have an SPA or legacy project (Nuxt2, Vue2): If the authentication runs completely in the user's browser, it is safe to use this SDK. Node will be used strictly to compile the project.
  
Because modern framework versions are mapped as optional peer dependencies, modern npm versions (v7+) might throw an ERESOLVE conflict when installing this SDK iln egacy projects. To bypass both the engine lock - using Node < 20 strictly for build purposes - and the peer dependency conflicts, use the --legacy-peer-deps flag.

### Frameworks and libraries for specific entrypoints (See 'Entrypoints' flag below):
- React: >= 18.0
- Vue: >= 3.3
- Angular: >= 16.0
- Next.js: >= 13.0
- Nuxt: >= 3.0
- RxJS: >= 7.8
  
## Installation

```bash
npm install @nuria-tech/auth-sdk
```

or for older node versions (Node < 20), strictly for build purposes without SSR:
```bash
npm install @nuria-tech/auth-sdk --legacy-peer-deps
````

Published on [npm](https://www.npmjs.com/package/@nuria-tech/auth-sdk).

## Entrypoints

- `@nuria-tech/auth-sdk`: core client + adapters + utilities (`extractRoles`, `extractCompanyOrigin`, `extractAvatarUrl`, `extractDisplayName`, `getInitials`, `buildOAuthAuthorizeUrl`, Google OAuth helpers)
- `@nuria-tech/auth-sdk/react`: `useAuthSession`, `AuthProvider`, `useAuth`
- `@nuria-tech/auth-sdk/vue`: `useAuthSession` composable
- `@nuria-tech/auth-sdk/nuxt`: Nuxt cookie adapter helpers
- `@nuria-tech/auth-sdk/next`: Next cookie adapter helpers
- `@nuria-tech/auth-sdk/angular`: `createAngularAuthFacade` (RxJS facade) + `createBearerInterceptor` (HttpInterceptorFn)

## Auth flows matrix

| Flow | Backend endpoint(s) | SDK method(s) | Result |
|---|---|---|---|
| Google | `POST /v2/google` | `loginWithGoogle(...)` | `Session` tokens |
| Code sent (default) | `POST /v2/login-code/challenge` + `POST /v2/2fa/verify-login` | `loginWithCodeSent(...)` + `completeLoginWithCode(...)` | `Session` tokens after code verify |
| Login + password _(deprecated)_ | `POST /v2/login` | `loginWithPassword(...)` | `Session` tokens |
| Password reset request | `POST /v2/password/reset` | `resetPassword({ email })` | `void` — sends reset email |
| Password recovery | `POST /v2/password/recover` | `recoverPassword({ token, newPassword })` | `void` — resets password using token |
| Change password | `PATCH /v2/me/password` | `changePassword({ oldPassword, newPassword })` | `void` — requires active session |

## Example apps

- `examples/react`
- `examples/vue`
- `examples/nuxt`
- `examples/next`
- `examples/angular`

## Core quick start

```ts
import { createAuthClient } from '@nuria-tech/auth-sdk';

const auth = createAuthClient({
  clientId: 'your-client-id',
  redirectUri: `${window.location.origin}/callback`,
});

await auth.startLogin();
// callback route
await auth.handleRedirectCallback(window.location.href);
const token = await auth.getAccessToken();
console.log(token);
```

## Default login flow (login code sent)

```ts
const challenge = await auth.startLoginCodeChallenge({
  email: 'user@company.com',
  // optional: channel defaults to 'email'
  // channel: 'sms',
});

const session = await auth.verifyLoginCode({
  challengeId: challenge.challengeId,
  code: '123456',
});
```

Aliases with clearer naming:

```ts
await auth.loginWithCodeSent({ email: 'user@company.com' });
await auth.completeLoginWithCode({ challengeId: '...', code: '123456' });
```

## React quick start

```tsx
import { createAuthClient } from '@nuria-tech/auth-sdk';
import { AuthProvider, useAuth } from '@nuria-tech/auth-sdk/react';

const auth = createAuthClient({
  clientId: 'your-client-id',
  redirectUri: `${window.location.origin}/callback`,
});

function AppContent() {
  const { session, isLoading, login, logout } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  if (!session) return <button onClick={() => login()}>Login</button>;
  return <button onClick={() => logout()}>Logout</button>;
}

export function App() {
  return (
    <AuthProvider auth={auth}>
      <AppContent />
    </AuthProvider>
  );
}
```

## Vue quick start

```ts
import { createAuthClient } from '@nuria-tech/auth-sdk';
import { useAuthSession } from '@nuria-tech/auth-sdk/vue';

const auth = createAuthClient({
  clientId: 'your-client-id',
  redirectUri: `${window.location.origin}/callback`,
});

export function usePageAuth() {
  const { session, isLoading, refresh } = useAuthSession(auth);
  return { session, isLoading, refresh };
}
```

## Nuxt quick start

```ts
import { createNuxtAuthClient } from '@nuria-tech/auth-sdk/nuxt';
import { useCookie } from '#app';

const auth = createNuxtAuthClient(
  {
    clientId: process.env.NUXT_PUBLIC_AUTH_CLIENT_ID!,
    redirectUri: process.env.NUXT_PUBLIC_AUTH_CALLBACK_URL!,
  },
  {
    get: (name) => useCookie<string | null>(name).value,
    set: (name, value) => {
      useCookie<string | null>(name).value = value;
    },
    remove: (name) => {
      useCookie<string | null>(name).value = null;
    },
  },
);
```

## Next quick start

```ts
import { createNextAuthClient } from '@nuria-tech/auth-sdk/next';
import { cookies } from 'next/headers';

export function createServerAuth() {
  const cookieStore = cookies();
  return createNextAuthClient(
    {
      clientId: process.env.NEXT_PUBLIC_AUTH_CLIENT_ID!,
      redirectUri: process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL!,
    },
    {
      get: (name) => cookieStore.get(name)?.value,
      set: (name, value) => cookieStore.set(name, value),
      remove: (name) => cookieStore.delete(name),
    },
  );
}
```

## Angular quick start

```ts
import { Injectable } from '@angular/core';
import { createAuthClient } from '@nuria-tech/auth-sdk';
import { createAngularAuthFacade } from '@nuria-tech/auth-sdk/angular';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = createAuthClient({
    clientId: 'your-client-id',
    redirectUri: `${window.location.origin}/callback`,
  });

  private facade = createAngularAuthFacade(this.auth);
  state$ = this.facade.state$;

  login() {
    return this.facade.login();
  }

  /** Clears local session only — no server call. */
  logout() {
    return this.facade.logout();
  }

  /** Clears local session + calls server logout endpoint, then redirects. */
  globalLogout(returnTo?: string) {
    return this.facade.globalLogout({ returnTo });
  }
}
```

Full Angular example (service + guard + callback route + status component):
`examples/angular`

## Defaults

- `baseUrl`: `https://ms-auth-v2.nuria.com.br`
- `authorizationEndpoint`: `${baseUrl}/v2/oauth/authorize`
- `tokenEndpoint`: `${baseUrl}/v2/oauth/token`
- `userinfoEndpoint`: `${baseUrl}/v2/oauth/userinfo`
- `scope`: `openid profile email`
- `enableRefreshToken`: `true`

## Configuration

```ts
interface AuthConfig {
  clientId: string;
  redirectUri: string;
  baseUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  scope?: string;
  logoutEndpoint?: string;
  userinfoEndpoint?: string;
  storage?: StorageAdapter;
  transport?: AuthTransport;
  onRedirect?: (url: string) => void | Promise<void>;
  enableRefreshToken?: boolean;
  now?: () => number;
}
```

## Storage strategy

| Adapter | Persists reload | JS-readable | SSR |
|---|---|---|---|
| `MemoryStorageAdapter` | No | Yes | No |
| `WebStorageAdapter(sessionStorage)` | Per tab | Yes | No |
| `WebStorageAdapter(localStorage)` | Yes | Yes | No |
| `CookieStorageAdapter` | Configurable | Depends on cookie flags | Yes |

## Session health check

`checkSession()` validates the current session against the server by calling the `userinfoEndpoint`. Use it to detect revoked tokens or deactivated users without waiting for a 401 on a regular request.

```ts
const valid = await auth.checkSession();
if (!valid) {
  // session was invalidated server-side — redirect to login
}
```

If the server rejects the token, the local session is cleared and `onAuthStateChanged` listeners are notified. If `userinfoEndpoint` is not configured, falls back to `isAuthenticated()`.

Typical usage: poll every few minutes to catch server-side revocation.

```ts
setInterval(async () => {
  if (!auth.isAuthenticated()) return;
  const valid = await auth.checkSession();
  if (!valid) router.navigate(['/signin']);
}, 5 * 60 * 1000);
```

## Security notes

- Do not use `clientSecret` in browser/mobile apps.
- Prefer memory storage when possible.
- Keep refresh on cookies (`HttpOnly`) server-side when available.
- `logout()` clears the local session only — no server call, no redirect. Use this for in-app sign-out where the user stays in the same app.
- `globalLogout({ returnTo })` calls the server logout endpoint and redirects. `returnTo` must be `https://` (or `http://localhost` for dev); URLs with embedded credentials are rejected.
- `isAuthenticated()` returns `true` when the token is expired but `enableRefreshToken: true` — `getAccessToken()` will silently renew it.
- `getClaims()` decodes the JWT payload client-side via `atob()` without verifying the signature — trust comes from the server that issued the token.
- Browser cookie storage encodes/decodes values safely (`encodeURIComponent`/`decodeURIComponent`).

Full policy and reporting process: [SECURITY.md](./SECURITY.md).

## Public API

```ts
interface AuthClient {
  init(): Promise<void>;
  startLogin(options?: StartLoginOptions): Promise<void>;
  handleRedirectCallback(callbackUrl?: string): Promise<Session>;
  getSession(): Session | null;
  getAccessToken(): Promise<string | null>;
  /** Clears the local session only. No server call, no redirect. */
  logout(): Promise<void>;
  /** Clears the local session AND calls the server logout endpoint, then redirects. */
  globalLogout(options?: { returnTo?: string }): Promise<void>;
  isAuthenticated(): boolean;
  onAuthStateChanged(handler: (session: Session | null) => void): () => void;
  getClaims(): TokenClaims | null;
  hasRole(role: string): boolean;
  hasGroup(group: string): boolean;
  getUserinfo(): Promise<Record<string, unknown>>;
  checkSession(): Promise<boolean>;
  startLoginCodeChallenge(options: LoginCodeChallengeOptions): Promise<TwoFactorChallenge>;
  verifyLoginCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithCodeSent(options: LoginCodeChallengeOptions): Promise<TwoFactorChallenge>;
  completeLoginWithCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithGoogle(options: GoogleLoginOptions): Promise<Session>;
  /** @deprecated Use loginWithCodeSent / startLoginCodeChallenge instead. */
  loginWithPassword(options: PasswordLoginOptions): Promise<Session>;
  resetPassword(options: { email: string }): Promise<void>;
  recoverPassword(options: { token: string; newPassword: string }): Promise<void>;
  changePassword(options: { oldPassword: string; newPassword: string }): Promise<void>;
}
```

## CI and publish

- PR/main runs: typecheck, lint, test, build
- Tag `v*` runs publish workflow with Trusted Publishing

Publish flow:

1. Update `version` in `package.json`
2. Tag and push (`git tag vX.Y.Z && git push --tags`)
3. Workflow validates and publishes

## License

MIT - see [LICENSE](./LICENSE).
