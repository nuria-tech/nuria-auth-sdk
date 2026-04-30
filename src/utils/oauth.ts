export interface OAuthAuthorizeParams {
  /** Base URL of the auth server, e.g. https://auth.nuria.com.br */
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  /** The access token of the current accounts session, passed to the authorize endpoint. */
  sessionToken: string;
  scope?: string;
  nonce?: string;
  /** OIDC `prompt` (Core §3.1.2.1). Forwarded so the kernel can honor it on the next hop. */
  prompt?: string;
}

/**
 * Builds the full URL for the /v2/oauth/authorize endpoint.
 * Used by the accounts app (acting as IdP) to redirect a client app
 * back with an authorization code after the user is authenticated.
 */
export function buildOAuthAuthorizeUrl(params: OAuthAuthorizeParams): string {
  const urlParams = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod ?? 'S256',
    session_token: params.sessionToken,
  });
  if (params.scope) urlParams.set('scope', params.scope);
  if (params.nonce) urlParams.set('nonce', params.nonce);
  if (params.prompt) urlParams.set('prompt', params.prompt);
  return `${params.baseUrl}/v2/oauth/authorize?${urlParams.toString()}`;
}
