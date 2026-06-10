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

/**
 * v8-aware transport: answers the token endpoint with an access-token payload
 * (so the cookie-bootstrap refresh succeeds) and every other URL with `data`.
 */
function makeAuthedTransport(data: Record<string, unknown> = {}) {
  return {
    request: vi.fn().mockImplementation(async (url: string) => ({
      status: 200,
      data:
        url === BASE_CONFIG.tokenEndpoint || url.endsWith('/v2/oauth/token')
          ? { access_token: 'boot-tok', token_type: 'Bearer', expires_in: 3600 }
          : data,
      headers: new Headers(),
    })),
  };
}

/** Seeds the v8 "has session" marker so init() bootstraps an in-memory token. */
function authedStorage() {
  const storage = new MemoryStorageAdapter();
  void storage.set('nuria:auth:has_session', '1');
  return storage;
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

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/oauth/token');
  });

  it('throws INVALID_CONFIG when baseUrl is invalid and endpoints are omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = {
      ...BASE_CONFIG,
      baseUrl: 'not-url',
      authorizationEndpoint: undefined,
      tokenEndpoint: undefined,
    } as any;
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
    const now = vi.fn().mockReturnValue(2_000_000_000_000);
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:auth:has_session', '1');
    // The cookie bootstrap returns an already-expired access token (a past ms
    // timestamp). With refresh enabled, isAuthenticated stays true because
    // getAccessToken would silently renew it.
    const transport = makeMockTransport({
      access_token: 'expired-token',
      expiresAt: 1_000_000_000_000,
    });

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now,
      enableRefreshToken: true,
    });
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
    const now = vi.fn().mockReturnValue(2_000_000_000_000);
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:auth:has_session', '1');

    // The token endpoint always hands back an already-expired token (a past ms
    // timestamp, > 1e12 so it's read as milliseconds). The cookie bootstrap
    // mints it; then getAccessToken, with refresh enabled by default, sees it
    // expired and refreshes again — proving refresh is on without an explicit
    // enableRefreshToken flag.
    const transport = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: { access_token: 'refreshed', expiresAt: 1_500_000_000_000 },
        headers: new Headers(),
      }),
    };

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now,
    });
    await client.init();

    const token = await client.getAccessToken();
    expect(token).toBe('refreshed');
    // init() bootstrap + the getAccessToken refresh = at least 2 token calls,
    // confirming the near-expiry refresh actually fired.
    expect(transport.request.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('getAccessToken does not bootstrap (no network call) when the authed marker is absent', async () => {
    // v8: tokens are never stored. With no "has session" marker at rest, the
    // SDK is genuinely anonymous — getAccessToken returns null immediately and
    // must NOT attempt a cookie-based refresh against the token endpoint.
    const storage = new MemoryStorageAdapter();
    const transport = makeMockTransport({ access_token: 'should-not-be-used' });

    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });
    const token = await client.getAccessToken();

    expect(token).toBeNull();
    expect(transport.request).not.toHaveBeenCalled();
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

  it('revokeSession POSTs /v2/logout with credentials and an empty body (cookie-identified)', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const transport = makeMockTransport({
      access_token: 'tok',
    });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );

    transport.request.mockClear();
    await client.revokeSession();

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/logout');
    expect(calls[0]![1].method).toBe('POST');
    // v8: the refresh token lives only in the HttpOnly __Host-nuria_rt cookie,
    // so the session is identified via credentials:'include' and the body is
    // empty — no refresh token is ever placed in JS.
    expect(calls[0]![1].credentials).toBe('include');
    expect(calls[0]![1].body).toEqual({});
    // revokeSession is server-side only — local session must survive so the
    // caller can sequence revoke→logout.
    expect(client.getSession()).not.toBeNull();
  });

  it('revokeSession sends credentials and an empty body even with no in-memory session', async () => {
    const storage = new MemoryStorageAdapter();
    const transport = makeMockTransport({});
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.revokeSession();

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/logout');
    expect(calls[0]![1].credentials).toBe('include');
    expect(calls[0]![1].body).toEqual({});
  });

  it('revokeSession swallows transport errors (best-effort)', async () => {
    const storage = new MemoryStorageAdapter();
    const transport = {
      request: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await expect(client.revokeSession()).resolves.toBeUndefined();
    expect(transport.request).toHaveBeenCalledOnce();
  });

  it('revokeAllSessions POSTs /v2/logout/global with Bearer + empty body', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const transport = makeMockTransport({
      access_token: 'tok-abc',
      refresh_token: 'r-1',
    });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );

    transport.request.mockClear();
    await client.revokeAllSessions();

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/logout/global');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].headers).toEqual({ Authorization: 'Bearer tok-abc' });
    // Local session must survive — same contract as revokeSession (caller
    // sequences revoke→logout and would lose the access token mid-flight
    // if we cleared here).
    expect(client.getSession()).not.toBeNull();
  });

  it('revokeAllSessions sends no Authorization header when no access token', async () => {
    const storage = new MemoryStorageAdapter();
    const transport = makeMockTransport({});
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.revokeAllSessions();

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].headers).toBeUndefined();
  });

  it('revokeAllSessions swallows transport errors (best-effort)', async () => {
    const storage = new MemoryStorageAdapter();
    const transport = {
      request: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await expect(client.revokeAllSessions()).resolves.toBeUndefined();
    expect(transport.request).toHaveBeenCalledOnce();
  });

  it('lookupDeviceUserCode GETs /v2/oauth/device with the user_code query', async () => {
    const transport = makeMockTransport({
      user_code: 'WDJB-MJHT',
      client_id: 'app-1',
      client_name: 'Nuria CLI',
      scope: 'openid profile',
      expires_at: '2026-04-30T18:30:00Z',
    });
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    const result = await client.lookupDeviceUserCode('WDJB-MJHT');

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(
      'https://auth.example.com/v2/oauth/device?user_code=WDJB-MJHT',
    );
    expect(calls[0]![1].method).toBe('GET');
    expect(result).toEqual({
      userCode: 'WDJB-MJHT',
      clientId: 'app-1',
      clientName: 'Nuria CLI',
      scope: 'openid profile',
      expiresAt: '2026-04-30T18:30:00Z',
    });
  });

  it('lookupDeviceUserCode rejects empty userCode', async () => {
    const transport = makeMockTransport({});
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    await expect(client.lookupDeviceUserCode('')).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('approveDeviceUserCode POSTs /v2/oauth/device/approve with Bearer + body', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    const transport = makeMockTransport({
      access_token: 'tok-abc',
      refresh_token: 'r-1',
    });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    transport.request.mockClear();
    transport.request.mockResolvedValueOnce({
      status: 200,
      data: { approved: true },
      headers: new Headers(),
    });

    await client.approveDeviceUserCode('WDJB-MJHT');

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(
      'https://auth.example.com/v2/oauth/device/approve',
    );
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].headers).toEqual({ Authorization: 'Bearer tok-abc' });
    expect(calls[0]![1].body).toEqual({ userCode: 'WDJB-MJHT' });
  });

  it('approveDeviceUserCode rejects when there is no active session', async () => {
    const storage = new MemoryStorageAdapter();
    const transport = makeMockTransport({});
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await expect(
      client.approveDeviceUserCode('WDJB-MJHT'),
    ).rejects.toMatchObject({ code: AuthErrorCode.UNAUTHENTICATED });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('denyDeviceUserCode POSTs /v2/oauth/device/deny with Bearer + body', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    const transport = makeMockTransport({
      access_token: 'tok-xyz',
      refresh_token: 'r-2',
    });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    transport.request.mockClear();
    transport.request.mockResolvedValueOnce({
      status: 200,
      data: { denied: true },
      headers: new Headers(),
    });

    await client.denyDeviceUserCode('WDJB-MJHT');

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/oauth/device/deny');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].headers).toEqual({ Authorization: 'Bearer tok-xyz' });
    expect(calls[0]![1].body).toEqual({ userCode: 'WDJB-MJHT' });
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
    // v8: establish the in-memory token via the cookie bootstrap, then call
    // userinfo. The URL-aware transport answers /token with an access token
    // and the userinfo endpoint with the profile payload.
    const storage = authedStorage();
    const transport = makeAuthedTransport({
      sub: 'user-123',
      email: 'user@example.com',
    });

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      userinfoEndpoint: 'https://auth.example.com/userinfo',
    });
    await client.init();

    const userinfo = await client.getUserinfo();
    expect(userinfo).toEqual({ sub: 'user-123', email: 'user@example.com' });

    const calls = transport.request.mock.calls as Array<[string, unknown]>;
    const userinfoCall = calls.find(([url]) => url.includes('userinfo'));
    expect(userinfoCall).toBeDefined();
  });

  it('getUserinfo uses default userinfoEndpoint when none is provided', async () => {
    const storage = new MemoryStorageAdapter();
    void storage.set('nuria:auth:has_session', '1');

    // baseUrl-derived endpoints: token bootstrap hits /v2/oauth/token, userinfo
    // defaults to /v2/oauth/userinfo.
    const transport = {
      request: vi.fn().mockImplementation(async (url: string) => ({
        status: 200,
        data: url.endsWith('/v2/oauth/token')
          ? { access_token: 'boot-tok', token_type: 'Bearer', expires_in: 3600 }
          : { sub: 'user-1' },
        headers: new Headers(),
      })),
    };

    // No userinfoEndpoint → createAuthClient defaults to baseUrl + /v2/oauth/userinfo
    const client = createAuthClient({
      clientId: 'test-client',
      baseUrl: 'https://auth.nuria.com.br',
      redirectUri: 'https://app.example.com/callback',
      storage,
      transport,
    });
    await client.init();

    const result = await client.getUserinfo();
    expect(result).toEqual({ sub: 'user-1' });

    const calls = transport.request.mock.calls as Array<[string, unknown]>;
    const userinfoCall = calls.find(([url]) =>
      url.endsWith('/v2/oauth/userinfo'),
    );
    expect(userinfoCall).toBeDefined();
  });

  it('checkSession returns false when not authenticated', async () => {
    const client = createAuthClient(BASE_CONFIG);
    expect(await client.checkSession()).toBe(false);
  });

  it('checkSession returns true when server responds 200', async () => {
    const storage = authedStorage();
    const transport = makeAuthedTransport({ sub: 'user-123' });
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      userinfoEndpoint: 'https://auth.example.com/userinfo',
    });
    await client.init();
    expect(await client.checkSession()).toBe(true);
  });

  it('checkSession clears session and returns false when server rejects token', async () => {
    // v8: bootstrap a real in-memory session (token endpoint succeeds), then
    // have the userinfo probe reject — checkSession must clear the session.
    const storage = authedStorage();
    const transport = {
      request: vi.fn().mockImplementation(async (url: string) => {
        if (url === BASE_CONFIG.tokenEndpoint) {
          return {
            status: 200,
            data: {
              access_token: 'boot-tok',
              token_type: 'Bearer',
              expires_in: 3600,
            },
            headers: new Headers(),
          };
        }
        throw new Error('Unauthorized');
      }),
    };
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      userinfoEndpoint: 'https://auth.example.com/userinfo',
    });
    await client.init();
    expect(client.getSession()).not.toBeNull();

    expect(await client.checkSession()).toBe(false);
    expect(client.isAuthenticated()).toBe(false);
    expect(client.getSession()).toBeNull();
  });

  it('checkSession returns true when session is valid and userinfo succeeds', async () => {
    const storage = authedStorage();
    const transport = makeAuthedTransport({});
    const client = createAuthClient({
      clientId: 'test-client',
      baseUrl: 'https://auth.example.com',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      redirectUri: 'https://app.example.com/callback',
      storage,
      transport,
    });
    await client.init();
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
    const INITIAL_NOW = 1_000_000_000;
    const now = vi.fn().mockReturnValue(INITIAL_NOW);

    const storage = authedStorage();

    // The token endpoint mints a token expiring 60s out (within the 5-min
    // buffer once we advance time). The bootstrap on init() establishes the
    // in-memory session; the two concurrent getAccessToken calls below must
    // coalesce into a SINGLE refresh.
    // expires_in is relative to now(): the bootstrap token (minted at
    // INITIAL_NOW) expires 60s later, well inside the 5-min refresh buffer
    // once we advance the clock below.
    const transport = {
      request: vi.fn().mockImplementation(async () => ({
        status: 200,
        data: { access_token: 'refreshed', expires_in: 60 },
        headers: new Headers(),
      })),
    };

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      enableRefreshToken: true,
      now,
    });
    await client.init(); // bootstrap call #1
    const callsAfterBootstrap = transport.request.mock.calls.length;

    // Advance time so the bootstrapped token is now inside the refresh buffer.
    now.mockReturnValue(INITIAL_NOW + 120_000);

    // Fire two concurrent getAccessToken calls — should only refresh once.
    const [t1, t2] = await Promise.all([
      client.getAccessToken(),
      client.getAccessToken(),
    ]);
    expect(t1).toBe(t2);
    expect(transport.request.mock.calls.length - callsAfterBootstrap).toBe(1);
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    const req = calls[calls.length - 1]![1];
    // v8: the refresh token is never in JS — it lives in the HttpOnly cookie,
    // so the refresh always rides credentials:'include' and carries no
    // refresh_token in the body.
    expect(req.credentials).toBe('include');
    const body = new URLSearchParams(req.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBeNull();
  });

  it('refresh always sends credentials:include and never a refresh_token body param', async () => {
    const INITIAL_NOW = 1_000_000_000;
    const now = vi.fn().mockReturnValue(INITIAL_NOW);
    const storage = authedStorage();
    // v8: the kernel-issued HttpOnly cookie is the only way to identify the
    // session, so the SDK must always ride ambient cookies and never embed a
    // refresh token in the request.
    const transport = {
      request: vi.fn().mockImplementation(async () => ({
        status: 200,
        data: { access_token: 'refreshed', expires_in: 60 },
        headers: new Headers(),
      })),
    };
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      enableRefreshToken: true,
      now,
    });
    await client.init();
    now.mockReturnValue(INITIAL_NOW + 120_000);
    await client.getAccessToken();
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    const req = calls[calls.length - 1]![1];
    expect(req.credentials).toBe('include');
    expect(
      new URLSearchParams(req.body as string).get('refresh_token'),
    ).toBeNull();
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
    expect(calls[0]![0]).toBe(
      'https://auth.example.com/v2/login-code/challenge',
    );
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].body).toEqual({
      email: 'user@example.com',
      channel: 'email',
      purpose: 'login',
    });
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
    // v8: the refresh token is stripped from the in-memory session — it lives
    // only in the HttpOnly __Host-nuria_rt cookie and never surfaces in JS.
    expect(session.tokens.refreshToken).toBeUndefined();
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
    // v8: refresh token is stripped from the in-memory session (cookie-only).
    expect(session.tokens.refreshToken).toBeUndefined();
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/login');
    expect(calls[0]![1].method).toBe('POST');
  });

  it('refresh works without refreshToken in session (cookie-first)', async () => {
    const INITIAL_NOW = 2_000_000_000;
    const now = vi.fn().mockReturnValue(INITIAL_NOW);
    const storage = authedStorage();

    const transport = {
      request: vi.fn().mockImplementation(async () => ({
        status: 200,
        data: { access_token: 'refreshed', expires_in: 60 },
        headers: new Headers(),
      })),
    };

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      enableRefreshToken: true,
      now,
    });
    await client.init();
    // Advance past the bootstrapped token's expiry window so getAccessToken refreshes.
    now.mockReturnValue(INITIAL_NOW + 120_000);

    const token = await client.getAccessToken();
    expect(token).toBe('refreshed');

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    const req = calls[calls.length - 1]![1];
    expect(req.credentials).toBe('include');
    const params = new URLSearchParams(req.body as string);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBeNull();
  });

  it('never keeps a refresh token in the in-memory session, even if one is returned', async () => {
    // v8 replaces the old "preserve previous refreshToken" behavior: the
    // refresh token is NEVER held in JS. Even when the token endpoint returns
    // a refresh_token, createSession strips it — the cookie is the only home.
    const INITIAL_NOW = 3_000_000_000;
    const now = vi.fn().mockReturnValue(INITIAL_NOW);
    const storage = authedStorage();

    const transport = {
      request: vi.fn().mockImplementation(async () => ({
        status: 200,
        data: {
          access_token: 'refreshed',
          refresh_token: 'rt-should-be-dropped',
          expires_in: 60,
        },
        headers: new Headers(),
      })),
    };

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      enableRefreshToken: true,
      now,
    });
    await client.init();
    expect(client.getSession()?.tokens.refreshToken).toBeUndefined();

    now.mockReturnValue(INITIAL_NOW + 120_000);
    await client.getAccessToken();
    expect(client.getSession()?.tokens.accessToken).toBe('refreshed');
    expect(client.getSession()?.tokens.refreshToken).toBeUndefined();
  });

  it('resetPassword calls POST /v2/password/reset with email', async () => {
    const transport = makeMockTransport();
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    await client.resetPassword({ email: 'user@example.com' });

    const [url, req] = transport.request.mock.calls[0] as [
      string,
      AuthTransportRequest,
    ];
    expect(url).toBe('https://auth.example.com/v2/password/reset');
    expect(req.method).toBe('POST');
    expect((req.body as Record<string, unknown>).email).toBe(
      'user@example.com',
    );
  });

  it('resetPassword throws when email is missing', async () => {
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: makeMockTransport(),
    });
    await expect(client.resetPassword({ email: '' })).rejects.toThrow(
      AuthError,
    );
  });

  it('recoverPassword calls POST /v2/password/recover with Bearer token', async () => {
    const transport = makeMockTransport();
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    await client.recoverPassword({
      token: 'reset-token',
      newPassword: 'NewPass1!',
    });

    const [url, req] = transport.request.mock.calls[0] as [
      string,
      AuthTransportRequest,
    ];
    expect(url).toBe('https://auth.example.com/v2/password/recover');
    expect(req.method).toBe('POST');
    expect(req.headers?.Authorization).toBe('Bearer reset-token');
    expect((req.body as Record<string, unknown>).newPassword).toBe('NewPass1!');
  });

  it('recoverPassword throws when token or newPassword is missing', async () => {
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: makeMockTransport(),
    });
    await expect(
      client.recoverPassword({ token: '', newPassword: 'x' }),
    ).rejects.toThrow(AuthError);
    await expect(
      client.recoverPassword({ token: 'tk', newPassword: '' }),
    ).rejects.toThrow(AuthError);
  });

  it('changePassword calls PATCH /v2/me/password with Bearer access token', async () => {
    // v8: the token endpoint mints 'active-token' for the cookie bootstrap;
    // changePassword then rides that in-memory token as a Bearer header.
    const transport = makeAuthedTransport({ success: true });
    transport.request = vi.fn().mockImplementation(async (url: string) => ({
      status: 200,
      data:
        url === BASE_CONFIG.tokenEndpoint
          ? {
              access_token: 'active-token',
              token_type: 'Bearer',
              expires_in: 3600,
            }
          : { success: true },
      headers: new Headers(),
    }));
    const storage = authedStorage();
    const client = createAuthClient({ ...BASE_CONFIG, transport, storage });
    await client.init();

    await client.changePassword({
      oldPassword: 'OldPass1!',
      newPassword: 'NewPass2!',
    });

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    const [url, req] = calls[calls.length - 1]!;
    expect(url).toBe('https://auth.example.com/v2/me/password');
    expect(req.method).toBe('PATCH');
    expect(req.headers?.Authorization).toBe('Bearer active-token');
    expect((req.body as Record<string, unknown>).oldPassword).toBe('OldPass1!');
    expect((req.body as Record<string, unknown>).newPassword).toBe('NewPass2!');
  });

  it('changePassword throws NOT_AUTHENTICATED when not logged in', async () => {
    const client = createAuthClient({
      ...BASE_CONFIG,
      transport: makeMockTransport(),
    });
    await expect(
      client.changePassword({
        oldPassword: 'OldPass1!',
        newPassword: 'NewPass2!',
      }),
    ).rejects.toThrow(AuthError);
  });

  it('sendMagicLink calls POST /v2/login/magic/send with email', async () => {
    const transport = makeMockTransport({ success: true });
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    await client.sendMagicLink({ email: 'user@nuria.com.br' });

    const calls = transport.request.mock.calls as Array<[string, AuthTransportRequest]>;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/login/magic/send');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].body).toEqual({ email: 'user@nuria.com.br' });
  });

  it('sendMagicLink throws INVALID_CONFIG when email is missing', async () => {
    const client = createAuthClient({ ...BASE_CONFIG, transport: makeMockTransport() });
    await expect(client.sendMagicLink({ email: '' })).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
  });

  it('loginWithMagicLink calls POST /v2/login/magic/verify with credentials and creates session', async () => {
    const transport = makeMockTransport({
      Token: 'magic-access-token',
      ExpiresAt: Date.now() + 60_000,
    });
    const client = createAuthClient({ ...BASE_CONFIG, transport });

    const session = await client.loginWithMagicLink({ token: 'one-time-link-token' });

    expect(session.tokens.accessToken).toBe('magic-access-token');
    // v8: refresh token is never in JS
    expect(session.tokens.refreshToken).toBeUndefined();

    const calls = transport.request.mock.calls as Array<[string, AuthTransportRequest]>;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/login/magic/verify');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].credentials).toBe('include');
    expect(calls[0]![1].body).toEqual({ token: 'one-time-link-token' });
  });

  it('loginWithMagicLink throws INVALID_CONFIG when token is missing', async () => {
    const client = createAuthClient({ ...BASE_CONFIG, transport: makeMockTransport() });
    await expect(client.loginWithMagicLink({ token: '' })).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
  });
});
