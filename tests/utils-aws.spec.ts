// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AWS_STORAGE_KEYS,
  parseAwsQueryCallback,
  startAwsLogin,
} from '../src/utils/aws';
import { AuthError, AuthErrorCode } from '../src/errors/auth-error';

const ISSUER = 'https://identitycenter.amazonaws.com/ssoins-12345abcde/';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

const mintIdToken = (claims: Record<string, unknown>) =>
  `${b64url({ alg: 'RS256' })}.${b64url(claims)}.signature`;

const findBag = () => {
  const keys = Object.keys(sessionStorage).filter((k) =>
    k.startsWith(AWS_STORAGE_KEYS.pkcePrefix),
  );
  expect(keys).toHaveLength(1);
  const key = keys[0]!;
  const state = key.slice(AWS_STORAGE_KEYS.pkcePrefix.length);
  const bag = JSON.parse(sessionStorage.getItem(key)!);
  return { key, state, bag };
};

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('startAwsLogin', () => {
  it('builds an authorization URL with response_type=code and S256 challenge', async () => {
    const onRedirect = vi.fn();
    await startAwsLogin({
      clientId: 'aws-client',
      redirectUri: 'https://app.example.com/callback',
      issuerUrl: ISSUER,
      onRedirect,
    });
    expect(onRedirect).toHaveBeenCalledOnce();
    const url = onRedirect.mock.calls[0]![0] as string;
    expect(url).toContain(`${ISSUER.replace(/\/+$/, '')}/authorize`);
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=aws-client');
    expect(url).toContain('scope=openid+email+profile');
    expect(url).toContain('code_challenge=');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('nonce=');
    expect(url).toContain('state=');
  });

  it('persists a per-state PKCE bag with verifier, nonce, redirect, token endpoint and returnSearch', async () => {
    await startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      returnSearch: '?next=/dashboard',
      onRedirect: () => {},
    });
    const { state, bag } = findBag();
    expect(state.length).toBe(32);
    expect(bag.codeVerifier).toHaveLength(96);
    expect(bag.nonce).toHaveLength(32);
    expect(bag.redirectUri).toBe('https://app.example.com/cb');
    expect(bag.clientId).toBe('c');
    expect(bag.tokenEndpoint).toBe(`${ISSUER.replace(/\/+$/, '')}/token`);
    expect(bag.returnSearch).toBe('?next=/dashboard');
  });

  it('honors a fully-qualified authorizationEndpoint over issuerUrl', async () => {
    const onRedirect = vi.fn();
    await startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      authorizationEndpoint: 'https://oidc.example.com/oauth2/authorize',
      onRedirect,
    });
    const url = onRedirect.mock.calls[0]![0] as string;
    expect(url).toContain('https://oidc.example.com/oauth2/authorize?');
  });

  it('honors a fully-qualified tokenEndpoint over issuerUrl', async () => {
    await startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      tokenEndpoint: 'https://oidc.example.com/oauth2/token',
      onRedirect: () => {},
    });
    const { bag } = findBag();
    expect(bag.tokenEndpoint).toBe('https://oidc.example.com/oauth2/token');
  });

  it('appends params with `&` when the authorization endpoint already has a query string', async () => {
    const onRedirect = vi.fn();
    await startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      tokenEndpoint: 'https://oidc.example.com/token',
      authorizationEndpoint: 'https://oidc.example.com/authorize?foo=bar',
      onRedirect,
    });
    const url = onRedirect.mock.calls[0]![0] as string;
    expect(url).toContain('?foo=bar&response_type=code');
  });

  it('throws INVALID_CONFIG when neither issuerUrl nor authorizationEndpoint is provided', async () => {
    await expect(
      startAwsLogin({
        clientId: 'c',
        redirectUri: 'https://app.example.com/cb',
        tokenEndpoint: 'https://oidc.example.com/token',
        onRedirect: () => {},
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
  });

  it('respects custom scopes', async () => {
    const onRedirect = vi.fn();
    await startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      scopes: ['openid', 'sso:account:access'],
      onRedirect,
    });
    const url = onRedirect.mock.calls[0]![0] as string;
    expect(url).toContain('scope=openid+sso%3Aaccount%3Aaccess');
  });
});

describe('parseAwsQueryCallback', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns null for empty query', async () => {
    expect(await parseAwsQueryCallback('')).toBeNull();
    expect(await parseAwsQueryCallback('?')).toBeNull();
  });

  it('returns null when no code is present', async () => {
    expect(await parseAwsQueryCallback('?state=abc')).toBeNull();
  });

  it('throws CALLBACK_ERROR when provider returns an error', async () => {
    await expect(
      parseAwsQueryCallback('?error=access_denied&error_description=User+cancelled'),
    ).rejects.toMatchObject({ code: AuthErrorCode.CALLBACK_ERROR });
  });

  it('throws MISSING_STATE when code is present but state is not', async () => {
    await expect(parseAwsQueryCallback('?code=c1')).rejects.toMatchObject({
      code: AuthErrorCode.MISSING_STATE,
    });
  });

  it('throws STATE_MISMATCH when the bag for this state is not in storage', async () => {
    await expect(
      parseAwsQueryCallback('?code=c1&state=ghost'),
    ).rejects.toMatchObject({ code: AuthErrorCode.STATE_MISMATCH });
  });

  it('exchanges the code at the bag tokenEndpoint with code_verifier', async () => {
    await startAwsLogin({
      clientId: 'aws-c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      onRedirect: () => {},
    });
    const { state, bag } = findBag();

    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(bag.tokenEndpoint);
      const params = new URLSearchParams(String(init.body));
      expect(params.get('grant_type')).toBe('authorization_code');
      expect(params.get('code')).toBe('auth-code');
      expect(params.get('client_id')).toBe('aws-c');
      expect(params.get('code_verifier')).toBe(bag.codeVerifier);
      expect(params.get('redirect_uri')).toBe('https://app.example.com/cb');
      return new Response(
        JSON.stringify({ id_token: mintIdToken({ nonce: bag.nonce, sub: 'u' }) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await parseAwsQueryCallback(`?code=auth-code&state=${state}`);
    expect(result).not.toBeNull();
    expect(result!.idToken).toContain('.');
    expect(fetchMock).toHaveBeenCalledOnce();
    // PKCE bag must be removed once the exchange completes.
    expect(sessionStorage.getItem(`${AWS_STORAGE_KEYS.pkcePrefix}${state}`)).toBeNull();
  });

  it('throws STATE_MISMATCH when the id_token nonce disagrees with the bag', async () => {
    await startAwsLogin({
      clientId: 'aws-c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      onRedirect: () => {},
    });
    const { state } = findBag();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ id_token: mintIdToken({ nonce: 'tampered' }) }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    await expect(
      parseAwsQueryCallback(`?code=c&state=${state}`),
    ).rejects.toMatchObject({ code: AuthErrorCode.STATE_MISMATCH });
    // Bag is cleared even on failure to prevent verifier reuse.
    expect(sessionStorage.getItem(`${AWS_STORAGE_KEYS.pkcePrefix}${state}`)).toBeNull();
  });

  it('throws TOKEN_EXCHANGE_FAILED when the token endpoint returns 4xx', async () => {
    await startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      onRedirect: () => {},
    });
    const { state } = findBag();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    await expect(parseAwsQueryCallback(`?code=c&state=${state}`)).rejects.toMatchObject(
      { code: AuthErrorCode.TOKEN_EXCHANGE_FAILED },
    );
  });

  it('throws TOKEN_EXCHANGE_FAILED when the token response has no id_token', async () => {
    await startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      onRedirect: () => {},
    });
    const { state } = findBag();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ access_token: 'a' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    await expect(parseAwsQueryCallback(`?code=c&state=${state}`)).rejects.toThrow(
      AuthError,
    );
  });

  it('isolates concurrent logins by state — second tab does not clobber the first', async () => {
    await startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      onRedirect: () => {},
    });
    const first = findBag();
    // Second login from a parallel tab.
    await startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: ISSUER,
      onRedirect: () => {},
    });
    const keys = Object.keys(sessionStorage).filter((k) =>
      k.startsWith(AWS_STORAGE_KEYS.pkcePrefix),
    );
    expect(keys).toHaveLength(2);
    expect(sessionStorage.getItem(first.key)).toBeTruthy();
  });
});
