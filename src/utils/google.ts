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
  /** Optional state string from the clicked Google button. */
  state?: string;
}

export interface GoogleInitializeOptions {
  /** One Tap color scheme. */
  colorScheme?: 'default' | 'light' | 'dark';
  /** Enables automatic selection for One Tap. */
  autoSelect?: boolean;
  /** JavaScript callback for browser-native password credentials. */
  nativeCallback?: (credential: { id: string; password: string }) => void;
  /** Cancels One Tap if the user clicks outside the prompt. */
  cancelOnTapOutside?: boolean;
  /** DOM ID where One Tap should render. */
  promptParentId?: string;
  /** One Tap prompt wording. */
  context?: 'signin' | 'signup' | 'use';
  /** Parent domain for shared One Tap state cookies across subdomains. */
  stateCookieDomain?: string;
  /** Google button UX mode. Callback mode remains the SDK default. */
  uxMode?: 'popup' | 'redirect';
  /** Login endpoint used by Google's redirect UX mode. */
  loginUri?: string;
  /** Origins allowed to embed the intermediate iframe. */
  allowedParentOrigin?: string | string[];
  /** Called before the intermediate iframe is removed by GIS. */
  intermediateIframeCloseCallback?: () => void;
  /** Enables upgraded One Tap UX on ITP browsers. */
  itpSupport?: boolean;
  /** Hint Google account selection with an email or subject. */
  loginHint?: string;
  /** Restrict or hint account selection by Google Workspace domain. */
  hd?: string;
  /** Enables Google's FedCM prompt mode. Defaults to the SDK's existing behavior: true. */
  useFedcmForPrompt?: boolean;
  /**
   * Enables Google's FedCM-rendered button variant. Defaults to the SDK's
   * existing behavior: true. Set false if the personalized iframe jumps layout.
   */
  useFedcmForButton?: boolean;
  /** Enables auto-select for the FedCM button flow. */
  buttonAutoSelect?: boolean;
}

export interface GoogleButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logoAlignment?: 'left' | 'center';
  width?: number | string;
  locale?: string;
  clickListener?: () => void;
  state?: string;
}

export interface RenderGoogleSignInButtonOptions
  extends GoogleInitializeOptions, GoogleButtonOptions {
  clientId: string;
  /** DOM element where GIS will render the button. */
  element: HTMLElement;
  /** Fired with the validated id_token after the user completes sign-in. */
  onCredential: (response: GoogleCredentialResponse) => void;
  /** Fired when GIS itself errors, the script fails to load, or nonce mismatches. */
  onError?: (err: Error) => void;
}

export interface PromptGoogleOneTapOptions extends GoogleInitializeOptions {
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
    state?: string;
  }) => void;
  nonce: string;
  color_scheme?: string;
  auto_select?: boolean;
  native_callback?: (credential: { id: string; password: string }) => void;
  cancel_on_tap_outside?: boolean;
  prompt_parent_id?: string;
  context?: string;
  state_cookie_domain?: string;
  ux_mode?: string;
  login_uri?: string;
  allowed_parent_origin?: string | string[];
  intermediate_iframe_close_callback?: () => void;
  itp_support?: boolean;
  login_hint?: string;
  hd?: string;
  use_fedcm_for_prompt?: boolean;
  use_fedcm_for_button?: boolean;
  button_auto_select?: boolean;
}

interface GsiButtonOptions {
  type?: string;
  theme?: string;
  size?: string;
  text?: string;
  shape?: string;
  logo_alignment?: string;
  width?: number | string;
  locale?: string;
  click_listener?: () => void;
  state?: string;
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
let initializedConfigKey: string | null = null;

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
  state?: string;
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
    state: resp.state,
  });
};

function toGsiInitializeConfig(
  clientId: string,
  nonce: string,
  options: GoogleInitializeOptions = {},
): GsiInitializeConfig {
  return {
    client_id: clientId,
    callback: gisDelegate,
    nonce,
    color_scheme: options.colorScheme,
    auto_select: options.autoSelect,
    native_callback: options.nativeCallback,
    cancel_on_tap_outside: options.cancelOnTapOutside,
    prompt_parent_id: options.promptParentId,
    context: options.context,
    state_cookie_domain: options.stateCookieDomain,
    ux_mode: options.uxMode,
    login_uri: options.loginUri,
    allowed_parent_origin: options.allowedParentOrigin,
    intermediate_iframe_close_callback: options.intermediateIframeCloseCallback,
    itp_support: options.itpSupport ?? true,
    login_hint: options.loginHint,
    hd: options.hd,
    use_fedcm_for_prompt: options.useFedcmForPrompt ?? true,
    use_fedcm_for_button: options.useFedcmForButton ?? true,
    button_auto_select: options.buttonAutoSelect,
  };
}

function initializeConfigKey(config: GsiInitializeConfig): string {
  return JSON.stringify({
    client_id: config.client_id,
    color_scheme: config.color_scheme,
    auto_select: config.auto_select,
    has_native_callback: Boolean(config.native_callback),
    cancel_on_tap_outside: config.cancel_on_tap_outside,
    prompt_parent_id: config.prompt_parent_id,
    context: config.context,
    state_cookie_domain: config.state_cookie_domain,
    ux_mode: config.ux_mode,
    login_uri: config.login_uri,
    allowed_parent_origin: config.allowed_parent_origin,
    has_intermediate_iframe_close_callback: Boolean(
      config.intermediate_iframe_close_callback,
    ),
    itp_support: config.itp_support,
    login_hint: config.login_hint,
    hd: config.hd,
    use_fedcm_for_prompt: config.use_fedcm_for_prompt,
    use_fedcm_for_button: config.use_fedcm_for_button,
    button_auto_select: config.button_auto_select,
  });
}

function ensureGsiInitialized(config: GsiInitializeConfig): void {
  // Only call gsi.initialize once per page load (and only re-init if the
  // effective GIS configuration changes). Subsequent callers just update the
  // active delegates above.
  const configKey = initializeConfigKey(config);
  if (initializedConfigKey === configKey) return;
  const gsi = window.google!.accounts.id;
  gsi.initialize(config);
  initializedConfigKey = configKey;
}

function toGsiButtonOptions(
  options: GoogleButtonOptions = {},
): GsiButtonOptions {
  return {
    type: options.type,
    theme: options.theme ?? 'outline',
    size: options.size ?? 'large',
    text: options.text ?? 'signin_with',
    shape: options.shape ?? 'rectangular',
    logo_alignment: options.logoAlignment,
    width: options.width,
    locale: options.locale,
    click_listener: options.clickListener,
    state: options.state,
  };
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
  ensureGsiInitialized(toGsiInitializeConfig(options.clientId, nonce, options));
  const gsi = window.google!.accounts.id;
  gsi.renderButton(options.element, toGsiButtonOptions(options));
}

export interface AttachCustomGoogleButtonOptions
  extends GoogleInitializeOptions, Omit<GoogleButtonOptions, 'width'> {
  clientId: string;
  /**
   * Element that wraps your custom-styled button. The helper renders the
   * official GIS button on top of it as a transparent overlay so real user
   * clicks reach GIS — preserving FedCM/One Tap user activation. The wrapper
   * must establish a positioning context: if it computes to `position:
   * static`, the helper promotes it to `position: relative`.
   *
   * Size guidance: GIS button height is fixed by `size` (~40px for `large`,
   * ~32px for `medium`, ~24px for `small`) and width is clamped to
   * [200, 400]. Make your custom button roughly that size so the overlay
   * fully covers the visible click area — clicks landing outside the GIS
   * iframe won't reach Google and the FedCM popup won't open.
   */
  container: HTMLElement;
  onCredential: (response: GoogleCredentialResponse) => void;
  onError?: (err: Error) => void;
}

export interface CustomGoogleButtonHandle {
  /**
   * Re-renders the hidden GIS button. Call after a theme/locale change or
   * when the container moves into a new sizing context the ResizeObserver
   * can't see.
   */
  refresh: () => Promise<void>;
  /** Detaches the ResizeObserver and removes the overlay element. */
  destroy: () => void;
}

/**
 * Mounts the official GIS button as a transparent overlay over a custom
 * container, so consumers can ship their own branded button while keeping
 * Google's FedCM-aware click handling. Real user clicks land on the GIS
 * iframe (preserving user activation), avoiding the cooldown problems that
 * affect `prompt()`-only integrations.
 *
 * The visible button styling is fully owned by the caller — the helper does
 * not draw a Google logo or background. Pair this with a `<button>` that
 * matches the GIS button's natural dimensions (see `container` JSDoc).
 */
export async function attachCustomGoogleButton(
  options: AttachCustomGoogleButtonOptions,
): Promise<CustomGoogleButtonHandle> {
  if (typeof document === 'undefined') {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'attachCustomGoogleButton requires a browser environment',
    );
  }
  const { container, ...rest } = options;

  // Treat any non-positioned context (including empty/unset, which happy-dom
  // reports as '') as needing promotion. The overlay is `position: absolute`
  // and would otherwise escape the container.
  const positionedValues = ['relative', 'absolute', 'fixed', 'sticky'];
  if (!positionedValues.includes(getComputedStyle(container).position)) {
    container.style.position = 'relative';
  }

  const overlayHost = document.createElement('div');
  overlayHost.setAttribute('data-nuria-google-overlay', '');
  overlayHost.setAttribute('aria-hidden', 'true');
  overlayHost.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'opacity:0',
    'cursor:pointer',
    'z-index:1',
  ].join(';');
  container.appendChild(overlayHost);

  let lastWidth = 0;
  let destroyed = false;
  let resizeObserver: ResizeObserver | null = null;
  let pendingRaf = 0;

  // GIS renders the iframe at requestedWidth + 20px (10px padding each side)
  // and clamps to [200, 400]. Subtract 20 so the iframe lands exactly at the
  // container width without clipping when an ancestor sets `overflow: hidden`.
  const computeWidth = (): number => {
    const measured = Math.floor(container.getBoundingClientRect().width);
    const target = (measured > 0 ? measured : 360) - 20;
    return Math.max(200, Math.min(target, 400));
  };

  const renderOnce = async (): Promise<void> => {
    if (destroyed) return;
    const width = computeWidth();
    if (width === lastWidth) return;
    lastWidth = width;
    overlayHost.replaceChildren();
    await renderGoogleSignInButton({
      ...rest,
      element: overlayHost,
      width,
    });
  };

  await renderOnce();

  if (typeof ResizeObserver !== 'undefined') {
    const hasRaf = typeof requestAnimationFrame !== 'undefined';
    resizeObserver = new ResizeObserver(() => {
      if (!hasRaf) {
        void renderOnce();
        return;
      }
      cancelAnimationFrame(pendingRaf);
      pendingRaf = requestAnimationFrame(() => {
        void renderOnce();
      });
    });
    resizeObserver.observe(container);
  }

  return {
    refresh: async () => {
      lastWidth = 0;
      await renderOnce();
    },
    destroy: () => {
      destroyed = true;
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(pendingRaf);
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
      overlayHost.remove();
    },
  };
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
  ensureGsiInitialized(toGsiInitializeConfig(options.clientId, nonce, options));
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
  initializedConfigKey = null;
  activeCredentialCallback = null;
  activeErrorCallback = null;
}
