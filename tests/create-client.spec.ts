import { describe, it, expect, vi } from 'vitest';
import { createNuriaAuthClient } from '../src/client/create-client';
import { AuthError, AuthErrorCode, MemoryStorageAdapter } from '../src';

function makeMockTransport(data: Record<string, unknown> = {}) {
  return {
    request: vi.fn().mockResolvedValue({
      status: 200,
      data,
      headers: new Headers(),
    }),
  };
}

describe('createNuriaAuthClient', () => {
  it('creates a client with redirect mode', () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    expect(client).toBeDefined();
    expect(typeof client.startLogin).toBe('function');
    expect(typeof client.isAuthenticated).toBe('function');
    expect(typeof client.getUserinfo).toBe('function');
  });

  it('creates a client with whitelabel mode', () => {
    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: { flow: 'password' },
    });
    expect(client).toBeDefined();
  });

  it('throws INVALID_CONFIG when mode is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => createNuriaAuthClient({} as any)).toThrow(AuthError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => createNuriaAuthClient({} as any)).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('isAuthenticated returns false by default', () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    expect(client.isAuthenticated()).toBe(false);
  });

  it('getSession returns null by default', () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    expect(client.getSession()).toBeNull();
  });

  it('getAccessToken returns null when no session', async () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    expect(await client.getAccessToken()).toBeNull();
  });

  it('onAuthStateChanged fires on signIn and logout', async () => {
    const transport = makeMockTransport({
      access_token: 'tok',
      refresh_token: 'rtok',
    });
    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: { flow: 'password' },
      transport,
    });

    const handler = vi.fn();
    const unsubscribe = client.onAuthStateChanged(handler);

    await client.signIn({ username: 'u', password: 'p' });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: expect.objectContaining({ accessToken: 'tok' }),
      }),
    );

    await client.logout();
    expect(handler).toHaveBeenLastCalledWith(null);

    unsubscribe();
    await client.signIn({ username: 'u', password: 'p' });
    expect(handler).toHaveBeenCalledTimes(2); // no more calls after unsubscribe
  });

  it('logout calls revoke endpoint for whitelabel mode', async () => {
    const transport = makeMockTransport({ access_token: 'tok' });
    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: {
        flow: 'password',
        authBaseUrl: 'https://auth.example.com',
        endpoints: { revoke: '/revoke' },
      },
      transport,
    });

    await client.signIn({ username: 'u', password: 'p' });
    await client.logout();

    const calls = transport.request.mock.calls as Array<[string, unknown]>;
    const revokeCall = calls.find(([url]) =>
      url.includes('/revoke'),
    );
    expect(revokeCall).toBeDefined();
  });

  it('logout does not call revoke if not authenticated', async () => {
    const transport = makeMockTransport();
    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: { flow: 'password' },
      transport,
    });

    await client.logout(); // no session
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('getUserinfo throws when not authenticated', async () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    await expect(client.getUserinfo()).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
  });

  it('getUserinfo fetches from userinfo endpoint', async () => {
    const storage = new MemoryStorageAdapter();
    const transport = {
      request: vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          data: { access_token: 'tok' },
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { sub: 'user-123', email: 'user@example.com' },
          headers: new Headers(),
        }),
    };

    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: { flow: 'password' },
      storage,
      transport,
    });

    await client.signIn({ username: 'u', password: 'p' });
    const userinfo = await client.getUserinfo();
    expect(userinfo).toEqual({ sub: 'user-123', email: 'user@example.com' });

    const calls = transport.request.mock.calls as Array<[string, unknown]>;
    const userinfoCall = calls.find(([url]) => url.includes('userinfo'));
    expect(userinfoCall).toBeDefined();
  });

  it('refresh throws when not enabled', async () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    await expect(client.refresh()).rejects.toMatchObject({
      code: AuthErrorCode.REFRESH_FAILED,
    });
  });

  it('buildAuthorizeUrl throws for whitelabel password flow', async () => {
    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: { flow: 'password' },
    });
    await expect(client.buildAuthorizeUrl()).rejects.toMatchObject({
      code: AuthErrorCode.UNSUPPORTED_OPERATION,
    });
  });

  it('signIn throws when mode is redirect', async () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    await expect(client.signIn({ username: 'u' })).rejects.toMatchObject({
      code: AuthErrorCode.UNSUPPORTED_MODE,
    });
  });

  it('handleRedirectCallback throws on error param', async () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/cb?error=access_denied',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.CALLBACK_ERROR });
  });

  it('logout throws INVALID_CONFIG for protocol-relative returnTo', async () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    await expect(
      client.logout({ returnTo: '//evil.com/steal' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
  });

  it('logout throws INVALID_CONFIG for non-http returnTo', async () => {
    const client = createNuriaAuthClient({ mode: 'redirect' });
    await expect(
      client.logout({ returnTo: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
  });

  it('calls onRevocationError when revocation fails', async () => {
    const onRevocationError = vi.fn();
    const transport = {
      request: vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { access_token: 'tok' }, headers: new Headers() })
        .mockRejectedValueOnce(new Error('revocation failed')),
    };
    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: {
        flow: 'password',
        authBaseUrl: 'https://auth.example.com',
        endpoints: { revoke: '/revoke' },
        onRevocationError,
      },
      transport,
    });

    await client.signIn({ username: 'u', password: 'p' });
    await client.logout();
    expect(onRevocationError).toHaveBeenCalledOnce();
  });

  it('getAccessToken deduplicates concurrent refresh calls', async () => {
    let refreshCount = 0;
    const INITIAL_NOW = 1_000_000_000;
    const now = vi.fn().mockReturnValue(INITIAL_NOW);
    const transport = {
      request: vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/oauth2/token')) {
          refreshCount++;
          return { status: 200, data: { access_token: 'refreshed', expires_in: 3600 }, headers: new Headers() };
        }
        // signIn response with a 60-second token
        return { status: 200, data: { access_token: 'initial', refresh_token: 'rt', expires_in: 60 }, headers: new Headers() };
      }),
    };
    const client = createNuriaAuthClient({
      mode: 'whitelabel',
      whitelabel: { flow: 'password' },
      transport,
      enableRefreshToken: true,
      now,
    });

    // Establish a session — expiresAt = INITIAL_NOW + 60_000
    await client.signIn({ username: 'u', password: 'p' });
    // Advance time past token expiry
    now.mockReturnValue(INITIAL_NOW + 120_000);

    // Fire two concurrent getAccessToken calls — should only refresh once
    const [t1, t2] = await Promise.all([client.getAccessToken(), client.getAccessToken()]);
    expect(t1).toBe(t2);
    expect(refreshCount).toBe(1);
  });
});
