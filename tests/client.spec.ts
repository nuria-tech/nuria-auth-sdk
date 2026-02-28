import { describe, expect, it } from 'vitest';
import {
  createNuriaAuthClient,
  MemoryStorageAdapter,
  AuthErrorCode,
  type AuthTransportRequest,
  type AuthTransportResponse,
} from '../src';

describe('NuriaAuthClient', () => {
  it('builds authorize URL and applies custom mapper', async () => {
    const client = createNuriaAuthClient({
      mode: 'redirect',
      redirectUri: 'https://app.example.com/callback',
      redirect: {
        accountsBaseUrl: 'https://accounts.example.com',
        authorizePath: '/authz',
        clientId: 'my-client',
        scope: ['openid'],
        authorizeParamsMapper(base, options) {
          return {
            ...base,
            idp: options.provider ?? 'google',
          };
        },
      },
    });

    const url = await client.buildAuthorizeUrl({
      provider: 'google',
      extraParams: { theme: 'dark' },
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://accounts.example.com');
    expect(parsed.pathname).toBe('/authz');
    expect(parsed.searchParams.get('client_id')).toBe('my-client');
    expect(parsed.searchParams.get('idp')).toBe('google');
    expect(parsed.searchParams.get('theme')).toBe('dark');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('uses whitelabel authorize endpoint for code_exchange authorize URL', async () => {
    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: {
        flow: 'code_exchange',
        authBaseUrl: 'https://ms-auth.example.com',
        endpoints: {
          authorize: '/oauth2/authorize-custom',
        },
      },
    });

    const url = await client.buildAuthorizeUrl();
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://ms-auth.example.com');
    expect(parsed.pathname).toBe('/oauth2/authorize-custom');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('rejects callback when state mismatches', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'expected-state');
    await storage.set('nuria:oauth:code_verifier', 'verifier');

    const client = createNuriaAuthClient({
      mode: 'redirect',
      storage,
      redirect: { accountsBaseUrl: 'https://accounts.example.com' },
    });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?code=abc&state=invalid-state',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.STATE_MISMATCH });
  });

  it('maps whitelabel password response through mapTokenResponse', async () => {
    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: {
        flow: 'password',
        mapTokenResponse(raw) {
          return {
            accessToken: raw.jwt as string,
            refreshToken: raw.refresh as string,
          };
        },
      },
      transport: {
        async request<T = unknown>(
          _url: string,
          _req?: AuthTransportRequest,
        ): Promise<AuthTransportResponse<T>> {
          return {
            status: 200,
            data: { jwt: 'access', refresh: 'refresh' } as unknown as T,
            headers: new Headers(),
          };
        },
      },
    });

    const session = await client.signIn({ username: 'u', password: 'p' });
    expect(session.tokens.accessToken).toBe('access');
    expect(session.tokens.refreshToken).toBe('refresh');
  });
});
