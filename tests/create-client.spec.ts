import { describe, it, expect, vi } from 'vitest';
import { createAuthClient } from '../src/client/create-client';
import { AuthError, AuthErrorCode, MemoryStorageAdapter } from '../src';
import type { AuthTransportRequest } from '../src/core/types';

const BASE_CONFIG = {
  clientId: 'test-client',
  baseUrl: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
};

function makeMockTransport(data: Record<string, unknown> = {}) {
  return {
    request: vi.fn().mockResolvedValue({
      status: 200,
      data,
      headers: new Headers(),
    }),
  };
}

describe('createAuthClient', () => {
  it('creates a client with all required config fields', () => {
    const client = createAuthClient(BASE_CONFIG);
    expect(client).toBeDefined();
    expect(typeof client.startLogin).toBe('function');
    expect(typeof client.handleRedirectCallback).toBe('function');
    expect(typeof client.getSession).toBe('function');
    expect(typeof client.getAccessToken).toBe('function');
    expect(typeof client.logout).toBe('function');
  });

  it('applies default scope when config.scope is omitted', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin();
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('scope')).toBe('openid profile email');
  });

  it('throws INVALID_CONFIG when clientId is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...BASE_CONFIG, clientId: undefined } as any;
    expect(() => createAuthClient(bad)).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('uses default endpoints when authorizationEndpoint/tokenEndpoint are omitted', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    const transport = makeMockTransport({ access_token: 'tok' });

    const client = createAuthClient({
      clientId: 'test-client',
      baseUrl: 'https://auth.example.com',
      redirectUri: 'https://app.example.com/callback',
      storage,
      transport,
    });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );

    const calls = transport.request.mock.calls as Array<[string, AuthTransportRequest]>;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/oauth/token');
  });

  it('throws INVALID_CONFIG when baseUrl is invalid and endpoints are omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...BASE_CONFIG, baseUrl: 'not-url', authorizationEndpoint: undefined, tokenEndpoint: undefined } as any;
    expect(() => createAuthClient(bad)).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('throws INVALID_CONFIG when redirectUri is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...BASE_CONFIG, redirectUri: undefined } as any;
    expect(() => createAuthClient(bad)).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('isAuthenticated returns false by default', () => {
    const client = createAuthClient(BASE_CONFIG);
    expect(client.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns false when session token is expired', async () => {
    const now = vi.fn().mockReturnValue(2_000_000);
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({
        tokens: {
          accessToken: 'expired-token',
          expiresAt: 1_000_000,
        },
        createdAt: 1_000_000,
      }),
    );

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      now,
      enableRefreshToken: false,
    });
    await client.getAccessToken();

    expect(client.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true when token is expired but enableRefreshToken is true', async () => {
    const now = vi.fn().mockReturnValue(2_000_000);
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({
        tokens: { accessToken: 'expired-token', expiresAt: 1_000_000 },
        createdAt: 1_000_000,
      }),
    );

    const client = createAuthClient({ ...BASE_CONFIG, storage, now, enableRefreshToken: true });
    await client.init();

    expect(client.isAuthenticated()).toBe(true);
  });

  it('getSession returns null by default', () => {
    const client = createAuthClient(BASE_CONFIG);
    expect(client.getSession()).toBeNull();
  });

  it('getAccessToken returns null when no session', async () => {
    const client = createAuthClient(BASE_CONFIG);
    expect(await client.getAccessToken()).toBeNull();
  });

  it('enables refresh by default when enableRefreshToken is omitted', async () => {
    const now = vi.fn().mockReturnValue(1_000_000);
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({
        tokens: {
          accessToken: 'old',
          refreshToken: 'rt-old',
          expiresAt: 999_000,
        },
        createdAt: 1_000_000,
      }),
    );

    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: { access_token: 'refreshed', expires_in: 3600 },
        headers: new Headers(),
      }),
    };

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now,
    });

    const token = await client.getAccessToken();
    expect(token).toBe('refreshed');
  });

  it('getAccessToken returns null and clears storage when stored session is malformed', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:session', JSON.stringify({ notTokens: true }));

    const client = createAuthClient({ ...BASE_CONFIG, storage });
    const token = await client.getAccessToken();

    expect(token).toBeNull();
    expect(await storage.get('nuria:session')).toBeNull();
  });

  it('onAuthStateChanged fires after handleRedirectCallback and logout', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const transport = makeMockTransport({ access_token: 'tok' });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    const handler = vi.fn();
    const unsubscribe = client.onAuthStateChanged(handler);

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: expect.objectContaining({ accessToken: 'tok' }),
      }),
    );

    await client.logout();
    expect(handler).toHaveBeenLastCalledWith(null);

    // After unsubscribe, no more calls
    unsubscribe();
    const handler2ndCallCount = handler.mock.calls.length;
    await client.logout();
    expect(handler.mock.calls.length).toBe(handler2ndCallCount);
  });

  it('globalLogout clears session and redirects to logoutEndpoint', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    const transport = makeMockTransport({ access_token: 'tok' });

    let capturedLogoutUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      logoutEndpoint: 'https://auth.example.com/logout',
      onRedirect: (url) => {
        capturedLogoutUrl = url;
      },
    });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    await client.globalLogout({ returnTo: 'https://app.example.com' });

    expect(client.getSession()).toBeNull();
    expect(capturedLogoutUrl).toContain('https://auth.example.com/logout');
    expect(capturedLogoutUrl).toContain('returnTo=https');
  });

  it('globalLogout throws INVALID_CONFIG for protocol-relative returnTo', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(
      client.globalLogout({ returnTo: '//evil.com/steal' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
  });

  it('globalLogout throws INVALID_CONFIG for non-http returnTo', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(
      client.globalLogout({ returnTo: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
  });

  it('globalLogout throws INVALID_CONFIG for non-localhost http returnTo', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(
      client.globalLogout({ returnTo: 'http://evil.example.com/path' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
  });

  it('globalLogout accepts localhost http returnTo', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(
      client.globalLogout({ returnTo: 'http://localhost:3000/callback' }),
    ).resolves.toBeUndefined();
  });

  it('createAuthClient rejects http logoutEndpoint outside localhost', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        logoutEndpoint: 'http://malicious.example.com/logout',
      }),
    ).toThrow(/logoutEndpoint must use https/);
  });

  it('createAuthClient rejects malformed logoutEndpoint', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        logoutEndpoint: 'not a url',
      }),
    ).toThrow(/logoutEndpoint must be a valid absolute URL/);
  });

  it('createAuthClient rejects javascript: logoutEndpoint', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        logoutEndpoint: 'javascript:alert(1)',
      }),
    ).toThrow(/logoutEndpoint must use https/);
  });

  it('createAuthClient accepts https logoutEndpoint', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        logoutEndpoint: 'https://auth.example.com/logout',
      }),
    ).not.toThrow();
  });

  it('createAuthClient accepts http logoutEndpoint on localhost', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        logoutEndpoint: 'http://localhost:5000/logout',
      }),
    ).not.toThrow();
  });

  it('getUserinfo throws when not authenticated', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(client.getUserinfo()).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
  });

  it('getUserinfo fetches from userinfoEndpoint', async () => {
    const storage = new MemoryStorageAdapter();
    // Hydrate session directly
    await storage.set(
      'nuria:session',
      JSON.stringify({
        tokens: { accessToken: 'tok' },
        createdAt: Date.now(),
      }),
    );

    const transport = makeMockTransport({
      sub: 'user-123',
      email: 'user@example.com',
    });

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      userinfoEndpoint: 'https://auth.example.com/userinfo',
    });

    const userinfo = await client.getUserinfo();
    expect(userinfo).toEqual({ sub: 'user-123', email: 'user@example.com' });

    const calls = transport.request.mock.calls as Array<[string, unknown]>;
    const userinfoCall = calls.find(([url]) =>
      url.includes('userinfo'),
    );
    expect(userinfoCall).toBeDefined();
  });

  it('getUserinfo uses default userinfoEndpoint when none is provided', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({
        tokens: { accessToken: 'tok' },
        createdAt: Date.now(),
      }),
    );

    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: { sub: 'user-1' },
        headers: new Headers(),
      }),
    };

    // BASE_CONFIG has explicit tokenEndpoint/authorizationEndpoint but no userinfoEndpoint
    // createAuthClient should default to baseUrl + /v2/oauth/userinfo
    const client = createAuthClient({
      clientId: 'test-client',
      baseUrl: 'https://ms-auth-v2.nuria.com.br',
      redirectUri: 'https://app.example.com/callback',
      storage,
      transport,
    });

    const result = await client.getUserinfo();
    expect(result).toEqual({ sub: 'user-1' });

    const calls = transport.request.mock.calls as Array<[string, unknown]>;
    expect(calls[0]![0]).toBe('https://ms-auth-v2.nuria.com.br/v2/oauth/userinfo');
  });

  it('checkSession returns false when not authenticated', async () => {
    const client = createAuthClient(BASE_CONFIG);
    expect(await client.checkSession()).toBe(false);
  });

  it('checkSession returns true when server responds 200', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({ tokens: { accessToken: 'tok' }, createdAt: Date.now() }),
    );
    const transport = makeMockTransport({ sub: 'user-123' });
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      userinfoEndpoint: 'https://auth.example.com/userinfo',
    });
    expect(await client.checkSession()).toBe(true);
  });

  it('checkSession clears session and returns false when server rejects token', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({ tokens: { accessToken: 'tok' }, createdAt: Date.now() }),
    );
    const transport = {
      request: vi.fn().mockRejectedValue(new Error('Unauthorized')),
    };
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      userinfoEndpoint: 'https://auth.example.com/userinfo',
    });
    expect(await client.checkSession()).toBe(false);
    expect(client.isAuthenticated()).toBe(false);
    expect(client.getSession()).toBeNull();
  });

  it('checkSession returns true when session is valid and userinfo succeeds', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({ tokens: { accessToken: 'tok', expiresAt: Date.now() + 300_000 }, createdAt: Date.now() }),
    );
    const transport = makeMockTransport({});
    const client = createAuthClient({
      clientId: 'test-client',
      baseUrl: 'https://auth.example.com',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      redirectUri: 'https://app.example.com/callback',
      storage,
      transport,
    });
    expect(await client.checkSession()).toBe(true);
  });

  it('handleRedirectCallback throws on error param', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/cb?error=access_denied',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.CALLBACK_ERROR });
  });

  it('getAccessToken deduplicates concurrent refresh calls', async () => {
    let refreshCount = 0;
    const INITIAL_NOW = 1_000_000_000;
    const now = vi.fn().mockReturnValue(INITIAL_NOW);

    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({
        tokens: {
          accessToken: 'initial',
          refreshToken: 'rt',
          expiresAt: INITIAL_NOW + 60_000,
        },
        createdAt: INITIAL_NOW,
      }),
    );

    const transport = {
      request: vi.fn().mockImplementation(async () => {
        refreshCount++;
        return {
          status: 200,
          data: { access_token: 'refreshed', expires_in: 3600 },
          headers: new Headers(),
        };
      }),
    };

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      enableRefreshToken: true,
      now,
    });

    // Advance time past token expiry
    now.mockReturnValue(INITIAL_NOW + 120_000);

    // Fire two concurrent getAccessToken calls — should only refresh once
    const [t1, t2] = await Promise.all([
      client.getAccessToken(),
      client.getAccessToken(),
    ]);
    expect(t1).toBe(t2);
    expect(refreshCount).toBe(1);
    const req = (transport.request.mock.calls as Array<[string, AuthTransportRequest]>)[0]![1];
    expect(req.credentials).toBe('include');
  });

  it('startLoginCodeChallenge calls /v2/login-code/challenge with email default', async () => {
    const transport = makeMockTransport({
      challengeId: 'c1',
      channel: 'email',
      destinationMasked: 'u***@mail.com',
      expiresAt: 999999,
      purpose: 'login',
    });

    const client = createAuthClient({
      ...BASE_CONFIG,
      transport,
    });

    const challenge = await client.startLoginCodeChallenge({
      email: 'user@example.com',
    });

    expect(challenge.channel).toBe('email');
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/login-code/challenge');
    expect(calls[0]![1].method).toBe('POST');
  });

  it('verifyLoginCode creates session from backend token envelope', async () => {
    const transport = makeMockTransport({
      Token: 'access-from-2fa',
      ExpiresAt: Date.now() + 60_000,
      RefreshToken: 'refresh-from-2fa',
    });

    const client = createAuthClient({
      ...BASE_CONFIG,
      transport,
    });

    const session = await client.verifyLoginCode({
      challengeId: 'c1',
      code: '123456',
    });

    expect(session.tokens.accessToken).toBe('access-from-2fa');
    expect(session.tokens.refreshToken).toBe('refresh-from-2fa');
  });

  it('loginWithCodeSent is an alias of startLoginCodeChallenge', async () => {
    const transport = makeMockTransport({
      challengeId: 'c2',
      channel: 'email',
      destinationMasked: 'u***@mail.com',
      expiresAt: 999999,
      purpose: 'login',
    });

    const client = createAuthClient({ ...BASE_CONFIG, transport });
    const challenge = await client.loginWithCodeSent({
      email: 'user@example.com',
    });

    expect(challenge.challengeId).toBe('c2');
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/login-code/challenge');
  });

  it('completeLoginWithCode is an alias of verifyLoginCode', async () => {
    const transport = makeMockTransport({
      Token: 'access-from-alias',
      ExpiresAt: Date.now() + 60_000,
      RefreshToken: 'refresh-from-alias',
    });

    const client = createAuthClient({ ...BASE_CONFIG, transport });
    const session = await client.completeLoginWithCode({
      challengeId: 'c3',
      code: '654321',
    });

    expect(session.tokens.accessToken).toBe('access-from-alias');
  });

  it('loginWithGoogle calls /v2/google and creates session', async () => {
    const transport = makeMockTransport({
      Token: 'google-access',
      RefreshToken: 'google-refresh',
      ExpiresAt: Date.now() + 60_000,
    });
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    const session = await client.loginWithGoogle({
      idToken: 'google-id-token',
    });

    expect(session.tokens.accessToken).toBe('google-access');
    expect(session.tokens.refreshToken).toBe('google-refresh');
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/google');
    expect(calls[0]![1].method).toBe('POST');
  });

  it('loginWithPassword calls /v2/login and creates session', async () => {
    const transport = makeMockTransport({
      Token: 'password-access',
      RefreshToken: 'password-refresh',
      ExpiresAt: Date.now() + 60_000,
    });
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    const session = await client.loginWithPassword({
      email: 'user@example.com',
      password: 'secret',
    });

    expect(session.tokens.accessToken).toBe('password-access');
    expect(session.tokens.refreshToken).toBe('password-refresh');
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/login');
    expect(calls[0]![1].method).toBe('POST');
  });

  it('refresh works without refreshToken in session (cookie-first)', async () => {
    const INITIAL_NOW = 2_000_000_000;
    const now = vi.fn().mockReturnValue(INITIAL_NOW + 120_000);
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({
        tokens: {
          accessToken: 'initial',
          expiresAt: INITIAL_NOW + 60_000,
        },
        createdAt: INITIAL_NOW,
      }),
    );

    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: { access_token: 'refreshed', expires_in: 3600 },
        headers: new Headers(),
      }),
    };

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      enableRefreshToken: true,
      now,
    });

    const token = await client.getAccessToken();
    expect(token).toBe('refreshed');

    const req = (transport.request.mock.calls as Array<[string, AuthTransportRequest]>)[0]![1];
    expect(req.credentials).toBe('include');
    const params = new URLSearchParams(req.body as string);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBeNull();
  });

  it('preserves previous refreshToken when refresh response omits it', async () => {
    const INITIAL_NOW = 3_000_000_000;
    const now = vi.fn().mockReturnValue(INITIAL_NOW + 120_000);
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({
        tokens: {
          accessToken: 'initial',
          refreshToken: 'rt-old',
          expiresAt: INITIAL_NOW + 60_000,
        },
        createdAt: INITIAL_NOW,
      }),
    );

    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: { access_token: 'refreshed', expires_in: 3600 },
        headers: new Headers(),
      }),
    };

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      enableRefreshToken: true,
      now,
    });

    await client.getAccessToken();
    expect(client.getSession()?.tokens.refreshToken).toBe('rt-old');
  });

  it('resetPassword calls POST /v2/password/reset with email', async () => {
    const transport = makeMockTransport();
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    await client.resetPassword({ email: 'user@example.com' });

    const [url, req] = transport.request.mock.calls[0] as [string, AuthTransportRequest];
    expect(url).toBe('https://auth.example.com/v2/password/reset');
    expect(req.method).toBe('POST');
    expect((req.body as Record<string, unknown>).email).toBe('user@example.com');
  });

  it('resetPassword throws when email is missing', async () => {
    const client = createAuthClient({ ...BASE_CONFIG, transport: makeMockTransport() });
    await expect(client.resetPassword({ email: '' })).rejects.toThrow(AuthError);
  });

  it('recoverPassword calls POST /v2/password/recover with Bearer token', async () => {
    const transport = makeMockTransport();
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    await client.recoverPassword({ token: 'reset-token', newPassword: 'NewPass1!' });

    const [url, req] = transport.request.mock.calls[0] as [string, AuthTransportRequest];
    expect(url).toBe('https://auth.example.com/v2/password/recover');
    expect(req.method).toBe('POST');
    expect(req.headers?.Authorization).toBe('Bearer reset-token');
    expect((req.body as Record<string, unknown>).newPassword).toBe('NewPass1!');
  });

  it('recoverPassword throws when token or newPassword is missing', async () => {
    const client = createAuthClient({ ...BASE_CONFIG, transport: makeMockTransport() });
    await expect(client.recoverPassword({ token: '', newPassword: 'x' })).rejects.toThrow(AuthError);
    await expect(client.recoverPassword({ token: 'tk', newPassword: '' })).rejects.toThrow(AuthError);
  });

  it('changePassword calls PATCH /v2/me/password with Bearer access token', async () => {
    const transport = makeMockTransport({ access_token: 'active-token', expires_in: 3600 });
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:session', JSON.stringify({
      tokens: { accessToken: 'active-token', expiresAt: Date.now() + 3_600_000 },
      createdAt: Date.now(),
    }));
    const client = createAuthClient({ ...BASE_CONFIG, transport, storage });

    await client.changePassword({ oldPassword: 'OldPass1!', newPassword: 'NewPass2!' });

    const [url, req] = transport.request.mock.calls[0] as [string, AuthTransportRequest];
    expect(url).toBe('https://auth.example.com/v2/me/password');
    expect(req.method).toBe('PATCH');
    expect(req.headers?.Authorization).toBe('Bearer active-token');
    expect((req.body as Record<string, unknown>).oldPassword).toBe('OldPass1!');
    expect((req.body as Record<string, unknown>).newPassword).toBe('NewPass2!');
  });

  it('changePassword throws NOT_AUTHENTICATED when not logged in', async () => {
    const client = createAuthClient({ ...BASE_CONFIG, transport: makeMockTransport() });
    await expect(
      client.changePassword({ oldPassword: 'OldPass1!', newPassword: 'NewPass2!' })
    ).rejects.toThrow(AuthError);
  });
});
