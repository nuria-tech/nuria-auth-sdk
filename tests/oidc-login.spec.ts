import { describe, expect, it, vi } from 'vitest';
import {
  createAuthClient,
  AuthErrorCode,
  type AuthTransportRequest,
} from '../src';

const BASE_CONFIG = {
  clientId: 'test-client',
  baseUrl: 'https://auth.example.com',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
};

function makeSequencedTransport(payloads: unknown[]) {
  let i = 0;
  return {
    request: vi.fn(async () => ({
      status: 200,
      data: payloads[Math.min(i++, payloads.length - 1)],
      headers: new Headers(),
    })),
  };
}

function calls(transport: { request: ReturnType<typeof vi.fn> }) {
  return transport.request.mock.calls as Array<[string, AuthTransportRequest]>;
}

describe('listOidcProviders', () => {
  it('maps the kernel payload defensively', async () => {
    const transport = makeSequencedTransport([
      [
        {
          key: 'azuread',
          displayName: 'Microsoft',
          type: 'oidc',
          beginUrl: 'https://auth.example.com/v2/login/oidc/azuread/begin',
        },
        { key: 'okta' }, // missing fields tolerated
      ],
    ]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: transport as never,
    });

    const providers = await client.listOidcProviders();

    expect(calls(transport)[0]![0]).toBe(
      'https://auth.example.com/v2/login/oidc/providers',
    );
    expect(providers).toHaveLength(2);
    expect(providers[0]!.displayName).toBe('Microsoft');
    expect(providers[1]).toEqual({
      key: 'okta',
      displayName: '',
      type: 'oidc',
      beginUrl: '',
    });
  });

  it('tolerates a non-array payload', async () => {
    const transport = makeSequencedTransport([{ nope: true }]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: transport as never,
    });
    expect(await client.listOidcProviders()).toEqual([]);
  });
});

describe('startOidcLogin', () => {
  it('fetches the authorize URL and redirects via onRedirect', async () => {
    let redirected = '';
    const transport = makeSequencedTransport([
      { authorizeUrl: 'https://idp.example.com/authorize?x=1' },
    ]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: transport as never,
      onRedirect: (url) => {
        redirected = url;
      },
    });

    await client.startOidcLogin({
      provider: 'azuread',
      returnUrl: 'https://accounts.nuria.com.br/sso/callback',
    });

    const beginUrl = new URL(calls(transport)[0]![0]);
    expect(beginUrl.pathname).toBe('/v2/login/oidc/azuread/begin');
    expect(beginUrl.searchParams.get('returnUrl')).toBe(
      'https://accounts.nuria.com.br/sso/callback',
    );
    expect(redirected).toBe('https://idp.example.com/authorize?x=1');
  });

  it('rejects a missing provider before any network call', async () => {
    const transport = makeSequencedTransport([{}]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: transport as never,
    });
    await expect(
      client.startOidcLogin({ provider: '  ' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('rejects an invalid returnUrl', async () => {
    const transport = makeSequencedTransport([{}]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: transport as never,
    });
    await expect(
      client.startOidcLogin({ provider: 'okta', returnUrl: 'not-a-url' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
  });

  it('throws when begin returns no authorize URL', async () => {
    const transport = makeSequencedTransport([{}]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: transport as never,
      onRedirect: () => {},
    });
    await expect(
      client.startOidcLogin({ provider: 'okta' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.CALLBACK_ERROR });
  });
});

describe('handleOidcCallback', () => {
  it('exchanges the oidc_code bridge code and creates a session', async () => {
    // First call: /v2/login/oidc/redeem returns the access token in JSON.
    const transport = makeSequencedTransport([
      {
        access_token: 'oidc-access',
        token_type: 'Bearer',
        expires_at: '2999-01-01T00:00:00.000Z',
      },
    ]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: transport as never,
      enableRefreshToken: false,
    });

    const callbackUrl =
      'https://accounts.nuria.com.br/sso/callback?oidc_code=abc123def456';
    const session = await client.handleOidcCallback(callbackUrl);

    const [redeemUrl, redeemReq] = calls(transport)[0]!;
    expect(redeemUrl).toBe('https://auth.example.com/v2/login/oidc/redeem');
    expect(redeemReq.method).toBe('POST');
    expect(redeemReq.body).toEqual({ code: 'abc123def456' });
    expect(redeemReq.credentials).toBe('include');

    expect(session.tokens.accessToken).toBe('oidc-access');
    expect(session.tokens.refreshToken).toBeUndefined();
    expect(session.provider).toBe('oidc');
    expect(session.tokens.expiresAt).toBe(
      new Date('2999-01-01T00:00:00.000Z').getTime(),
    );
    expect(client.isAuthenticated()).toBe(true);
  });

  it('surfaces an error carried in the query string', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(
      client.handleOidcCallback(
        'https://app/cb?error=access_denied&error_description=nope',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.CALLBACK_ERROR });
  });

  it('throws when the callback has no oidc_code', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(
      client.handleOidcCallback('https://app/cb?state=abc'),
    ).rejects.toMatchObject({ code: AuthErrorCode.CALLBACK_ERROR });
  });

  it('throws when the redeem endpoint returns no access_token', async () => {
    const transport = makeSequencedTransport([{ error: 'code_expired' }]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: transport as never,
      enableRefreshToken: false,
    });
    await expect(
      client.handleOidcCallback(
        'https://accounts.nuria.com.br/sso/callback?oidc_code=stale',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.CALLBACK_ERROR });
  });
});
