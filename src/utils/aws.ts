export const AWS_STORAGE_KEYS = {
  nonce: 'nuria:aws:nonce',
  state: 'nuria:aws:state',
  returnSearch: 'nuria:aws:return_search',
  pendingIdToken: 'nuria:aws:pending_id_token',
} as const;

export interface StartAwsLoginOptions {
  /**
   * Client ID of the customer-managed application registered in AWS
   * IAM Identity Center (formerly AWS SSO).
   */
  clientId: string;
  /** Callback URL registered in the customer-managed application. */
  redirectUri: string;
  /**
   * Issuer URL of the IAM Identity Center instance — copy it from the
   * customer-managed application's "Issuer URL" field (looks like
   * `https://identitycenter.amazonaws.com/ssoins-XXXXXXXX/`). The
   * authorization endpoint is derived as `${issuerUrl}/authorize` unless
   * `authorizationEndpoint` is provided.
   */
  issuerUrl?: string;
  /**
   * Fully-qualified authorization endpoint. Takes precedence over
   * `issuerUrl` — useful when the discovery document advertises a
   * non-standard path.
   */
  authorizationEndpoint?: string;
  /** OAuth scopes; defaults to `'openid email profile'`. */
  scopes?: string[];
  /** window.location.search to restore after callback (e.g. preserved query). */
  returnSearch?: string;
  onRedirect?: (url: string) => void;
}

function resolveAuthorizationEndpoint(opts: StartAwsLoginOptions): string {
  if (opts.authorizationEndpoint) return opts.authorizationEndpoint;
  if (!opts.issuerUrl) {
    throw new Error(
      'startAwsLogin: provide either `issuerUrl` or `authorizationEndpoint`',
    );
  }
  return `${opts.issuerUrl.replace(/\/+$/, '')}/authorize`;
}

/**
 * Initiates the AWS IAM Identity Center (AWS SSO) implicit (id_token) flow
 * for a customer-managed application. Generates a nonce + state, persists
 * them and the return search in sessionStorage, then redirects to the
 * IAM Identity Center authorization endpoint.
 */
export function startAwsLogin(options: StartAwsLoginOptions): void {
  const nonce = crypto.randomUUID();
  const state = crypto.randomUUID();
  sessionStorage.setItem(AWS_STORAGE_KEYS.nonce, nonce);
  sessionStorage.setItem(AWS_STORAGE_KEYS.state, state);
  sessionStorage.setItem(
    AWS_STORAGE_KEYS.returnSearch,
    options.returnSearch ?? '',
  );

  const scope = (options.scopes ?? ['openid', 'email', 'profile']).join(' ');
  const params = new URLSearchParams({
    response_type: 'id_token',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope,
    state,
    nonce,
  });

  const endpoint = resolveAuthorizationEndpoint(options);
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${endpoint}${separator}${params.toString()}`;

  if (options.onRedirect) {
    options.onRedirect(url);
    return;
  }
  window.location.replace(url);
}

/**
 * Parses an AWS IAM Identity Center implicit flow callback from the URL
 * hash. If an id_token is present and the state matches the stored value,
 * stores the token as `pendingIdToken` and clears the
 * nonce/state/returnSearch entries. Returns the idToken and returnSearch,
 * or null if no id_token was found or state mismatched.
 */
export function parseAwsHashCallback(
  hash: string,
): { idToken: string; returnSearch: string } | null {
  if (!hash || hash.length <= 1) return null;
  const params = new URLSearchParams(
    hash.startsWith('#') ? hash.substring(1) : hash,
  );
  const idToken = params.get('id_token');
  if (!idToken) return null;

  const returnedState = params.get('state');
  const storedState = sessionStorage.getItem(AWS_STORAGE_KEYS.state);
  if (storedState && returnedState && storedState !== returnedState) {
    return null;
  }

  const returnSearch =
    sessionStorage.getItem(AWS_STORAGE_KEYS.returnSearch) ?? '';
  sessionStorage.removeItem(AWS_STORAGE_KEYS.returnSearch);
  sessionStorage.removeItem(AWS_STORAGE_KEYS.nonce);
  sessionStorage.removeItem(AWS_STORAGE_KEYS.state);
  sessionStorage.setItem(AWS_STORAGE_KEYS.pendingIdToken, idToken);

  return { idToken, returnSearch };
}

/**
 * Retrieves and removes the pending AWS IAM Identity Center id_token from
 * sessionStorage. Returns null if there is no pending token.
 */
export function consumePendingAwsIdToken(): string | null {
  const token = sessionStorage.getItem(AWS_STORAGE_KEYS.pendingIdToken);
  if (token) sessionStorage.removeItem(AWS_STORAGE_KEYS.pendingIdToken);
  return token;
}
