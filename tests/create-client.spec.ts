import { describe, it, expect, vi } from 'vitest';
import { createAuthClient } from '../src/client/create-client';
import { AuthError, AuthErrorCode, MemoryStorageAdapter } from '../src';

const BASE_CONFIG = {
  clientId: 'test-client',
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

  it('throws INVALID_CONFIG when clientId is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...BASE_CONFIG, clientId: undefined } as any;
    expect(() => createAuthClient(bad)).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('throws INVALID_CONFIG when authorizationEndpoint is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...BASE_CONFIG, authorizationEndpoint: undefined } as any;
    expect(() => createAuthClient(bad)).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('throws INVALID_CONFIG when tokenEndpoint is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...BASE_CONFIG, tokenEndpoint: undefined } as any;
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

  it('getSession returns null by default', () => {
    const client = createAuthClient(BASE_CONFIG);
    expect(client.getSession()).toBeNull();
  });

  it('getAccessToken returns null when no session', async () => {
    const client = createAuthClient(BASE_CONFIG);
    expect(await client.getAccessToken()).toBeNull();
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

  it('logout clears session and redirects to logoutEndpoint', async () => {
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
    await client.logout({ returnTo: 'https://app.example.com' });

    expect(client.getSession()).toBeNull();
    expect(capturedLogoutUrl).toContain('https://auth.example.com/logout');
    expect(capturedLogoutUrl).toContain('returnTo=https');
  });

  it('logout throws INVALID_CONFIG for protocol-relative returnTo', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(
      client.logout({ returnTo: '//evil.com/steal' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
  });

  it('logout throws INVALID_CONFIG for non-http returnTo', async () => {
    const client = createAuthClient(BASE_CONFIG);
    await expect(
      client.logout({ returnTo: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
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

  it('getUserinfo throws INVALID_CONFIG when userinfoEndpoint is not configured', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({
        tokens: { accessToken: 'tok' },
        createdAt: Date.now(),
      }),
    );

    const client = createAuthClient({ ...BASE_CONFIG, storage });
    await expect(client.getUserinfo()).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
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
  });
});
