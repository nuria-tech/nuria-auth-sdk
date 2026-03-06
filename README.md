# @nuria-tech/auth-sdk

[![npm version](https://img.shields.io/npm/v/@nuria-tech/auth-sdk.svg)](https://www.npmjs.com/package/@nuria-tech/auth-sdk)
[![CI](https://github.com/nuria-tech/nuria-auth-sdk/actions/workflows/ci-publish.yml/badge.svg)](https://github.com/nuria-tech/nuria-auth-sdk/actions/workflows/ci-publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

TypeScript SDK for OAuth 2.0 Authorization Code + PKCE, focused on browser apps and framework integrations (React, Vue, Nuxt, Next, Angular).

## Why this SDK

- PKCE S256 + state validation by default
- Redirect-only flow (no embedded credential UI)
- Optional automatic refresh with concurrency dedupe
- Storage adapters for browser/SSR scenarios
- Framework helpers in dedicated entrypoints

## Installation

```bash
npm install @nuria-tech/auth-sdk
```

Published on [npm](https://www.npmjs.com/package/@nuria-tech/auth-sdk).

## Entrypoints

- `@nuria-tech/auth-sdk`: core client + adapters
- `@nuria-tech/auth-sdk/react`: `useAuthSession`, `AuthProvider`, `useAuth`
- `@nuria-tech/auth-sdk/vue`: `useAuthSession` composable
- `@nuria-tech/auth-sdk/nuxt`: Nuxt cookie adapter helpers
- `@nuria-tech/auth-sdk/next`: Next cookie adapter helpers
- `@nuria-tech/auth-sdk/angular`: RxJS auth facade for Angular services/components

## Auth flows matrix

| Flow | Backend endpoint(s) | SDK method(s) | Result |
|---|---|---|---|
| Google | `POST /v2/google` | `loginWithGoogle(...)` | `Session` tokens |
| Login + password | `POST /v2/login` | `loginWithPassword(...)` | `Session` tokens |
| Code sent (default) | `POST /v2/login-code/challenge` + `POST /v2/2fa/verify-login` | `loginWithCodeSent(...)` + `completeLoginWithCode(...)` | `Session` tokens after code verify |

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

  logout() {
    return this.facade.logout();
  }
}
```

Full Angular example (service + guard + callback route + status component):
`examples/angular`

## Defaults

- `baseUrl`: `https://ms-auth-v2.nuria.com.br`
- `authorizationEndpoint`: `${baseUrl}/v2/oauth/authorize`
- `tokenEndpoint`: `${baseUrl}/v2/oauth/token`
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

## Security notes

- Do not use `clientSecret` in browser/mobile apps.
- Prefer memory storage when possible.
- Keep refresh on cookies (`HttpOnly`) server-side when available.
- Validate `returnTo` on logout redirects.

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
  startLoginCodeChallenge(options: LoginCodeChallengeOptions): Promise<TwoFactorChallenge>;
  verifyLoginCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithCodeSent(options: LoginCodeChallengeOptions): Promise<TwoFactorChallenge>;
  completeLoginWithCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithGoogle(options: GoogleLoginOptions): Promise<Session>;
  loginWithPassword(options: PasswordLoginOptions): Promise<Session>;
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
