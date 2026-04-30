# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [4.0.1] - 2026-04-30

### Fixed — Sign-in with Google button: deterministic personalized variant

`gsi.initialize()` now passes `use_fedcm_for_button: true` alongside the
existing `use_fedcm_for_prompt: true`. Without this flag, the personalized
button variant ("Sign in as <Name>", rendered via cross-origin iframe)
relied on third-party cookies to negotiate the Google session — a path
that is unreliable on Chrome 120+ and any browser with 3PC blocked.

The legacy 3PC path could (a) silently fail to render the personalized
variant or (b) swap from the generic inline `div[role="button"]` to the
iframe variant several seconds after first paint, causing visible
layout instability in pages that styled the GIS host element via
`:deep()` selectors.

With FedCM as the canonical channel for the button, the variant
selection is deterministic across browsers and the swap (if any) is
gated by the FedCM handshake rather than ambient cookie state.

No API surface change — the flag is internal to `ensureGsiInitialized()`.

## [4.0.0] - 2026-04-30

### BREAKING — `logout()` now forces re-authentication on next sign-in

Calling `auth.logout()` used to clear local state and let the next
`auth.startLogin()` glide silently through the upstream SSO session,
which meant a user who pressed "Sair" in an app would frequently land
back inside it without any visible login step. Some browsers were even
silently re-issuing tokens via Google FedCM auto-select.

`logout()` now persists a one-shot marker that the next
`startLogin()` consumes and translates into the OIDC standard
`prompt=login` parameter on the authorize URL. The IdP renders its
login UI even when its own session is still warm, so the user always
sees and clicks through a real credential challenge.

```ts
// Default — recommended for app "Sair" buttons
await auth.logout();
await auth.startLogin(); // → ?prompt=login on the authorize URL

// Opt out — preserve classic SSO across logout. Use only when the
// app has a deliberate reason (e.g. a background refresh failure
// where the user should glide back into the same identity).
await auth.logout({ keepSso: true });
```

The marker is per-app-storage (origin-scoped on `WebStorageAdapter`).
Logging out of app A does not affect app B; each app independently
arms its own re-authentication on its next `startLogin()`. Explicit
`startLogin({ prompt: ... })` always wins over the marker;
`extraParams.prompt` overrides both.

The marker is consumed only **after the redirect dispatches** — if
`onRedirect` (or `window.location.assign` configuration) throws before
navigation succeeds, the marker stays armed so the user's retry still
goes through `prompt=login`.

`MemoryStorageAdapter` loses the marker on page reload (in-memory
only). Use `WebStorageAdapter` / `CookieStorageAdapter` for the
force-relogin guarantee to survive reload.

`LogoutOptions` is exported from the package root.

#### Migration

| Before                          | After (default)                              |
| ------------------------------- | -------------------------------------------- |
| `auth.logout()` then user clicks "Entrar" → silent SSO re-signs them in | `auth.logout()` then user clicks "Entrar" → IdP shows login UI |
| `auth.logout()` then `auth.startLogin()` → no `prompt` on URL | `auth.logout()` then `auth.startLogin()` → `prompt=login` on URL |

If your app *intentionally* depended on the old silent-SSO-after-logout
behavior, switch the call to `auth.logout({ keepSso: true })`.

The `accounts.nuria.com.br` portal opted out of the marker because it
is itself the IdP — there is no upstream SSO above it for the marker
to influence.

### Added — Typed `prompt` option on `startLogin()`

`StartLoginOptions.prompt` accepts the OIDC values
`'none' | 'login' | 'consent' | 'select_account'` directly. Equivalent
to passing it through `extraParams.prompt` (which still works and can
override, useful for OIDC space-separated combos like
`"login consent"`).

### Added — Server-side OIDC `prompt` plumbing

`buildOAuthAuthorizeUrl` forwards `prompt` to the kernel's
`/v2/oauth/authorize`, and the kernel forwards it onward to
`accounts/signin` when no SSO session is present. The accounts portal
honors `prompt=login` and `prompt=select_account` by rendering the
login form even with an active session.

### Added — `disableGoogleAutoSelect()` integrated into accounts logout

The accounts portal now calls `disableGoogleAutoSelect()` from its
"Sair" handler so Google Identity Services / FedCM cannot silently
re-issue a credential on the next `/signin` visit. Apps embedding the
SDK can do the same in their own logout flow if they render the GIS
button.

## [3.2.0] - 2026-04-30

### Added — `AuthError.details` carries the server error body

`FetchAuthTransport` now parses non-OK responses and attaches the body
to the thrown `AuthError` as `details: AuthErrorDetails`. Consuming apps
no longer have to choose between using the SDK and reading
`errorCode`/`errorDescription`/`traceId` from the `/v2/*` envelope —
both are available on the same exception.

```ts
try {
  await client.loginWithGoogle({ idToken });
} catch (e) {
  if (e instanceof AuthError) {
    e.details.status;            // 404
    e.details.errorCode;         // "resource_not_found"
    e.details.errorDescription;  // server-provided message
    e.details.traceId;           // for support / log correlation
  }
}
```

`AuthErrorDetails` is exported from the package root. The shape
mirrors the v2 contract (`error`, `errorCode`, `errorDescription`,
`traceId`, `feature`) plus `status` and the raw `body` for callers
that need the full payload. Legacy `/api/v1/*` responses populate
whichever of those fields the server happens to send.

`AuthError`'s constructor gained a 4th optional argument
(`details: AuthErrorDetails = {}`) — fully backwards-compatible with
existing call sites that pass `(code, message)` or
`(code, message, cause)`. The `details` field is always present
(empty object when not set) so consumers can skip null checks.

The `HTTP_ERROR` message format changed from `HTTP <status>` to
`HTTP <status> (<errorCode>)` when an `errorCode` is available — old
callers that only inspect `error.code === HTTP_ERROR` are unaffected.

## [3.1.0] - 2026-04-30

### Added — Device authorization grant (RFC 8628) verification helpers

The kernel now supports the OAuth Device Authorization Grant for
headless devices (TVs, IoT, SSH terminals, CI runners). Polling on the
device side belongs to the device's own runtime — out of scope for a
browser SDK — but the **verification page** the user opens to approve
the flow runs in the browser. Three new methods on `AuthClient` cover
that surface so consuming SPAs (notably `accounts.nuria.com.br/device`)
don't have to wire raw fetch calls:

- `lookupDeviceUserCode(userCode)` → `Promise<DeviceUserCodeLookup>`
  (`{ userCode, clientId, clientName, scope, expiresAt }`). Calls
  `GET /v2/oauth/device?user_code=` and returns the metadata needed to
  render "you are about to authorize &lt;client&gt;" before the user
  confirms. Throws on unknown / expired / non-pending codes
  (anti-enumeration — collapsed by design).
- `approveDeviceUserCode(userCode)` → calls
  `POST /v2/oauth/device/approve` with `Authorization: Bearer <session>`.
  Binds the caller's subject onto the device-flow row; the next poll
  on the device's `/v2/oauth/token` will succeed with access + refresh
  tokens.
- `denyDeviceUserCode(userCode)` → calls
  `POST /v2/oauth/device/deny`. Idempotent for already-denied codes.
  Bearer-required (otherwise anyone could DOS another user's device flow).

Both approve and deny use `getAccessToken()` internally, so silent
refresh handles short-lived access tokens transparently. Calls without
a session throw `AuthError(UNAUTHENTICATED)`.

### Changed

- `AuthErrorCode` gained `UNAUTHENTICATED` for the new approve/deny
  helpers (the existing `INVALID_CONFIG` was the wrong shape — it
  signals misconfiguration, not a missing session).

### Removed

- **Server-side launch links are gone.** The kernel removed
  `POST /v2/oauth/launch-link` + `/exchange` and the
  `OAuthLaunchState` DDB table. The use case those endpoints served
  (backends emailing a deep link that drops the user logged in at a
  client app) is better covered by the standard authorization code
  flow with the loopback or device grant — both fully OAuth 2.1
  compliant. No SDK code referenced those endpoints, but the
  `AGENTS.md` "Server-side launch links" section is replaced with the
  new "Native and headless flows (RFC 8252 + RFC 8628)" section.

### Native CLI / desktop apps (RFC 8252)

The kernel now permits loopback redirect URIs for the standard
`/v2/oauth/authorize` + `/v2/oauth/token` flow: register
`http://127.0.0.1/<path>` once on the OAuth client and any port the
native app picks at request time matches. Path and query still have to
be exact. `localhost` is intentionally **not** treated as loopback
(RFC 8252 §8.3). The SDK does not ship a CLI runtime — but the same
endpoints + PKCE rules apply, so a native app can reuse the SDK's
`createCodeChallenge` + `randomString` primitives if it bundles them.

### Migration

If you weren't using the launch-link endpoints, nothing changes for
you. If you were:

- Single-flight, browser-based deep links (Nuria Portal-style): the
  user clicks a link in an email and lands logged in. The standard
  `/v2/oauth/authorize` PKCE flow (the one `auth.startLogin()` already
  uses) does this without the launch-link hop. The accounts SSO cookie
  carries the existing session into the authorize page.
- Native CLI launching login via email: switch to the loopback redirect
  flow above. Polling on `/v2/oauth/device` is also an option if the
  CLI cannot bind a port.

## [3.0.4] - 2026-04-29

### Changed

- **`extractRoles()` no longer reads the OAuth `scope` / `scopes` claims.**
  Scopes are a distinct concept from roles in the Nuria token model
  (`profile:write`, `nuria:developer`, `myconnect:read` are scopes; roles
  like `cmauth:list_users` come from the SubjectSession in DDB and the
  /v2/verify response). The previous behaviour caused scope strings to
  leak into role-gated UI checks. Consumers that want the scope list now
  call the new `extractScopes()` helper.

### Added

- `extractScopes(...sources)` — deduplicated list of OAuth scopes pulled
  from the standard `scope` claim (RFC 6749 §3.3, space-separated) and
  the array-form `scopes` alias used by the /v2/verify response.
- `TokenClaims` gained typed fields for the JWT additions stamped by the
  kernel (`iss`, `aud`, `sub`, `jti`) and the Nuria-specific claims that
  were previously only reachable via the index signature (`subject_type`,
  `subject_phone`, `subject_guid`, `company_origin`, `scope`). Existing
  consumers keep working — these are additive optional fields with the
  same names the kernel emits.

### Migration

If any downstream code was relying on `extractRoles()` returning the
contents of the `scope` claim, switch that call to `extractScopes()`.
The shape (deduplicated `string[]`) is identical; only the input claims
change.

## [3.0.3] - 2026-04-29

### Changed

- `renderGoogleSignInButton()` / `promptGoogleOneTap()` are now idempotent
  for the same client_id within a single page lifecycle. The Google
  Identity Services nonce is minted once per page load, stored in
  `sessionStorage`, and reused across re-renders. This suppresses the
  `[GSI_LOGGER]: google.accounts.id.initialize() is called multiple times`
  warning that fired when callers re-rendered the button (theme switches,
  responsive resize, HMR remounts) — `gsi.initialize()` is now invoked
  exactly once and a single internal delegate routes credentials to the
  most recently registered `onCredential` callback. Nonce freshness is
  preserved across page loads (every reload mints a new nonce); replay
  defense is unchanged because the kernel still validates the JWT
  `nonce` claim against the stored value.
- `disableGoogleAutoSelect()` now also resets the in-memory init state so
  the next login mints a fresh nonce and re-binds GIS callbacks.

## [3.0.1] - 2026-04-29

### Changed

- `startLoginCodeChallenge()` / `loginWithCodeSent()` no longer serialize
  `destination` in the `/v2/login-code/challenge` request body. The backend
  resolves the destination from the stored user profile and already ignored
  client-supplied values.
- `LoginCodeChallengeOptions.destination` is now marked `@deprecated` for
  source compatibility while consumers migrate away from passing it.

## [3.0.0] - 2026-04-29

### Breaking — Google + AWS SSO migrated to OAuth 2.1 compliant flows

The Implicit grant (`response_type=id_token`) used for Google and
AWS IAM Identity Center is forbidden by OAuth 2.1 (RFC 9700 / Browser-Based
Apps BCP). Both providers now follow flows that the spec explicitly
endorses:

- **Google → Google Identity Services (GIS / FedCM).** The browser no
  longer redirects to `accounts.google.com/o/oauth2/v2/auth?response_type=id_token`.
  The SDK loads `accounts.google.com/gsi/client`, renders the official
  Sign in with Google button, and surfaces the id_token through a JS callback.
  No more URL fragment handoff, no more `pendingIdToken` shuffle through
  `sessionStorage`.
- **AWS IAM Identity Center → Authorization Code + PKCE.** The browser
  receives a `code` in the query string, exchanges it at the issuer's
  `/token` endpoint with the stored `code_verifier`, and validates the
  `nonce` claim before returning the id_token. AWS supports PKCE-only
  public clients, so no `client_secret` is ever in play.

Backend (`/v2/google`, `/v2/sso/aws`) is unchanged — both endpoints still
take `{ idToken }` and validate it the same way. Only the *client-side
acquisition* of the id_token changes.

#### Removed (Google)

- `startGoogleLogin(...)` — the implicit redirect entry point.
- `parseGoogleHashCallback(hash)` — the URL-fragment parser.
- `consumePendingGoogleIdToken()` — the cross-page handoff.
- `StartGoogleLoginOptions` type.
- `GOOGLE_STORAGE_KEYS.state` / `.returnSearch` / `.pendingIdToken` keys
  (only `nonce` survives).

#### Added (Google)

- `renderGoogleSignInButton({ clientId, element, onCredential, onError, ... })`
  — loads GIS, mints a nonce, renders the official button into the DOM
  element, and validates the `nonce` claim of the returned id_token with
  `timingSafeEqual` before invoking `onCredential`.
- `promptGoogleOneTap({ clientId, onCredential, onError })` — triggers
  the FedCM/One Tap UI without a button.
- `cancelGooglePrompt()` — cancels an in-flight prompt.
- `disableGoogleAutoSelect()` — call on logout to prevent silent
  re-sign-in.
- `GoogleCredentialResponse`, `RenderGoogleSignInButtonOptions`,
  `PromptGoogleOneTapOptions` types.

#### Removed (AWS)

- `parseAwsHashCallback(hash)` — synchronous URL-fragment parser.
- `consumePendingAwsIdToken()` — the cross-page handoff.
- `AWS_STORAGE_KEYS.nonce` / `.state` / `.returnSearch` / `.pendingIdToken`
  (replaced by a single per-state PKCE bag).

#### Added (AWS)

- `parseAwsQueryCallback(search)` — async. Parses `?code&state`,
  exchanges the code at the bag's `tokenEndpoint`, validates the nonce in
  the returned id_token, returns `{ idToken, returnSearch }` or `null` if
  no code is present. Throws `AuthError` for explicit failure modes
  (`MISSING_STATE`, `STATE_MISMATCH`, `TOKEN_EXCHANGE_FAILED`,
  `CALLBACK_ERROR`).
- `tokenEndpoint` option on `StartAwsLoginOptions` (defaults to
  `${issuerUrl}/token`).
- `AwsCallbackResult` type.

#### Behaviour changes (AWS, internal)

- `startAwsLogin` is now `async` (computes the S256 challenge via
  `crypto.subtle.digest`).
- PKCE bag is keyed by `state` (`nuria:aws:pkce:<state>`), so concurrent
  tabs no longer clobber each other.
- State validation is **strict**: a bag missing for the returned `state`
  is treated as replay, not "soft" backwards compatibility.
- Nonce validation uses `timingSafeEqual` against the id_token claim.

### Migration

Most apps will only touch their sign-in page:

```diff
- import { startGoogleLogin, consumePendingGoogleIdToken } from '@nuria-tech/auth-sdk';
+ import { renderGoogleSignInButton } from '@nuria-tech/auth-sdk';

- <button @click="startGoogleLogin({ clientId, redirectUri })">Sign in with Google</button>
+ <div ref="googleHost"></div>
+ onMounted(() => renderGoogleSignInButton({
+   clientId,
+   element: googleHost.value,
+   onCredential: ({ idToken }) => $auth.loginWithGoogle({ idToken }),
+ }));
```

The middleware that intercepted Google's hash callback (`#id_token=...`)
can be deleted entirely — GIS never puts the id_token in the URL.

For AWS IAM Identity Center:

```diff
- const result = parseAwsHashCallback(window.location.hash);
- if (result) await $auth.loginWithAws({ idToken: result.idToken });
+ const result = await parseAwsQueryCallback(window.location.search);
+ if (result) await $auth.loginWithAws({ idToken: result.idToken });
```

### Security

- Closes the audit findings flagged on 2.0.10: implicit-flow id_token
  no longer crosses `sessionStorage`; state validation in both flows is
  now strict and uses constant-time comparison; multi-tab PKCE bags
  isolated by state prevent cross-tab clobber.
- Google Identity Services (GIS) / FedCM is the path Google has officially recommended for SPAs since
  the implicit-flow deprecation.

## [2.0.10] - 2026-04-29

> Docs-only release. No runtime change vs. 2.0.9 — published to keep the
> npm version aligned with the AGENTS.md / README updates and the
> kernel-side launch-link feature documented in this window.

### Documentation

- **OAuth 2.1 posture stated explicitly.** Top of `README.md` and
  `AGENTS.md` now call out that the SDK targets OAuth 2.1: PKCE
  mandatory on every flow, no `client_secret` pathway,
  `code_challenge_method=S256` hardcoded. `package.json` description
  updated to match. No behavioural change — the SDK has always enforced
  these — the docs just stop calling it "OAuth 2.0" loosely.
- **Server-side launch links documented** in `AGENTS.md`. The kernel
  gained `POST /v2/oauth/launch-link` (+ `/exchange`) for backends that
  need to mint authorize URLs without a browser session. The SDK is
  browser-only and doesn't ship a client for these endpoints, but
  consumers will inevitably ask "how do I mint URLs from my server?" —
  the docs now answer it (with a pointer to the kernel's
  `CONTRACT_V2.md`) instead of letting the question loop back as a
  feature request.
- **`README.md` Public API section** now lists `revokeSession()` and
  `revokeAllSessions()`. Both shipped in 2.0.7 / 2.0.9 and were
  documented in `AGENTS.md` and the changelog, but missed the
  README's `interface AuthClient` block.

## [2.0.9] - 2026-04-29

> 2.0.8 was tagged but not published — CI lint broke on a long ternary
> in the new method. 2.0.9 ships the same change with the formatting
> fix.

### Added

- **`AuthClient.revokeAllSessions()`** — best-effort
  `POST /v2/logout/global` (Bearer required) that revokes **every** refresh
  token belonging to the authenticated subject server-side. Intended for
  the SSO portal (accounts.nuria.com.br): when a user signs out at the
  account center, every device, browser tab, and OAuth-integrated app the
  subject ever logged into loses the ability to renew. Per-app
  integrations should keep using `revokeSession()` for local-only
  sign-out.

  Same best-effort posture as `revokeSession`: does not clear the local
  session (caller pairs with `logout()`), and 4xx / network errors are
  swallowed so the caller's local cleanup always proceeds.

  Dev tokens (`/v2/auth/dev-token`, carry a `jti`) are intentionally NOT
  affected — the kernel keeps them on a separate revocation trail and
  `EvaluateAccess` bypasses the session kill-switch for JTI-bearing
  tokens. Developers signing out of the SSO portal don't lose their
  long-lived testing credential.

  Requires backend with `POST /v2/logout/global` deployed (added in the
  same release window). Calls against older deploys 404 silently — same
  no-op end state as a successful revoke.

## [2.0.7] - 2026-04-28

### Added

- **`AuthClient.revokeSession()`** — best-effort `POST /v2/logout` with the
  current session's refresh token. Server-side only; does not clear the
  local session, so callers can sequence `revokeSession()` →
  `logout()` without losing the refresh token mid-flight. Network and
  4xx errors are swallowed (already-revoked, unknown token, transient
  failure) so the caller's local cleanup always proceeds. Replaces the
  reimplementation each consumer was carrying inline.

### Changed

- `TokenClaims` now declares `avatar_url?: string` explicitly. The Nuria
  backend emits the claim only for Google logins (with the real picture);
  password / AWS SSO logins omit it so consumers can fall back to
  initials. `picture` (standard OIDC) is still recognized by
  `extractAvatarUrl` as a secondary source.

## [2.0.6] - 2026-04-28

### Changed

- **`DEFAULT_AUTH_BASE_URL` flipped to `https://auth.nuria.com.br`.** The
  v2 backend now lives at `auth.nuria.com.br` (shorter, no version suffix).
  `ms-auth-v2.nuria.com.br` continues to work as a legacy alias from the
  same stack — set `baseUrl` explicitly if you need to keep using it.
  `ms-auth.nuria.com.br` still points to the (legacy) v1 backend, so
  consumers relying on the previous default were always hitting v1 by
  accident.

## [2.0.5] - 2026-04-28

> Consolida o trabalho que estava previsto para 2.0.5 e 2.0.6 (nenhuma das
> duas chegou a ser publicada). AWS SSO, login-methods config, hardening
> diversos, e a virada do `DEFAULT_AUTH_BASE_URL` saem juntos nesta release.

### Added

- **AWS IAM Identity Center (AWS SSO) federated login** in the same shape as
  the existing Google flow. Targets a *customer-managed application* registered
  in your IAM Identity Center instance.
  - `startAwsLogin(options)` — generates `nonce` + `state`, persists them and
    `returnSearch` to `sessionStorage`, then redirects to the IAM Identity
    Center authorization endpoint with `response_type=id_token`. The endpoint
    is derived from `issuerUrl` (`${issuerUrl}/authorize`) or taken verbatim
    from `authorizationEndpoint` when the discovery document advertises a
    non-standard path.
  - `parseAwsHashCallback(hash)` — extracts `id_token` from the URL hash and
    validates the `state` round-trip before consuming it. Stores the token as
    `pendingIdToken` and clears `nonce`/`state`/`returnSearch`.
  - `consumePendingAwsIdToken()` — reads and removes the pending IAM Identity
    Center id token from `sessionStorage`.
  - `AWS_STORAGE_KEYS` — constant storage key names used by the AWS utilities.
  - `AuthClient.loginWithAws({ idToken })` — exchanges the id token for a
    Nuria `Session` via `POST /v2/sso/aws`. The kernel validates the token
    against the IAM Identity Center JWKS (issuer + audience pulled from
    Secrets Manager) and only signs in users that are already provisioned
    and active — no auto-create. Browser/SSO mode also rotates the
    `__Host-nuria_rt` cookie, mirroring `/v2/google`.
  - New `AwsLoginOptions` type + `StartAwsLoginOptions` exported from the main
    entrypoint.
- **Login-methods config in `createAuthClient`.** New `AuthConfig.loginMethods`
  option `{ enabled, comingSoon }` (subset of `'password' | 'google' |
  'passwordless' | 'aws_sso'`) tells login UIs which buttons to render and
  which to advertise as "Em breve". Read back synchronously with the new
  `AuthClient.getLoginMethods()` — no network call. Static config replaces
  any per-OAuth-client backend lookup; everything an integrating app needs
  lives in its own `createAuthClient` call.
  - Defaults exported as `DEFAULT_LOGIN_METHODS`: `enabled: ['password',
    'google']`, `comingSoon: ['passwordless', 'aws_sso']` — matches the
    legacy Nuria signin page behaviour.
  - Either field can be omitted to fall back to its default; unknown method
    values are silently dropped; methods listed in `enabled` are stripped
    from `comingSoon` to prevent UIs from rendering a duplicate "Em breve"
    badge next to a working button.
  - `LoginMethod`, `LoginMethodsConfig`, and `LoginMethodsConfigInput` types
    exported from the main entrypoint.
  - `startLogin()` now serializes the resolved `loginMethods` into
    `?login_methods_enabled=` / `?login_methods_coming_soon=` (CSV) on the
    redirect URL. The Nuria backend forwards these to accounts/signin so
    the central login UI renders the right buttons for the calling app —
    no per-client backend lookup required for the 99% case where apps
    redirect to accounts. `extraParams` cannot override these reserved
    keys. UI-hint only; the kernel remains the auth gate.

### Changed

- **`DEFAULT_AUTH_BASE_URL` flipped to `https://ms-auth.nuria.com.br`.** The
  legacy `ms-auth-v2.nuria.com.br` host stays live as a CNAME alias on the
  same API Gateway, so apps that pin `baseUrl` in `createAuthClient` keep
  working unchanged. Apps that rely on the SDK default will start hitting
  the new canonical host as soon as they upgrade.

### Fixed

- **`config.logoutEndpoint` is now validated up-front** with the same rule
  applied to `redirectUri` / `baseUrl` (https-only, except http on localhost).
  Without this, an attacker who could influence config (or a typo) could
  point `globalLogout()`'s redirect at any URL — including
  `javascript:`-style payloads — turning sign-out into an open-redirect.
  `createAuthClient` now throws `INVALID_CONFIG` for malformed, http-non-
  localhost, or non-URL `logoutEndpoint` values.
- **`onAuthStateChanged` listeners are isolated from each other.** A listener
  that threw used to abort `notify()` mid-fan-out, skipping every subsequent
  subscriber and the cross-tab `BroadcastChannel.postMessage` call. One buggy
  React component could silently freeze the rest of the app's auth state.
  Each listener now runs inside a try/catch; throws are reported via
  `console.error` and the rest of the fan-out continues.
- **`startGoogleLogin` now emits a CSRF state parameter** alongside the
  existing nonce, persisted to `sessionStorage` under
  `nuria:google:state`. `parseGoogleHashCallback` validates it against the
  hash on return. Validation is deliberately **soft** — only rejects when
  both the URL hash and `sessionStorage` carry a state value AND they
  disagree. If either side is missing the check is skipped. Two real-world
  scenarios drove the soft mode:
  - **Mid-flight upgrades.** A user starts login on an older build (no
    state stored) and lands on the callback after a deploy of the new SDK.
    Strict validation would silently fail every login in transit.
  - **Storage-wipe.** Privacy-mode browsers, extension cleanups, and
    Strict-Mode-style double parses can drop `state` from `sessionStorage`
    while leaving the URL fragment intact. Strict mode would reject the
    second pass; soft mode accepts because storage is empty on that side.
  Defense-in-depth is preserved: the kernel still verifies the id_token's
  signature/audience server-side via Google's JWKS, which is the actual
  security boundary. The state check is purely client-side hardening, on
  par with what `startAwsLogin` already does.
- **React `AuthProvider` no longer triggers re-render storms.** The context
  `value` is now memoized with `useMemo`, and `login` / `logout` /
  `globalLogout` are wrapped in `useCallback`. Consumer effects that depend on
  these callbacks no longer re-run on every render — this was the root cause
  of the "infinite loop on login problem" report when paired with a
  non-navigating `onRedirect` callback.
- **React `useAuth().login(...)` accepts `StartLoginOptions`.** The wrapper
  silently dropped `loginHint`, `scopes`, and `extraParams`; it now forwards
  them to `auth.startLogin`.
- **Angular `createAngularAuthFacade(...)` `login(...)` accepts
  `StartLoginOptions`** for parity with the React facade.
- **`useAuthSession` (React + Vue) clears `error`** on a successful hydrate so
  a stale error doesn't survive a recovery refresh.
- **`getAccessToken()` notifies subscribers** when it clears the session
  because of a refresh failure (or because refresh is disabled and the token
  expired). Other components and the cross-tab `BroadcastChannel` now stay in
  sync. Previously only the 401 path notified, via the auto-logout interceptor.
- **Removed the global 401 → auto-logout transport interceptor.** It was
  redundant for refresh failures (already handled inside `getAccessToken()`)
  and harmful for every other authenticated endpoint the SDK calls. With it
  in place, `auth.changePassword({ oldPassword: '<wrong>', ... })` would log
  the user out of their active session because the kernel maps
  `InvalidCredentials` to 401 — the user only typed the old password wrong,
  but the SDK responded by wiping the session. Same problem with a transient
  `getUserinfo`/`checkSession` 401: the next `getAccessToken()` would silently
  refresh and recover, but the interceptor pre-empted that by logging out.
  The refresh-failure path inside `getAccessToken()` still handles its own
  cleanup; callers handle 401s on app-level requests.
- **`handleRedirectCallback` clears PKCE artifacts on early-throw paths.**
  When the OAuth provider returned an error (`?error=access_denied`), or the
  callback was missing `code`/`state`, or the state failed validation, the
  method threw without touching `nuria:oauth:state` /
  `nuria:oauth:code_verifier` / `nuria:oauth:nonce`. Storage stayed primed
  with stale PKCE state until the next `startLogin()` overwrote it. The
  cleanup now runs on every error path; only `exchangeCode` was correctly
  cleaning up before.

### Tests

- 34 new unit tests covering AWS SSO helpers, `loginWithAws`, the
  `getLoginMethods` resolver and CSV serialization on `startLogin`,
  `logoutEndpoint` validation, listener isolation in `notify`, the Google
  state CSRF parameter, the 401-with-no-session guard, the React `login`
  option pass-through, and the React stable-reference invariant for
  `useAuth()` callbacks.

---

## [2.0.4] - 2026-04-23

### Added

- `extractAvatarUrl(...sources)` — extracts the user avatar URL from JWT claims or verify-context objects. Accepts the field variants `avatar_url`, `avatarUrl`, `picture`, and `photo`. Returns an empty string when absent. Exported from the main entrypoint.
- `extractDisplayName(...sources)` — extracts the user's display name from JWT claims or verify-context objects. Falls back across `subject_name`, `subjectName`, `given_name`, `name`, and finally the local part of the email. Exported from the main entrypoint.
- `getInitials(name, max=2)` — pure helper that returns up to `max` uppercase initials for a name (`"Lucas Passos"` → `"LP"`, `"Lucas"` → `"L"`). Useful as an avatar fallback when the remote image fails to load.

### Tests

- 21 new unit tests covering the new claim extractors and `getInitials` edge cases.

### Maintenance

- Bumped transitive dev dependencies flagged by `pnpm audit`:
  `defu >= 6.1.5` (prototype pollution), `vite >= 7.3.2` (fs.deny bypass +
  path traversal + ws arbitrary read), `unhead >= 2.1.13`
  (hasDangerousProtocol bypass), `next >= 16.2.3` (Server Components DoS).
  All transitive via dev-only chains; runtime package unaffected.
- Fixed a lint error in `extractDisplayName` (prettier wrap).

---

## [2.0.1] - 2026-04-02

### Changed

- Production package build is now minified for all public runtime entrypoints.
- Added packaging verification in CI to assert published entrypoints are emitted, minified, and packed without `src/`, `tests/`, or coverage artifacts.
- Aligned repository package metadata for the `2.x` line by updating the npm lockfile version from the stale `1.2.1` value.

---

## [2.0.0] - 2026-04-01

### Breaking Changes

- **`logout()` no longer accepts options or calls the server.** It now only clears the local session (storage + in-memory state) and notifies `onAuthStateChanged` listeners. No network call is made. No redirect happens.
- **`globalLogout(options?)` is the new method for full sign-out.** It calls `logout()` first, then calls the `logoutEndpoint` (if configured) and redirects. `returnTo` validation rules are unchanged (https-only, localhost exception).

  Migration guide:

  ```ts
  // Before (v1.x)
  await auth.logout({ returnTo: 'https://app.example.com' }); // called server + redirect

  // After (v2.0.0)
  await auth.logout();                                          // local only
  await auth.globalLogout({ returnTo: 'https://app.example.com' }); // server + redirect
  ```

### Added

- `globalLogout(options?: { returnTo?: string }): Promise<void>` — clears the local session and calls the configured `logoutEndpoint`, then redirects. Accepts the same `returnTo` validation as the old `logout()`.
- `extractRoles(...sources)` — extracts role strings from JWT claims or verify-context objects; handles comma-separated strings, arrays, and MS WS-Federation schema variants. Exported from the main entrypoint.
- `extractCompanyOrigin(...sources)` — extracts the company origin ID string from JWT claims or verify-context objects. Returns `string` (empty string when absent). Exported from the main entrypoint.
- `buildOAuthAuthorizeUrl(params)` — builds a `/v2/oauth/authorize` URL with a `session_token` parameter for IdP-side redirect flows. Exported from the main entrypoint.
- Google OAuth utilities exported from the main entrypoint:
  - `startGoogleLogin(options)` — generates a nonce, persists it to `sessionStorage`, and redirects to Google's OAuth endpoint.
  - `parseGoogleHashCallback(hash)` — extracts `id_token` from a URL hash fragment and stores it as `pendingIdToken` in `sessionStorage`.
  - `consumePendingGoogleIdToken()` — reads and removes the pending Google ID token from `sessionStorage`.
  - `GOOGLE_STORAGE_KEYS` — constant storage key names used by the Google utilities.

### Deprecated

- **`loginWithPassword()`** — use `startLoginCodeChallenge()` + `verifyLoginCode()` (or their aliases `loginWithCodeSent()` / `completeLoginWithCode()`) instead. The method remains functional but is marked `@deprecated` and will be removed in a future major version.

### Changed

- Angular facade (`createAngularAuthFacade`): `logout()` delegates to local-only `auth.logout()`; new `globalLogout(options?)` delegates to `auth.globalLogout(options)`.
- React facade (`AuthProvider` / `useAuth`): same split — `logout()` is local only; `globalLogout(options?)` calls the server.

---

## [1.2.1] - 2026-04-01

### Fixed

- Package publishing no longer includes `.map` source map files in the npm tarball.

### Changed

- Patch release created to replace the broken `1.2.0` package contents. npm does not allow republishing an existing version, so this fix ships as `1.2.1`.

---

## [1.2.0] - 2026-04-01

### Added

- `checkSession()` — validates the current session against the server via `userinfoEndpoint`. Clears the local session and notifies `onAuthStateChanged` listeners if the server rejects the token. Falls back to `isAuthenticated()` when `userinfoEndpoint` is not configured. Useful for detecting server-side revocation or deactivated users without waiting for a 401 on a regular API call.

### Fixed

- **Nonce validation bypass**: when `storedNonce` was present but neither the access token nor the ID token contained a nonce claim, the validation was silently skipped. It now throws `TOKEN_EXCHANGE_FAILED` if the nonce is missing from the server response, preventing potential token replay attacks.

---

## [1.1.1] - 2026-03-18

### Security

- **PKCE modulo bias eliminated** — `randomString()` now uses rejection sampling (threshold = `256 − 256 % 66 = 204`) so all 66 characters in the alphabet are selected with equal probability. The previous modulo approach produced a measurable, though low-impact, statistical bias.
- **Timing-safe state validation** — `handleRedirectCallback()` and `exchangeCode()` now compare OAuth `state` and `nonce` values with `timingSafeEqual()`, a constant-time XOR comparison, preventing timing side-channel attacks.
- **Concurrent refresh deduplicated** — simultaneous `getAccessToken()` calls when the token is expired now share a single in-flight refresh request via `refreshPromise`. Previously, two concurrent callers could both trigger independent refresh requests, leading to a race condition.

## [1.1.0] - 2026-03-18

### Added

- `init()` — hydrates session from storage and notifies listeners; use with `APP_INITIALIZER` / `provideAppInitializer` to avoid re-login on page reload
- `getClaims()` — decodes the JWT access token payload via native `atob()`, no external dependency; returns `TokenClaims | null`
- `hasRole(role)` — checks the `roles` claim; supports comma-separated string and array
- `hasGroup(group)` — checks the `groups` claim; supports comma-separated string and array
- `TokenClaims` interface: standard OIDC claims + `roles`, `groups`, `auth_provider`, index signature
- `TokenSet.authProvider` — extracted from `auth_provider` or `authProvider` in the token response
- `Session.provider` — persisted from `tokens.authProvider`; preserved across silent refresh
- `userinfoEndpoint` now has a default (`${baseUrl}/v2/oauth/userinfo`); no longer throws when omitted
- Cross-tab sync via `BroadcastChannel('nuria:auth:sync')` — login/logout in one tab automatically updates all other open tabs; `init()` does not broadcast (local hydration only)
- Angular entrypoint: `createBearerInterceptor(auth)` — returns an `HttpInterceptorFn` that attaches `Authorization: Bearer <token>` and triggers silent refresh if needed
- `@angular/common >= 16` added as optional peer dependency (required for `HttpInterceptorFn` types)
- CI: pnpm upgraded from v9 to v10 to match local development environment

### Fixed

- `isAuthenticated()` now returns `true` when the access token is expired but `enableRefreshToken: true`, because `getAccessToken()` will silently renew it. Previously it returned `false`, causing guards to redirect to login unnecessarily.

### Changed

- `ResolvedAuthConfig.userinfoEndpoint` is now `string` (required) — always resolved with a default, no longer `string | undefined`

## [1.0.7] - 2026-03-18

### Added

- `resetPassword({ email })` — calls `POST /v2/password/reset`; does not require authentication
- `recoverPassword({ token, newPassword })` — calls `POST /v2/password/recover` with the reset token as `Authorization: Bearer`
- `changePassword({ oldPassword, newPassword })` — calls `PATCH /v2/me/password`; requires an active session
- Unit tests for `resetPassword`, `recoverPassword`, and `changePassword` in `create-client.spec.ts`
- Updated React and Angular test mocks to include the new password management methods

### Fixed

- `doRefresh()` no longer throws when `refreshToken` is absent from the session; it omits the `refresh_token` parameter from the body so that cookie-based (HttpOnly) refresh flows continue to work
- `getAccessToken()` now proactively refreshes 30 seconds before expiry instead of after
- `getAccessToken()` catches refresh errors, clears the stale session, and returns `null` instead of propagating the error to the caller

## [1.0.6] - 2026-03-10

### Changed

- Updated `pnpm-lock.yaml` to include complete dependency trees for framework peer deps (`@angular/core`, `next`, `nuxt`)

## [1.0.5] - 2026-03-10

### Fixed

- Wrapped global `fetch` in an arrow function inside `FetchAuthTransport` to prevent "Illegal invocation" errors in environments where `fetch` is detached from the global context

### Changed

- Updated installation instructions to use `--legacy-peer-deps` for environments where peer dep resolution requires it
- Declared `@angular/core`, `next`, and `nuxt` as optional peer dependencies

## [1.0.4] - 2026-03-06

### Security

- Hardened `logout({ returnTo })` validation:
  - Allows `https://` URLs by default.
  - Allows `http://` only for local development hosts (`localhost`, `127.0.0.1`, `[::1]`).
  - Rejects URLs containing embedded credentials.
- `isAuthenticated()` now considers token expiry (`expiresAt`) when present.
- Browser cookie storage now safely encodes/decodes values and escapes cookie key matching.

### Fixed

- OAuth callback flow now removes stored `state` only after successful token exchange, improving retry behavior on transient exchange failures.
- Added regression tests for:
  - expired session auth-state behavior,
  - `returnTo` protocol/host restrictions,
  - callback failure retry safety,
  - cookie special-character value handling.

## [1.0.3] - 2026-03-05

### Fixed

- Type-level and test compatibility after `AuthClient` expansion:
  - Updated React/Angular test mocks to include new auth methods.
  - Added Node test typing support (`@types/node`, tsconfig `types`) for e2e tests.
  - Fixed React provider test typing for required `children`.
- Build/test reliability updates for expanded test matrix.

## [1.0.2] - 2026-03-05

### Added

- New login methods in `AuthClient`:
  - `startLoginCodeChallenge(options)`
  - `verifyLoginCode(options)`
  - `loginWithCodeSent(options)` (alias)
  - `completeLoginWithCode(options)` (alias)
  - `loginWithGoogle(options)`
  - `loginWithPassword(options)`
- Auth flow matrix/documentation updates for Google, password, and code-sent flows.

### Changed

- Token normalization now accepts backend envelope variants (`Token`, `RefreshToken`, `ExpiresAt`) in addition to OAuth-style fields.

## [1.0.1] - 2026-03-04

### Added

- Framework entrypoints:
  - `@nuria-tech/auth-sdk/react` (`useAuthSession`, `AuthProvider`, `useAuth`)
  - `@nuria-tech/auth-sdk/vue` (`useAuthSession`)
  - `@nuria-tech/auth-sdk/nuxt` (Nuxt cookie adapter helpers)
  - `@nuria-tech/auth-sdk/next` (Next cookie adapter helpers)
  - `@nuria-tech/auth-sdk/angular` (RxJS facade via `createAngularAuthFacade`)
- Initial framework entrypoint tests and examples structure.

### Changed

- Package exports map expanded to include framework-specific bundles/types.

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
- Package published to npm.org (`https://registry.npmjs.org`) with Trusted Publishing (OIDC) - no long-lived tokens
- Minimum Node.js version raised to 20 (Node 18 reached EOL April 2025)
