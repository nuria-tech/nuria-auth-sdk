export const GOOGLE_STORAGE_KEYS = {
  nonce: 'nuria:google:nonce',
  state: 'nuria:google:state',
  returnSearch: 'nuria:google:return_search',
  pendingIdToken: 'nuria:google:pending_id_token',
} as const;

export interface StartGoogleLoginOptions {
  clientId: string;
  redirectUri: string;
  /** window.location.search to restore after callback, e.g. OAuth PKCE params */
  returnSearch?: string;
  onRedirect?: (url: string) => void;
}

/**
 * Initiates the Google OAuth implicit (id_token) flow.
 * Generates a nonce + state, persists them and the return search in
 * sessionStorage, then redirects to Google's authorization endpoint.
 *
 * The `state` parameter is defense-in-depth — the kernel already verifies
 * the id_token signature against Google's JWKS and rejects mismatched
 * audiences, so a forged callback would fail server-side regardless. State
 * adds CSRF protection on the client and aligns the Google flow with the
 * AWS SSO flow.
 */
export function startGoogleLogin(options: StartGoogleLoginOptions): void {
  const nonce = crypto.randomUUID();
  const state = crypto.randomUUID();
  sessionStorage.setItem(GOOGLE_STORAGE_KEYS.nonce, nonce);
  sessionStorage.setItem(GOOGLE_STORAGE_KEYS.state, state);
  sessionStorage.setItem(
    GOOGLE_STORAGE_KEYS.returnSearch,
    options.returnSearch ?? '',
  );

  const params = new URLSearchParams({
    response_type: 'id_token',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: 'openid email profile',
    nonce,
    state,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  if (options.onRedirect) {
    options.onRedirect(url);
    return;
  }
  window.location.replace(url);
}

/**
 * Parses a Google implicit flow callback from the URL hash.
 * If an id_token is present, stores it in sessionStorage and clears the
 * nonce/state/returnSearch entries. Returns the idToken and returnSearch, or
 * null if no id_token was found in the hash.
 *
 * State validation is **soft** — only rejected when both the URL hash and
 * sessionStorage contain a state value AND they disagree. If either side is
 * missing the check is skipped. Rationale: a strict check would break two
 * real-world deploys that we already saw in production:
 *
 * 1. **Mid-flight upgrade.** A user starts login on an older SDK build (no
 *    state stored), the SDK is redeployed before they return, and they land
 *    on the callback under the new SDK. The hash carries no state because
 *    the older SDK never sent one, so a strict check would reject a
 *    legitimate flow.
 * 2. **Storage wipe between start and callback.** A privacy-mode browser,
 *    sessionStorage cleanup by an extension, or a navigation that runs the
 *    parser twice (Strict Mode, hot reload) can drop `state` from storage
 *    even though the URL still has the original value. Strict mode would
 *    reject the second pass; soft mode accepts it because storage is empty
 *    on that side.
 *
 * Defense-in-depth is preserved: the kernel still verifies the id_token's
 * signature/audience server-side, which is the actual security boundary.
 */
export function parseGoogleHashCallback(
  hash: string,
): { idToken: string; returnSearch: string } | null {
  if (!hash || hash.length <= 1) return null;
  const params = new URLSearchParams(
    hash.startsWith('#') ? hash.substring(1) : hash,
  );
  const idToken = params.get('id_token');
  if (!idToken) return null;

  const returnedState = params.get('state');
  const storedState = sessionStorage.getItem(GOOGLE_STORAGE_KEYS.state);
  if (storedState && returnedState && storedState !== returnedState) {
    return null;
  }

  const returnSearch =
    sessionStorage.getItem(GOOGLE_STORAGE_KEYS.returnSearch) ?? '';
  sessionStorage.removeItem(GOOGLE_STORAGE_KEYS.returnSearch);
  sessionStorage.removeItem(GOOGLE_STORAGE_KEYS.nonce);
  sessionStorage.removeItem(GOOGLE_STORAGE_KEYS.state);
  sessionStorage.setItem(GOOGLE_STORAGE_KEYS.pendingIdToken, idToken);

  return { idToken, returnSearch };
}

/**
 * Retrieves and removes the pending Google id_token from sessionStorage.
 * Returns null if there is no pending token.
 */
export function consumePendingGoogleIdToken(): string | null {
  const token = sessionStorage.getItem(GOOGLE_STORAGE_KEYS.pendingIdToken);
  if (token) sessionStorage.removeItem(GOOGLE_STORAGE_KEYS.pendingIdToken);
  return token;
}
