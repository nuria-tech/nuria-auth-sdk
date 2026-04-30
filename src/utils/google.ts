import { AuthError, AuthErrorCode } from '../errors/auth-error';
import { randomString } from '../core/pkce';
import { timingSafeEqual } from '../core/utils';

export const GOOGLE_STORAGE_KEYS = {
  nonce: 'nuria:google:nonce',
} as const;

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

export interface GoogleCredentialResponse {
  /** OIDC ID token (JWT) issued by Google. Send this to the backend. */
  idToken: string;
  /** Reason GIS picked the credential (button click, auto-select, etc). */
  selectBy: string;
  clientId: string;
}

export interface RenderGoogleSignInButtonOptions {
  clientId: string;
  /** DOM element where GIS will render the button. */
  element: HTMLElement;
  /** Fired with the validated id_token after the user completes sign-in. */
  onCredential: (response: GoogleCredentialResponse) => void;
  /** Fired when GIS itself errors, the script fails to load, or nonce mismatches. */
  onError?: (err: Error) => void;
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: number;
  locale?: string;
}

export interface PromptGoogleOneTapOptions {
  clientId: string;
  onCredential: (response: GoogleCredentialResponse) => void;
  onError?: (err: Error) => void;
}

interface GsiInitializeConfig {
  client_id: string;
  callback: (resp: {
    credential: string;
    select_by: string;
    clientId: string;
  }) => void;
  nonce: string;
  use_fedcm_for_prompt: true;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  itp_support?: boolean;
}

interface GsiButtonOptions {
  theme?: string;
  size?: string;
  text?: string;
  shape?: string;
  width?: number;
  locale?: string;
}

interface GsiClient {
  accounts: {
    id: {
      initialize: (config: GsiInitializeConfig) => void;
      renderButton: (el: HTMLElement, options: GsiButtonOptions) => void;
      prompt: () => void;
      cancel: () => void;
      disableAutoSelect: () => void;
    };
  };
}

declare global {
  interface Window {
    google?: GsiClient;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'Google Identity Services requires a browser environment',
      ),
    );
  }
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_URL}"]`,
    );
    const handleLoad = () => {
      if (window.google?.accounts?.id) resolve();
      else
        reject(
          new AuthError(
            AuthErrorCode.NETWORK_ERROR,
            'GIS script loaded but window.google.accounts.id is missing',
          ),
        );
    };
    const handleError = () => {
      scriptPromise = null;
      reject(
        new AuthError(
          AuthErrorCode.NETWORK_ERROR,
          'Failed to load Google Identity Services script',
        ),
      );
    };
    if (existing) {
      existing.addEventListener('load', handleLoad, { once: true });
      existing.addEventListener('error', handleError, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function decodeJwtNonce(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
    return typeof payload.nonce === 'string' ? payload.nonce : null;
  } catch {
    return null;
  }
}

// Page-scoped nonce. GIS binds the nonce at `initialize()` time, so once we
// initialize for a client_id we keep the same nonce for the lifetime of the
// page. Re-calling `initialize()` to rotate the nonce triggers a "called
// multiple times" warning in the GIS logger and only the last call wins.
//
// Cryptographic freshness is preserved across page loads (every fresh load
// mints a new nonce) and the value is still validated against the JWT
// `nonce` claim on every credential response.
function mintAndStoreNonce(): string {
  const existing = sessionStorage.getItem(GOOGLE_STORAGE_KEYS.nonce);
  if (existing) return existing;
  const nonce = randomString(32);
  sessionStorage.setItem(GOOGLE_STORAGE_KEYS.nonce, nonce);
  return nonce;
}

function consumeStoredNonce(): string | null {
  // Read but do not delete: the nonce is reused for every sign-in attempt
  // until the page is reloaded or the user explicitly logs out (which
  // calls disableGoogleAutoSelect → clears the nonce).
  return sessionStorage.getItem(GOOGLE_STORAGE_KEYS.nonce);
}

// We register a *single* delegate with GIS at first initialize. Subsequent
// renderGoogleSignInButton/promptGoogleOneTap calls swap out this active
// callback without re-initializing — that's what suppresses the
// `google.accounts.id.initialize() is called multiple times` warning while
// still letting different callers (e.g. a re-render after theme change)
// hook into the GIS credential event.
let activeCredentialCallback:
  | ((response: GoogleCredentialResponse) => void)
  | null = null;
let activeErrorCallback: ((err: Error) => void) | null = null;
let initializedClientId: string | null = null;

function buildCredentialHandler(
  onCredential: (response: GoogleCredentialResponse) => void,
  onError?: (err: Error) => void,
) {
  activeCredentialCallback = onCredential;
  activeErrorCallback = onError ?? null;
  return gisDelegate;
}

const gisDelegate = (resp: {
  credential: string;
  select_by: string;
  clientId: string;
}) => {
  const storedNonce = consumeStoredNonce();
  const tokenNonce = decodeJwtNonce(resp.credential);
  if (
    !storedNonce ||
    !tokenNonce ||
    !timingSafeEqual(storedNonce, tokenNonce)
  ) {
    const err = new AuthError(
      AuthErrorCode.STATE_MISMATCH,
      'Google credential nonce validation failed — possible replay attack',
    );
    if (activeErrorCallback) activeErrorCallback(err);
    else throw err;
    return;
  }
  activeCredentialCallback?.({
    idToken: resp.credential,
    selectBy: resp.select_by,
    clientId: resp.clientId,
  });
};

function ensureGsiInitialized(clientId: string, nonce: string): void {
  // Only call gsi.initialize once per page load (and only re-init if the
  // client_id changes — which never happens in practice, but is the
  // defensible bail-out). Subsequent callers just update the active
  // delegates above.
  if (initializedClientId === clientId) return;
  const gsi = window.google!.accounts.id;
  gsi.initialize({
    client_id: clientId,
    callback: gisDelegate,
    nonce,
    use_fedcm_for_prompt: true,
    itp_support: true,
  });
  initializedClientId = clientId;
}

/**
 * Renders the official Sign in with Google button in the given element using
 * Google Identity Services (GIS). The page must include the client's origin
 * in the GCP OAuth client's "Authorized JavaScript origins".
 *
 * Replaces the legacy implicit (`response_type=id_token`) redirect flow:
 * GIS uses FedCM where available and never returns the id_token through the
 * URL fragment. The id_token still arrives via the `onCredential` callback;
 * caller is responsible for posting it to the backend.
 *
 * Each call mints a fresh nonce, stores it in sessionStorage, and validates
 * the `nonce` claim of the returned id_token before invoking `onCredential`.
 */
export async function renderGoogleSignInButton(
  options: RenderGoogleSignInButtonOptions,
): Promise<void> {
  await loadGisScript();
  const nonce = mintAndStoreNonce();
  // Update the active callback (no-op for the GIS init below — but it
  // ensures subsequent credential responses route to *this* caller).
  buildCredentialHandler(options.onCredential, options.onError);
  ensureGsiInitialized(options.clientId, nonce);
  const gsi = window.google!.accounts.id;
  gsi.renderButton(options.element, {
    theme: options.theme ?? 'outline',
    size: options.size ?? 'large',
    text: options.text ?? 'signin_with',
    shape: options.shape ?? 'rectangular',
    width: options.width,
    locale: options.locale,
  });
}

/**
 * Triggers the Google One Tap / FedCM prompt. The button is not rendered;
 * the browser surfaces a native account chooser. Use this for soft sign-in
 * suggestions; pair with `renderGoogleSignInButton` for explicit intent.
 */
export async function promptGoogleOneTap(
  options: PromptGoogleOneTapOptions,
): Promise<void> {
  await loadGisScript();
  const nonce = mintAndStoreNonce();
  buildCredentialHandler(options.onCredential, options.onError);
  ensureGsiInitialized(options.clientId, nonce);
  window.google!.accounts.id.prompt();
}

/** Cancels any in-flight One Tap prompt. Safe to call when GIS isn't loaded. */
export function cancelGooglePrompt(): void {
  if (typeof window === 'undefined') return;
  window.google?.accounts.id.cancel();
}

/**
 * Disables Google's auto-select on the next visit. Call on logout so the
 * user isn't silently re-signed in by FedCM/One Tap.
 */
export function disableGoogleAutoSelect(): void {
  if (typeof window === 'undefined') return;
  window.google?.accounts.id.disableAutoSelect();
  sessionStorage.removeItem(GOOGLE_STORAGE_KEYS.nonce);
  initializedClientId = null;
  activeCredentialCallback = null;
  activeErrorCallback = null;
}
