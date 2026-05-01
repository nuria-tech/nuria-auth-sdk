import { AuthError, AuthErrorCode } from '../errors/auth-error';
import { randomString } from '../core/pkce';
import { timingSafeEqual } from '../core/utils';
import { loadGisScript } from './gis-loader';

export const GOOGLE_OAUTH2_STORAGE_KEYS = {
  state: 'nuria:google-oauth2:state',
} as const;

const DEFAULT_SCOPE = 'openid email profile';

export interface GoogleCodeResponse {
  /** Authorization code returned by Google. Send to backend for token exchange. */
  code: string;
  /** Granted scopes (space-delimited). May differ from requested scopes if user
   *  declined a non-essential scope. */
  scope: string;
  /** State that round-tripped through Google — already validated by the SDK. */
  state?: string;
  /** Index of the authorized Google account when the user has multiple
   *  signed-in sessions. Pass-through from GIS. */
  authuser?: string;
}

export interface CreateGoogleCodeClientOptions {
  /** GCP OAuth 2.0 client ID (Web application type). */
  clientId: string;
  /** Space-delimited scopes. Defaults to `'openid email profile'` for sign-in. */
  scope?: string;
  /** Pre-fill the account chooser with a hint (email or sub). */
  loginHint?: string;
  /** Restrict to a Google Workspace domain. */
  hd?: string;
  /** Force account chooser even if a single session is active. */
  selectAccount?: boolean;
  /** OAuth `prompt` parameter — `'none'` requires an existing session,
   *  `'consent'` re-prompts, `'select_account'` mirrors `selectAccount`. */
  prompt?: 'none' | 'consent' | 'select_account';
  /**
   * UX mode. `'popup'` (default) opens an OAuth consent window and returns
   * the code via JS callback. `'redirect'` does a full-page redirect to
   * Google and back to `redirectUri` with `?code=...` in the query string.
   */
  uxMode?: 'popup' | 'redirect';
  /** Required when `uxMode` is `'redirect'`. */
  redirectUri?: string;
  /**
   * Caller-provided state — overrides the SDK's auto-generated CSRF token.
   * The SDK still verifies the round-trip value with `timingSafeEqual`. Use
   * this to embed correlation IDs (e.g. a request ID) when redirect mode is
   * involved; for popup mode the auto-generated state is enough.
   */
  state?: string;
  /** Fired with the authorization code once GIS round-trips it. */
  onCode: (response: GoogleCodeResponse) => void;
  /** Fired when GIS surfaces an OAuth error or the user dismisses the popup. */
  onError?: (err: Error) => void;
}

export interface GoogleCodeClientHandle {
  /**
   * Trigger the OAuth flow. MUST be invoked inside a user-gesture handler
   * (button click, keydown, etc.) — popup mode is otherwise blocked by
   * browser popup blockers.
   */
  requestCode: () => void;
}

interface GsiCodeClient {
  requestCode: () => void;
}

interface GsiCodeClientConfigCallback {
  code?: string;
  scope?: string;
  state?: string;
  authuser?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

interface GsiCodeClientConfig {
  client_id: string;
  scope: string;
  callback?: (response: GsiCodeClientConfigCallback) => void;
  error_callback?: (err: { type: string; message?: string }) => void;
  state?: string;
  login_hint?: string;
  hd?: string;
  select_account?: boolean;
  prompt?: string;
  ux_mode?: string;
  redirect_uri?: string;
}

interface GsiOauth2Namespace {
  initCodeClient: (config: GsiCodeClientConfig) => GsiCodeClient;
}

type WindowWithOauth2 = Window & {
  google?: { accounts: { oauth2?: GsiOauth2Namespace } };
};

/**
 * Wraps `google.accounts.oauth2.initCodeClient` so consumers can ship a
 * fully custom-styled "Sign in with Google" button without the GIS-rendered
 * iframe. The OAuth 2.0 code flow is officially supported for custom
 * buttons (unlike `google.accounts.id`, which requires the GIS button).
 *
 * Flow (popup mode):
 *  1. Caller wires `requestCode()` to a custom-button click handler.
 *  2. Google opens a popup, user picks an account and consents.
 *  3. Popup posts the auth code back to the parent via GIS internals.
 *  4. SDK validates the `state` round-trip and invokes `onCode`.
 *  5. Caller forwards `code` to backend; backend exchanges with Google's
 *     `/token` endpoint (using `client_secret`) to obtain `id_token` +
 *     `access_token` + `refresh_token`, then verifies and creates a
 *     session.
 *
 * The SDK does NOT exchange the code itself — Google's `/token` endpoint
 * does not have reliable CORS for SPAs and exchange requires the GCP
 * client's `client_secret`, which must stay server-side.
 */
export async function createGoogleCodeClient(
  options: CreateGoogleCodeClientOptions,
): Promise<GoogleCodeClientHandle> {
  if (typeof window === 'undefined') {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'createGoogleCodeClient requires a browser environment',
    );
  }
  if (options.uxMode === 'redirect' && !options.redirectUri) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'createGoogleCodeClient: redirectUri is required when uxMode is "redirect"',
    );
  }

  await loadGisScript();
  const oauth2 = (window as WindowWithOauth2).google?.accounts?.oauth2;
  if (!oauth2) {
    throw new AuthError(
      AuthErrorCode.NETWORK_ERROR,
      'GIS oauth2 namespace missing — ensure accounts.google.com/gsi/client loaded successfully',
    );
  }

  const expectedState = options.state ?? randomString(32);
  sessionStorage.setItem(GOOGLE_OAUTH2_STORAGE_KEYS.state, expectedState);

  const client = oauth2.initCodeClient({
    client_id: options.clientId,
    scope: options.scope ?? DEFAULT_SCOPE,
    state: expectedState,
    login_hint: options.loginHint,
    hd: options.hd,
    select_account: options.selectAccount,
    prompt: options.prompt,
    ux_mode: options.uxMode ?? 'popup',
    redirect_uri: options.redirectUri,
    callback: (resp) => {
      // OAuth-level error from Google (user denied, scope not granted, etc.).
      if (resp.error) {
        options.onError?.(
          new AuthError(
            AuthErrorCode.NETWORK_ERROR,
            `Google OAuth error: ${resp.error}${resp.error_description ? ': ' + resp.error_description : ''}`,
          ),
        );
        return;
      }
      if (!resp.code) {
        options.onError?.(
          new AuthError(
            AuthErrorCode.NETWORK_ERROR,
            'Google OAuth callback returned no code and no error',
          ),
        );
        return;
      }
      const stored = sessionStorage.getItem(GOOGLE_OAUTH2_STORAGE_KEYS.state);
      sessionStorage.removeItem(GOOGLE_OAUTH2_STORAGE_KEYS.state);
      if (!stored || !resp.state || !timingSafeEqual(stored, resp.state)) {
        options.onError?.(
          new AuthError(
            AuthErrorCode.STATE_MISMATCH,
            'Google OAuth state mismatch — possible CSRF or stale flow',
          ),
        );
        return;
      }
      options.onCode({
        code: resp.code,
        scope: resp.scope ?? '',
        state: resp.state,
        authuser: resp.authuser,
      });
    },
    error_callback: (err) => {
      // GIS-level error: popup blocked, popup closed before consent, network
      // failure inside the popup, etc.
      sessionStorage.removeItem(GOOGLE_OAUTH2_STORAGE_KEYS.state);
      options.onError?.(
        new AuthError(
          AuthErrorCode.NETWORK_ERROR,
          `GIS oauth2 error: ${err.type}${err.message ? ': ' + err.message : ''}`,
        ),
      );
    },
  });

  return {
    requestCode: () => client.requestCode(),
  };
}
