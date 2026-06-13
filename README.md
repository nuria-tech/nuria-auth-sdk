# @nuria-tech/auth-sdk

[![npm version](https://img.shields.io/npm/v/@nuria-tech/auth-sdk.svg)](https://www.npmjs.com/package/@nuria-tech/auth-sdk)
[![CI](https://github.com/nuria-tech/nuria-auth-sdk/actions/workflows/ci-publish.yml/badge.svg)](https://github.com/nuria-tech/nuria-auth-sdk/actions/workflows/ci-publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

TypeScript SDK for **OAuth 2.1** Authorization Code + PKCE (S256), focused on browser apps and framework integrations (React, Vue, Nuxt, Next, Angular). PKCE is mandatory on every flow; there is no `client_secret` pathway. Native CLI/desktop apps authenticate via loopback redirect (RFC 8252). Headless devices use the RFC 8628 device authorization grant — see [Device authorization](#device-authorization-rfc-8628) below for the verification-side helpers this SDK exposes.

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
- `@nuria-tech/auth-sdk/vue`: `useAuthSession` composable · `ImpersonationBanner` component · `mountImpersonationBanner()` helper
- `@nuria-tech/auth-sdk/nuxt`: Nuxt cookie adapter helpers
- `@nuria-tech/auth-sdk/next`: Next cookie adapter helpers
- `@nuria-tech/auth-sdk/angular`: `createAngularAuthFacade` (RxJS facade) + `createBearerInterceptor` (HttpInterceptorFn)

## Auth flows matrix

| Flow | Backend endpoint(s) | SDK method(s) | Result |
|---|---|---|---|
| OAuth Authorization Code + PKCE (recommended for consumer SPAs) | `GET /v2/oauth/authorize` + `POST /v2/oauth/token` | `startLogin()` + `handleRedirectCallback(...)` | `Session` tokens after redirect roundtrip |
| Google (auth code / custom button) | `POST /v2/google/code` | `loginWithGoogleCode({ code, redirectUri? })` | `Session` tokens |
| Code sent (passwordless OTP) | `POST /v2/login-code/challenge` + `POST /v2/2fa/verify-login` | `startLoginCodeChallenge(...)` + `verifyLoginCode(...)` | `Session` tokens after code verify |
| Magic link (passwordless, email-delivered) | `POST /v2/login/magic/send` + `POST /v2/login/magic/verify` | `sendMagicLink({ email })` + `loginWithMagicLink({ token })` | `Session` tokens after link click |
| Login + password (portal-only) | `POST /v2/login` | `loginWithPassword(...)` | `Session` tokens (or `FORCE_PASSWORD_RESET` error) |
| Force password reset | `POST /v2/password/force-reset` | `forceResetPassword(newPassword, resetToken)` | `Session` tokens |
| Password reset request | `POST /v2/password/reset` | `resetPassword({ email })` | `void` — sends reset email |
| Password recovery | `POST /v2/password/recover` | `recoverPassword({ token, newPassword })` | `void` — resets password using token |
| Change password | `PATCH /v2/me/password` | `changePassword({ oldPassword, newPassword })` | `void` — requires active session |
| Federated OIDC IdP | `GET /v2/login/oidc/{p}/begin` → `POST /v2/login/oidc/redeem` | `startOidcLogin(...)` + `handleOidcCallback()` | `Session` tokens via bridge-code exchange |

`loginWithPassword` is intended for the SSO portal (`accounts.nuria.com.br`)
only — consumer SPAs should use `startLogin()` so the user sees a single
sign-in surface across all apps.

### Login methods config

Pass a `loginMethods` block to `createAuthClient` to tell login UIs which
buttons to render — both your own (if you build a custom login screen) and
the centralized Nuria accounts SPA (when you use `startLogin()` to redirect
there, which is the standard path):

```ts
const auth = createAuthClient({
  clientId: '...',
  redirectUri: '...',
  loginMethods: {
    enabled: ['password', 'google', 'passwordless'],
    comingSoon: [],
  },
});

// Custom login UI: read the resolved config back synchronously.
const cfg = auth.getLoginMethods();
if (cfg.enabled.includes('google')) renderGoogleButton();
if (cfg.enabled.includes('passwordless')) renderMagicLinkForm();

// Standard path (redirect to Nuria accounts): startLogin() automatically
// serializes loginMethods into `?login_methods_enabled=` and
// `?login_methods_coming_soon=` on the redirect URL. Accounts reads them
// and renders the right buttons for *your* app — no extra plumbing.
await auth.startLogin();
```

Either field can be omitted — missing fields fall back to
`DEFAULT_LOGIN_METHODS` (`enabled: ['password', 'google', 'passwordless']`,
`comingSoon: []`). Unknown values are dropped; methods listed in `enabled`
are stripped from `comingSoon` automatically.

**Security note**: this is a UI hint, not an auth gate. The kernel is the
authoritative boundary. A crafted URL with arbitrary `login_methods_*`
params can only change which buttons accounts renders — it cannot bypass
authentication.

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

The verification destination is resolved server-side from the user's
stored email or cellphone based on `channel`. The challenge request body
carries only `email`, `channel`, and `purpose` — no client-supplied
destination, since honoring it would let an attacker who knows only an
email divert the OTP to themselves.

## Federated login: Google (OAuth 2.0 Authorization Code)

For Google sign-in with a fully custom button, use `createGoogleCodeClient`,
which wraps Google's `google.accounts.oauth2.initCodeClient`. The code
client supports programmatic invocation, fits the OAuth 2.1 Authorization
Code flow, and returns an authorization code that the backend exchanges
for tokens at `/v2/google/code`.

```ts
import { createGoogleCodeClient } from '@nuria-tech/auth-sdk';

const client = await createGoogleCodeClient({
  clientId: 'google-app-client-id',
  scope: 'openid email profile',          // default; override for extra APIs
  uxMode: 'popup',                        // 'popup' (default) | 'redirect'
  // loginHint: 'user@nuria.com.br',
  // hd: 'nuria.com.br',
  // selectAccount: true,
  // prompt: 'consent',
  onCode: async ({ code }) => {
    // Backend exchanges the code at oauth2.googleapis.com/token using
    // client_secret and returns a session.
    await auth.loginWithGoogleCode({ code });
  },
  onError: (err) => console.error(err),
});

// Wire the SDK call to a real user-gesture handler — popup mode is blocked
// by the browser otherwise.
document.getElementById('my-google-btn')!.addEventListener('click', () => {
  client.requestCode();
});
```

**Popup vs redirect.** `popup` (default) opens an OAuth consent window via
GIS' internal `window.open`. After the user picks an account and consents,
the popup closes and `onCode` fires in the parent window — the user never
leaves the page. `redirect` is a full-page redirect to Google and back to
the configured `redirectUri` with `?code=...`; use this only if popup
blockers are a concern.

**State / CSRF.** The SDK auto-generates a `state` parameter, stores it in
`sessionStorage` under `GOOGLE_OAUTH2_STORAGE_KEYS.state`, and verifies the
round-trip value with `timingSafeEqual` before invoking `onCode`. Pass
`state` explicitly only to embed correlation IDs.

**No client-side token exchange.** The SDK never POSTs to Google's `/token`
endpoint — Google's `/token` does not have reliable CORS for SPAs and the
exchange requires the GCP client's `client_secret`. The backend is the
only place that can safely exchange the code.

> **Removed in v6.** `loginWithGoogle({ idToken })` (Google ID token via
> GIS / FedCM `google.accounts.id`) and `loginWithAws({ idToken })` (AWS
> IAM Identity Center direct id-token submission) were removed in v6 —
> both were "implicit flow" patterns that proved unreliable in production
> (FedCM cooldown, inert iframe). Migrate to `createGoogleCodeClient` +
> `loginWithGoogleCode` for Google. AWS IAM Identity Center is no longer
> covered by the SDK; consumers that need it should drive the OAuth 2.1
> Authorization Code + PKCE flow themselves and POST the result to a
> backend that handles session issuance.

## Native CLI / desktop apps — loopback redirect (RFC 8252)

Native apps don't run in a browser, but they have a browser available.
The standard pattern is to bind to an ephemeral loopback port and use
that as the OAuth `redirect_uri`. The SDK is browser-only and does not
ship a CLI runtime; the flow lives in your CLI/desktop code, but it
talks to the same backend endpoints (`/v2/oauth/authorize` +
`/v2/oauth/token`) the SDK uses.

```text
1. Native app starts an HTTP listener on http://127.0.0.1:<random-port>/callback
2. Open the system browser at:
     https://auth.nuria.com.br/v2/oauth/authorize
       ?response_type=code
       &client_id=<oauth-client-guid>
       &redirect_uri=http%3A%2F%2F127.0.0.1%3A<port>%2Fcallback
       &state=<random>
       &code_challenge=<S256(verifier)>
       &code_challenge_method=S256
3. User authenticates in the browser; it redirects to the loopback URL.
4. App exchanges code at /v2/oauth/token with the verifier.
```

**Client allow-list.** Register the canonical port-less URI on the
OAuth client once: `http://127.0.0.1/callback`. Any port the app picks
at request time is accepted; path and query must be exact. `localhost`
is **not** treated as loopback (RFC 8252 §8.3) — clients must use the
IP literal.

## Device authorization (RFC 8628)

For headless devices (TV apps, IoT, SSH terminals, CI runners) that have
no local browser, the device authorization grant lets the user complete
authentication on a separate device. The polling side (the device) is
out of scope for this browser SDK — it runs in your CLI/embedded code.
The SDK provides the **verification-side** helpers needed by SPAs that
host the user-facing approval page (e.g. `accounts.nuria.com.br/device`).

End-to-end shape:

```text
device  → POST /v2/oauth/device/authorize  (form: client_id)
device  ← { device_code, user_code, verification_uri, verification_uri_complete,
            expires_in, interval }

device  shows: "Open <verification_uri> and enter <user_code>"

user    → opens https://accounts.nuria.com.br/device?user_code=WDJB-MJHT
user    → confirms on the page (which uses the SDK helpers below)

device  polls POST /v2/oauth/token with
          grant_type=urn:ietf:params:oauth:grant-type:device_code
          device_code=...
          client_id=...
        until it gets 200 + tokens (or access_denied / expired_token).
```

### Verification-page helpers

```ts
import { createAuthClient } from '@nuria-tech/auth-sdk';

const auth = createAuthClient({
  clientId: 'accounts-spa-client-id',
  redirectUri: 'https://accounts.nuria.com.br/callback',
});

// 1. User lands on /device?user_code=WDJB-MJHT — show what they're approving.
const lookup = await auth.lookupDeviceUserCode('WDJB-MJHT');
// → { userCode, clientId, clientName, scope, expiresAt }
// (anti-enumeration: throws on unknown / expired / non-pending codes)

// 2. User clicks "Authorize" — the current session approves the row.
await auth.approveDeviceUserCode('WDJB-MJHT');

// 3. User clicks "Cancel" — deny the row instead.
await auth.denyDeviceUserCode('WDJB-MJHT');
```

`approveDeviceUserCode` and `denyDeviceUserCode` require an active
session (Bearer access token). The SDK uses `getAccessToken()` so
silent refresh is handled automatically. Call `lookupDeviceUserCode`
**before** rendering the confirm button so the user sees the client
name and scope they're authorizing.

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
import { useAuthSession, mountImpersonationBanner } from '@nuria-tech/auth-sdk/vue';

const auth = createAuthClient({
  clientId: 'your-client-id',
  redirectUri: `${window.location.origin}/callback`,
});

// Mount the impersonation banner once — it appears automatically whenever an
// operator session is active and cannot be dismissed by the user.
mountImpersonationBanner(auth);

export function usePageAuth() {
  const { session, isLoading, refresh } = useAuthSession(auth);
  return { session, isLoading, refresh };
}
```

See [docs/impersonation-banner.md](./docs/impersonation-banner.md) for layout offset, custom stop handlers, and the declarative `<ImpersonationBanner>` component alternative.

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

- `baseUrl`: `https://auth.nuria.com.br`
- `authorizationEndpoint`: `${baseUrl}/v2/oauth/authorize`
- `tokenEndpoint`: `${baseUrl}/v2/oauth/token`
- `userinfoEndpoint`: `${baseUrl}/v2/oauth/userinfo`
- `scope`: `openid profile email`
- `enableRefreshToken`: `true`
- `storage`: `sessionStorage` in the browser, else in-memory (holds only transient OAuth state — never tokens)

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
  /** Holds ONLY transient OAuth state (never tokens). Default: sessionStorage. */
  storage?: StorageAdapter;
  transport?: AuthTransport;
  onRedirect?: (url: string) => void | Promise<void>;
  enableRefreshToken?: boolean;
  /**
   * DPoP (RFC 9449) sender-constrained tokens.
   * "auto" (default in browser) — SDK manages the ES256 key pair in IndexedDB.
   * false — plain Bearer tokens.
   * DpopProofSigner — custom signer.
   */
  dpop?: DpopProofSigner | 'auto' | false;
  /**
   * Auto-call init() on creation in browser environments (default: true).
   * Set false to call init() yourself or to keep tests deterministic.
   * Has no effect in SSR / Node.js.
   */
  autoInit?: boolean;
  now?: () => number;
}
```

## Client initialization

`createAuthClient()` returns a ready-to-use client. In browser environments,
`init()` is called automatically (`autoInit: true` by default) so apps don't
need any manual setup. Use `auth.ready` to wait for initialization when needed:

```ts
// Most apps — nothing extra required.
const auth = createAuthClient({ clientId, redirectUri, storage });

// If you need to wait for the session to be hydrated before rendering:
await auth.ready;
const session = auth.getSession(); // safe to call — init is done

// Nuxt plugin / any async setup:
export default defineNuxtPlugin(async () => {
  const auth = createAuthClient({ ... });
  await auth.ready;
  return { provide: { auth } };
});
```

Opt out of auto-init when you need explicit control:

```ts
const auth = createAuthClient({ ..., autoInit: false });
await auth.init(); // you choose when
```

## Token storage (v8 — secure by default)

> **Breaking change in v8.** The SDK no longer persists tokens anywhere.

- **Access token: in memory only.** It is never written to `localStorage`,
  `sessionStorage`, or any cookie — so an XSS payload has nothing at rest to
  exfiltrate, and the token is short-lived anyway.
- **Refresh token: HttpOnly `__Host-nuria_rt` cookie only.** It is never read
  into JavaScript. Every login flow and the code exchange use
  `credentials: 'include'` so the kernel can set it; silent refresh re-sends
  the cookie (`POST /v2/oauth/token`, no `refresh_token` body param) and the
  kernel rotates it.
- **On reload**, the SDK re-establishes the in-memory access token via a
  cookie-based silent refresh. It only attempts this when a **non-sensitive**
  marker (`nuria:auth:has_session`) is present — set on login, cleared on
  logout. The marker is not a credential.

The `storage` adapter you pass now holds **only transient OAuth state**
(`state`, `nonce`, PKCE `code_verifier`, the force-relogin and has-session
markers) — never tokens. It must survive the authorize redirect round-trip, so
it defaults to **`sessionStorage`** in the browser (in-memory in SSR).

| Adapter | Good for | Notes |
|---|---|---|
| `WebStorageAdapter(sessionStorage)` | **default** (browser) | Survives the redirect, clears on tab close. Holds only transient state. |
| `MemoryStorageAdapter` | SSR / tests | No persistence; the redirect/PKCE flow needs a persistent adapter. |
| `WebStorageAdapter(localStorage)` | cross-tab persistence of *state* | Acceptable for the transient artifacts above; **never** stores tokens. |
| `CookieStorageAdapter` | SSR state | For transient state in cookie-only runtimes. |

> Migrating from v6/v7: drop any `storage: new WebStorageAdapter(localStorage)`
> you used to persist the session — it is no longer needed (and no longer
> stores tokens). Ensure your app and the kernel share a site so the
> `__Host-nuria_rt` cookie flows (same registrable domain, `credentials:
> 'include'`, CORS `Access-Control-Allow-Credentials: true`).

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

## Logout & re-authentication

When the user clicks "Sair" in your app, you almost always want them to
see a real login screen the next time they sign in — not be silently
re-issued a token by the upstream SSO session. As of `4.0.0` this is
the default:

```ts
// 1. User clicks "Sair"
await auth.logout();
// → local session cleared
// → SDK persists a one-shot "force re-login" marker

// 2. Later, user clicks "Entrar"
await auth.startLogin();
// → SDK reads the marker, adds ?prompt=login to the authorize URL,
//   clears the marker
// → IdP renders its login form even if the SSO session is still warm
// → User sees and performs an explicit login
```

The marker is one-shot: a second `startLogin()` without an intervening
`logout()` does **not** add `prompt=login`, so normal SSO continues to
work for in-flow navigations. If `onRedirect` (or the redirect path) throws
before the navigation succeeds, the marker is preserved so the user's
retry still goes through `prompt=login`.

The marker is also storage-scoped to the SDK instance (its
`StorageAdapter`), so logging out of app A on origin `a.example.com`
does not influence the next sign-in to app B on `b.example.com` —
each app independently arms its own re-authentication.

> **Storage caveat.** With `MemoryStorageAdapter` the marker lives only
> in-memory and is lost on page reload. If your app calls `logout()` and
> then the user refreshes before clicking "Entrar", silent SSO returns.
> For the force-relogin guarantee to survive reload, use a persistent
> adapter (`WebStorageAdapter`, `CookieStorageAdapter`, etc.).

### Opting out — `keepSso: true`

Pass `{ keepSso: true }` when the app deliberately wants classic silent
SSO across logout. The clearest legitimate case is a background
refresh failure: the user's refresh token expired, but you want them
to glide back into the same identity without retyping credentials.

```ts
// Background refresh failed — clear local state but let the next
// startLogin() use SSO to re-establish the same identity.
await auth.logout({ keepSso: true });
await auth.startLogin();
```

Pass `keepSso: true` *also* if your component is itself the IdP UI
(no upstream SSO above it for the marker to influence) — this is what
the `accounts.nuria.com.br` portal does internally.

### Forcing re-authentication explicitly

Set `prompt` directly on `startLogin()` to override or bypass the
marker. Explicit `prompt` always wins:

```ts
await auth.startLogin({ prompt: 'login' });          // force form
await auth.startLogin({ prompt: 'select_account' }); // force chooser
await auth.startLogin({ prompt: 'consent' });        // re-show consent
await auth.startLogin({ prompt: 'none' });           // SSO-only, error if no session
```

For OIDC space-separated combos (e.g. `"login consent"`), pass through
`extraParams.prompt` — that path also overrides both the marker and
the typed option.

### Google Identity Services interaction

Google's FedCM / One Tap can silently re-issue an `id_token` independent
of your app's session. After logout, call `disableGoogleAutoSelect()`
so GIS forgets the auto-select hint:

```ts
import { disableGoogleAutoSelect } from '@nuria-tech/auth-sdk';

await auth.logout();
disableGoogleAutoSelect();
```

The `accounts.nuria.com.br` portal does this in its own logout handler.

## Security notes

- Do not use `clientSecret` in browser/mobile apps.
- Prefer memory storage when possible.
- Keep refresh on cookies (`HttpOnly`) server-side when available.
- `logout()` clears the local session only — no server call, no redirect. Use this for in-app sign-out where the user stays in the same app. **By default it also forces re-authentication on the next `startLogin()`** — see [Logout & re-authentication](#logout--re-authentication) below. Pass `{ keepSso: true }` to preserve classic silent-SSO across logout.
- `globalLogout({ returnTo })` calls the server logout endpoint and redirects. `returnTo` must be `https://` (or `http://localhost` for dev); URLs with embedded credentials are rejected.
- `isAuthenticated()` returns `true` when the token is expired but `enableRefreshToken: true` — `getAccessToken()` will silently renew it.
- `getClaims()` decodes the JWT payload client-side via `atob()` without verifying the signature — trust comes from the server that issued the token.
- `getActor()` returns the RFC 8693 §4.1 `act` claim when the current session was minted via support impersonation (shape: `{ sub, name?, email? }`); returns `null` for regular sessions and malformed payloads. Call `mountImpersonationBanner(auth)` once in your Vue/Nuxt plugin to automatically render a fixed, non-dismissable notice bar whenever an operator session is active — see [docs/impersonation-banner.md](./docs/impersonation-banner.md).
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
  /**
   * Clears the local session only. No server call, no redirect.
   * Default arms `prompt=login` for the next startLogin(); pass
   * `{ keepSso: true }` to preserve silent SSO across logout.
   */
  logout(options?: LogoutOptions): Promise<void>;
  /** Clears the local session AND calls the server logout endpoint, then redirects. */
  globalLogout(options?: { returnTo?: string }): Promise<void>;
  /** Best-effort POST /v2/logout to revoke the current session's refresh token server-side. Does NOT clear local state. Pair with logout() for full sign-out without redirect. */
  revokeSession(): Promise<void>;
  /** Best-effort POST /v2/logout/global (Bearer) to revoke EVERY refresh token of the authenticated subject across all devices and OAuth-integrated apps. Intended for the SSO portal sign-out; per-app callers should use revokeSession(). Dev tokens (with jti) are unaffected. Does NOT clear local state. */
  revokeAllSessions(): Promise<void>;
  isAuthenticated(): boolean;
  onAuthStateChanged(handler: (session: Session | null) => void): () => void;
  getClaims(): TokenClaims | null;
  /** Returns the RFC 8693 `act` claim when the session is impersonated, else null. */
  getActor(): ActorClaim | null;
  hasRole(role: string): boolean;
  hasGroup(group: string): boolean;
  getUserinfo(): Promise<Record<string, unknown>>;
  checkSession(): Promise<boolean>;
  startLoginCodeChallenge(options: LoginCodeChallengeOptions): Promise<TwoFactorChallenge>;
  verifyLoginCode(options: VerifyLoginCodeOptions): Promise<Session>;
  loginWithGoogleCode(options: GoogleCodeLoginOptions): Promise<Session>;
  /** Direct password login against /v2/login. Portal-only — consumer SPAs should use startLogin (OAuth + PKCE). Throws FORCE_PASSWORD_RESET when server requires a password upgrade. */
  loginWithPassword(options: PasswordLoginOptions): Promise<Session>;
  /** Exchanges a scoped reset token (from a FORCE_PASSWORD_RESET error) for a full session. POST /v2/password/force-reset. */
  forceResetPassword(newPassword: string, resetToken: string): Promise<Session>;
  /** Passwordless passkey (WebAuthn) login. Drives navigator.credentials.get() then mints a session. Browser only. */
  loginWithPasskey(options?: PasskeyLoginOptions): Promise<Session>;
  /** Sends a magic-link email. POST /v2/login/magic/send. */
  sendMagicLink(options: { email: string }): Promise<void>;
  /** Exchanges the magic-link token (from the emailed URL) for a session. POST /v2/login/magic/verify. */
  loginWithMagicLink(options: { token: string }): Promise<Session>;
  resetPassword(options: { email: string }): Promise<void>;
  recoverPassword(options: { token: string; newPassword: string }): Promise<void>;
  changePassword(options: { oldPassword: string; newPassword: string }): Promise<void>;
  /** Static, synchronous — returns the resolved loginMethods from createAuthClient (defaults applied). */
  getLoginMethods(): LoginMethodsConfig;

  // ── Federated OIDC IdP login (v7) ──────────────────────────────────
  /** Lists the configured OIDC identity providers (GET /v2/login/oidc/providers). */
  listOidcProviders(): Promise<OidcProvider[]>;
  /** SP-initiated OIDC login: fetches the authorize URL and redirects. */
  startOidcLogin(options: OidcLoginOptions): Promise<void>;
  /**
   * Reads the short-lived bridge code from the callback URL query string
   * (?oidc_code=…), exchanges it at POST /v2/login/oidc/redeem, and mints a
   * session. The refresh token arrives in the __Host cookie set on the preceding
   * kernel /callback redirect; the access token is returned in the JSON body —
   * never in the URL.
   */
  handleOidcCallback(callbackUrl?: string): Promise<Session>;

  // ── Step-up authentication (RFC 8176) (v7) ─────────────────────────
  /** The session's acr/amr/auth_time, or null when unauthenticated. */
  getAssurance(): AssuranceLevel | null;
  /** True when the session already meets requiredAcr (+ optional max-age freshness). */
  satisfiesStepUp(requiredAcr?: string, maxAgeSeconds?: number): boolean;
  /** Forces a stronger/fresher re-auth via acr_values + max_age + prompt=login. */
  stepUp(options?: StepUpOptions): Promise<void>;

  // ── Device authorization verification (RFC 8628) ───────────────────
  lookupDeviceUserCode(userCode: string): Promise<DeviceUserCodeLookup>;
  approveDeviceUserCode(userCode: string): Promise<void>;
  denyDeviceUserCode(userCode: string): Promise<void>;

  /**
   * Self-service account management for the signed-in subject: 2FA (TOTP),
   * passkeys, OAuth consents, known devices, federated-identity links and
   * LGPD data rights. Bearer-authenticated against the current session.
   */
  readonly account: AccountClient;
}

interface AccountClient {
  // Profile
  updateProfile(options: UpdateProfileOptions): Promise<UpdateProfileResult>;
  // Email verification
  sendEmailVerification(): Promise<void>;
  confirmEmailVerification(token: string): Promise<void>; // no session required
  // Phone verification
  sendPhoneVerification(): Promise<PhoneVerificationChallenge>;
  confirmPhoneVerification(options: { challengeId: string; code: string }): Promise<void>;
  // Two-factor (TOTP)
  getTwoFactorStatus(): Promise<TwoFactorStatus>;
  enrollTotp(): Promise<TotpEnrollment>;
  confirmTotp(code: string): Promise<{ enabled: boolean; recoveryCodes: string[] }>;
  disableTotp(): Promise<void>;
  // Passkeys (WebAuthn / FIDO2)
  listPasskeys(): Promise<PasskeyInfo[]>;
  enrollPasskey(name?: string): Promise<void>; // begin → navigator.credentials.create() → finish
  deletePasskey(credentialId: string): Promise<void>;
  // OAuth consents
  listConsents(): Promise<ConsentInfo[]>;
  revokeConsent(clientId: string): Promise<void>;
  getConsentStatus(clientId: string, scope: string): Promise<ConsentStatusResult>;
  grantConsent(clientId: string, scope: string): Promise<void>;
  // Known devices
  listDevices(): Promise<DeviceInfo[]>;
  trustDevice(deviceKey: string): Promise<void>;
  untrustDevice(deviceKey: string): Promise<void>;
  forgetDevice(deviceKey: string): Promise<void>;
  // Federated identity links
  listIdentities(): Promise<FederatedIdentityInfo[]>;
  unlinkIdentity(provider: string): Promise<void>;
  // LGPD data-subject rights
  exportData(): Promise<DataExport>;
  eraseAccount(confirmEmail: string): Promise<void>;
}

interface LoginMethodsConfig {
  enabled: ('password' | 'google' | 'passwordless')[];
  comingSoon: ('password' | 'google' | 'passwordless')[];
}

interface LoginCodeChallengeOptions {
  email: string;
  channel?: 'email' | 'sms';
  purpose?: string;
}
```

## Magic link (passwordless)

Send a one-time link to the user's email; when they click it the token in the
link URL authenticates them directly — no password required.

```ts
// 1. User types their email and requests a link
await auth.sendMagicLink({ email: 'user@example.com' });

// 2. User clicks the link in the email — your app handles the redirect
//    and extracts ?token= from the URL
const params = new URLSearchParams(window.location.search);
const session = await auth.loginWithMagicLink({ token: params.get('token')! });
```

The magic link is single-use and short-lived (15 minutes). The token is
delivered in the link URL as `?token=<id>.<secret>` — only a hash of the
secret is stored server-side, so a database leak does not yield usable tokens.

## v7 features

All v7 additions are **non-breaking** over the v6 surface — opt in only where you need them.

### Passkeys (WebAuthn / FIDO2)

```ts
import { isPlatformAuthenticatorAvailable } from '@nuria-tech/auth-sdk';

// Enroll a passkey for the signed-in user (begin → create() → finish):
if (await isPlatformAuthenticatorAvailable()) {
  await auth.account.enrollPasskey('My Laptop');
}
const passkeys = await auth.account.listPasskeys();
await auth.account.deletePasskey(passkeys[0].credentialId);

// Passwordless login (portal): begin → get() → finish → session.
await auth.loginWithPasskey({ email: 'me@nuria.com.br' }); // omit email for usernameless
```

### Federated OIDC IdP login

```ts
const providers = await auth.listOidcProviders(); // [{ key, displayName, ... }]
// SP-initiated redirect to the IdP:
await auth.startOidcLogin({
  provider: 'azuread',
  returnUrl: 'https://accounts.nuria.com.br/sso/callback',
});
// On the returnUrl page — kernel delivers ?oidc_code=… (bridge code).
// handleOidcCallback() exchanges it at /v2/login/oidc/redeem; access token
// comes back in the JSON body. Refresh token was already set in the
// __Host-nuria_rt cookie on the preceding kernel /callback redirect.
const session = await auth.handleOidcCallback();
```

### DPoP — sender-constrained tokens (RFC 9449)

DPoP is enabled automatically in browser environments (default `dpop: "auto"`).
The SDK generates an ES256 key pair, persists it in IndexedDB, and attaches the
proof to every token request. No setup needed for most apps:

```ts
// Default — DPoP handled automatically in the browser.
const auth = createAuthClient({ clientId, redirectUri });
```

To opt out (plain Bearer tokens):

```ts
const auth = createAuthClient({ clientId, redirectUri, dpop: false });
```

Custom signer (advanced — own key storage, HSM, etc.):

```ts
import { createDpopSigner, persistDpopSigner, loadDpopSigner } from '@nuria-tech/auth-sdk';

const dpop = (await loadDpopSigner()) ?? await createDpopSigner();
await persistDpopSigner(dpop);
const auth = createAuthClient({ clientId, redirectUri, dpop });
```

### Step-up authentication (RFC 8176)

```ts
import { ACR_MULTI_FACTOR } from '@nuria-tech/auth-sdk';

// Before a sensitive action, require MFA re-authenticated within 5 minutes:
if (!auth.satisfiesStepUp(ACR_MULTI_FACTOR, 300)) {
  await auth.stepUp({ acr: ACR_MULTI_FACTOR, maxAgeSeconds: 300 });
  // → redirect; complete with handleRedirectCallback() on return
}
auth.getAssurance(); // { acr, amr: ['pwd','otp'], authTime }
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
