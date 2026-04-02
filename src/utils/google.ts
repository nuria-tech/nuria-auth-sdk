export const GOOGLE_STORAGE_KEYS = {
  nonce: 'nuria:google:nonce',
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
 * Generates a nonce, persists it and the return search in sessionStorage,
 * then redirects to Google's authorization endpoint.
 */
export function startGoogleLogin(options: StartGoogleLoginOptions): void {
  const nonce = crypto.randomUUID();
  sessionStorage.setItem(GOOGLE_STORAGE_KEYS.nonce, nonce);
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
 * nonce/returnSearch entries. Returns the idToken and returnSearch, or null
 * if no id_token was found in the hash.
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

  const returnSearch =
    sessionStorage.getItem(GOOGLE_STORAGE_KEYS.returnSearch) ?? '';
  sessionStorage.removeItem(GOOGLE_STORAGE_KEYS.returnSearch);
  sessionStorage.removeItem(GOOGLE_STORAGE_KEYS.nonce);
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
