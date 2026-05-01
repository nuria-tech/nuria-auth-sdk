import { describe, expect, it, vi } from 'vitest';
import {
  createAuthClient,
  MemoryStorageAdapter,
  AuthErrorCode,
  type AuthTransportRequest,
  type AuthTransportResponse,
} from '../src';

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

describe('AuthClient', () => {
  it('startLogin redirects to authorizationEndpoint with PKCE params', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin();
    const parsed = new URL(capturedUrl);

    expect(parsed.origin).toBe('https://auth.example.com');
    expect(parsed.pathname).toBe('/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('test-client');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/callback',
    );
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
    expect(parsed.searchParams.get('state')).toBeTruthy();
  });

  it('startLogin applies scopes from options', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin({ scopes: ['openid', 'profile'] });
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('scope')).toBe('openid profile');
  });

  it('startLogin applies scope from config', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      scope: 'openid email',
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin();
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('scope')).toBe('openid email');
  });

  it('startLogin applies extraParams', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin({
      extraParams: { ui_locales: 'pt-BR', prompt: 'login' },
    });
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('ui_locales')).toBe('pt-BR');
    expect(parsed.searchParams.get('prompt')).toBe('login');
  });

  it('startLogin applies typed prompt option', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin({ prompt: 'select_account' });
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('prompt')).toBe('select_account');
  });

  it('logout (default) arms a one-shot prompt=login on next startLogin', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.logout();
    await client.startLogin();
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('prompt')).toBe('login');
  });

  it('the force-relogin flag is one-shot — second startLogin omits prompt', async () => {
    const captured: string[] = [];
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        captured.push(url);
      },
    });

    await client.logout();
    await client.startLogin();
    await client.startLogin();
    expect(new URL(captured[0]!).searchParams.get('prompt')).toBe('login');
    expect(new URL(captured[1]!).searchParams.get('prompt')).toBeNull();
  });

  it('logout({ keepSso: true }) does NOT arm prompt=login', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.logout({ keepSso: true });
    await client.startLogin();
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('prompt')).toBeNull();
  });

  it('explicit options.prompt overrides the force-relogin marker', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.logout();
    await client.startLogin({ prompt: 'consent' });
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('preserves the force-relogin marker when onRedirect throws (retry-safe)', async () => {
    let capturedUrl = '';
    let throwOnce = true;
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error('boom');
        }
        capturedUrl = url;
      },
    });

    await client.logout();
    await expect(client.startLogin()).rejects.toThrow('boom');
    // First attempt threw — marker must still be armed.
    await client.startLogin();
    expect(new URL(capturedUrl).searchParams.get('prompt')).toBe('login');
  });

  it('keepSso clears any previously-armed force-relogin marker', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.logout(); // arms prompt=login
    await client.logout({ keepSso: true }); // disarms it
    await client.startLogin();
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('prompt')).toBeNull();
  });

  it('startLogin ignores scope in extraParams (scope is reserved)', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      scope: 'openid email',
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin({ extraParams: { scope: 'hacked' } });
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('scope')).toBe('openid email');
  });

  it('startLogin appends loginMethods as CSV query params (UI hint for accounts)', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      loginMethods: {
        enabled: ['password', 'google'],
        comingSoon: ['aws_sso', 'passwordless'],
      },
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin();
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('login_methods_enabled')).toBe(
      'password,google',
    );
    expect(parsed.searchParams.get('login_methods_coming_soon')).toBe(
      'aws_sso,passwordless',
    );
  });

  it('startLogin extraParams cannot override login_methods_* (reserved)', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      loginMethods: { enabled: ['password'], comingSoon: [] },
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin({
      extraParams: {
        login_methods_enabled: 'aws_sso',
        login_methods_coming_soon: 'aws_sso',
      },
    });
    const parsed = new URL(capturedUrl);
    // Reserved — extraParams must not clobber the SDK-controlled value.
    expect(parsed.searchParams.get('login_methods_enabled')).toBe('password');
    expect(parsed.searchParams.get('login_methods_coming_soon')).toBeNull();
  });

  it('startLogin applies loginHint', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin({ loginHint: 'user@example.com' });
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('login_hint')).toBe('user@example.com');
  });

  it('handleRedirectCallback rejects when state mismatches', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'expected-state');
    await storage.set('nuria:oauth:code_verifier', 'verifier');

    const client = createAuthClient({ ...BASE_CONFIG, storage });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?code=abc&state=invalid-state',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.STATE_MISMATCH });
  });

  it('handleRedirectCallback rejects when error param present', async () => {
    const client = createAuthClient({ ...BASE_CONFIG });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?error=access_denied',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.CALLBACK_ERROR });
  });

  it('handleRedirectCallback includes error_description in message when present', async () => {
    const client = createAuthClient({ ...BASE_CONFIG });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?error=access_denied&error_description=User+cancelled+login',
      ),
    ).rejects.toMatchObject({
      code: AuthErrorCode.CALLBACK_ERROR,
      message: expect.stringContaining('User cancelled login'),
    });
  });

  it('handleRedirectCallback rejects when missing code', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'test-state');

    const client = createAuthClient({ ...BASE_CONFIG, storage });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?state=test-state',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.MISSING_CODE });
  });

  it('handleRedirectCallback exchanges code and returns session', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'test-state');
    await storage.set('nuria:oauth:code_verifier', 'test-verifier');

    const transport = makeMockTransport({
      access_token: 'tok',
      token_type: 'Bearer',
      expires_in: 3600,
    });

    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });
    const session = await client.handleRedirectCallback(
      'https://app.example.com/callback?code=mycode&state=test-state',
    );

    expect(session.tokens.accessToken).toBe('tok');
    expect(session.tokens.tokenType).toBe('Bearer');

    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/token');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].credentials).toBe('include');

    const body = new URLSearchParams(calls[0]![1].body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('mycode');
    expect(body.get('code_verifier')).toBe('test-verifier');
    expect(body.get('client_id')).toBe('test-client');
  });

  it('handleRedirectCallback clears state and codeVerifier after success', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'test-state');
    await storage.set('nuria:oauth:code_verifier', 'test-verifier');

    const transport = makeMockTransport({ access_token: 'tok' });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=mycode&state=test-state',
    );

    expect(await storage.get('nuria:oauth:state')).toBeNull();
    expect(await storage.get('nuria:oauth:code_verifier')).toBeNull();
  });

  it('uses correct form-encoded body for token exchange', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const transport = makeMockTransport({ access_token: 'tok' });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );

    const req = (
      transport.request.mock.calls as Array<[string, AuthTransportRequest]>
    )[0]![1];
    expect(typeof req.body).toBe('string');
    expect(req.credentials).toBe('include');
    const params = new URLSearchParams(req.body as string);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('redirect_uri')).toBe('https://app.example.com/callback');
  });

  it('handleRedirectCallback rejects when codeVerifier missing in storage', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'test-state');
    // no code_verifier stored

    const client = createAuthClient({ ...BASE_CONFIG, storage });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?code=abc&state=test-state',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.TOKEN_EXCHANGE_FAILED });
  });

  it('handleRedirectCallback clears PKCE artifacts even when token exchange fails', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'test-state');
    await storage.set('nuria:oauth:code_verifier', 'test-verifier');
    const transport = {
      request: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?code=abc&state=test-state',
      ),
    ).rejects.toThrow('network down');

    // PKCE artifacts are always cleaned up (finally block) to prevent verifier reuse
    expect(await storage.get('nuria:oauth:state')).toBeNull();
    expect(await storage.get('nuria:oauth:code_verifier')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // getClaims
  // ---------------------------------------------------------------------------

  function makeJwt(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const body = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return `${header}.${body}.fake-sig`;
  }

  it('getClaims returns null when not authenticated', () => {
    const client = createAuthClient({ ...BASE_CONFIG });
    expect(client.getClaims()).toBeNull();
  });

  it('getClaims decodes JWT claims from access token', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const claims = {
      sub: 'user-1',
      email: 'user@example.com',
      roles: 'admin,editor',
      exp: 9999999999,
    };
    const transport = makeMockTransport({ access_token: makeJwt(claims) });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    const decoded = client.getClaims();

    expect(decoded?.sub).toBe('user-1');
    expect(decoded?.email).toBe('user@example.com');
    expect(decoded?.roles).toBe('admin,editor');
  });

  it('getClaims returns null for malformed access token', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const transport = makeMockTransport({
      access_token: 'not.a.valid-jwt-payload',
    });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(client.getClaims()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // hasRole / hasGroup
  // ---------------------------------------------------------------------------

  it('hasRole returns true when role is in comma-separated string', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const token = makeJwt({ roles: 'admin,editor,viewer' });
    const transport = makeMockTransport({ access_token: token });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(client.hasRole('admin')).toBe(true);
    expect(client.hasRole('editor')).toBe(true);
    expect(client.hasRole('superuser')).toBe(false);
  });

  it('hasRole returns true when roles claim is an array', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const token = makeJwt({ roles: ['admin', 'editor'] });
    const transport = makeMockTransport({ access_token: token });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(client.hasRole('admin')).toBe(true);
    expect(client.hasRole('superuser')).toBe(false);
  });

  it('hasRole returns false when not authenticated', () => {
    const client = createAuthClient({ ...BASE_CONFIG });
    expect(client.hasRole('admin')).toBe(false);
  });

  it('hasGroup returns true when group is in comma-separated string', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const token = makeJwt({ groups: 'rsd-users,rsd-admins' });
    const transport = makeMockTransport({ access_token: token });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(client.hasGroup('rsd-users')).toBe(true);
    expect(client.hasGroup('rsd-admins')).toBe(true);
    expect(client.hasGroup('other-group')).toBe(false);
  });

  it('hasGroup returns true when groups claim is an array', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const token = makeJwt({ groups: ['rsd-users', 'rsd-admins'] });
    const transport = makeMockTransport({ access_token: token });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(client.hasGroup('rsd-users')).toBe(true);
    expect(client.hasGroup('other-group')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Session.provider from auth_provider
  // ---------------------------------------------------------------------------

  it('session.provider is set from auth_provider in token response', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const transport = makeMockTransport({
      access_token: 'tok',
      auth_provider: 'google',
    });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    const session = await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(session.provider).toBe('google');
  });

  it('session.provider is set from authProvider (camelCase) in token response', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const transport = makeMockTransport({
      access_token: 'tok',
      authProvider: 'password',
    });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    const session = await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(session.provider).toBe('password');
  });

  // ---------------------------------------------------------------------------
  // init()
  // ---------------------------------------------------------------------------

  it('init() hydrates session from storage and notifies listeners', async () => {
    const storage = new MemoryStorageAdapter();
    const storedSession = {
      tokens: { accessToken: 'stored-tok', tokenType: 'Bearer' },
      createdAt: Date.now(),
      provider: 'google',
    };
    await storage.set('nuria:session', JSON.stringify(storedSession));

    const client = createAuthClient({ ...BASE_CONFIG, storage });
    const handler = vi.fn();
    client.onAuthStateChanged(handler);

    await client.init();

    expect(client.getSession()?.tokens.accessToken).toBe('stored-tok');
    expect(client.getSession()?.provider).toBe('google');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: expect.objectContaining({ accessToken: 'stored-tok' }),
      }),
    );
  });

  it('init() notifies listeners with null when storage is empty', async () => {
    const client = createAuthClient({ ...BASE_CONFIG });
    const handler = vi.fn();
    client.onAuthStateChanged(handler);

    await client.init();

    expect(client.getSession()).toBeNull();
    expect(handler).toHaveBeenCalledWith(null);
  });

  it('init() ignores malformed session in storage', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:session', 'not-valid-json{{{');

    const client = createAuthClient({ ...BASE_CONFIG, storage });
    await client.init();

    expect(client.getSession()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Cross-tab sync (BroadcastChannel)
  // ---------------------------------------------------------------------------

  it('broadcasts SESSION_SYNC after login', async () => {
    const postMessage = vi.spyOn(BroadcastChannel.prototype, 'postMessage');

    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const transport = makeMockTransport({ access_token: 'tok' });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );

    expect(postMessage).toHaveBeenCalledWith({
      type: 'SESSION_SYNC',
      session: expect.objectContaining({
        tokens: expect.objectContaining({ accessToken: 'tok' }),
      }),
    });

    postMessage.mockRestore();
  });

  it('init() does not broadcast session to other tabs', async () => {
    const postMessage = vi.spyOn(BroadcastChannel.prototype, 'postMessage');

    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({ tokens: { accessToken: 'tok' }, createdAt: Date.now() }),
    );

    const client = createAuthClient({ ...BASE_CONFIG, storage });
    await client.init();

    expect(postMessage).not.toHaveBeenCalled();

    postMessage.mockRestore();
  });

  it('updates session when SESSION_SYNC received from another tab', async () => {
    const client = createAuthClient({ ...BASE_CONFIG });
    const handler = vi.fn();
    client.onAuthStateChanged(handler);

    // Simulate a message arriving from another tab
    const channel = new BroadcastChannel('nuria:auth:sync');
    const incomingSession = {
      tokens: { accessToken: 'from-other-tab' },
      createdAt: Date.now(),
    };
    channel.postMessage({ type: 'SESSION_SYNC', session: incomingSession });

    // BroadcastChannel delivers async — allow microtasks to flush
    await new Promise((r) => setTimeout(r, 10));

    expect(client.getSession()?.tokens.accessToken).toBe('from-other-tab');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: expect.objectContaining({ accessToken: 'from-other-tab' }),
      }),
    );
    channel.close();
  });

  it('ignores SESSION_SYNC with malformed session shape', async () => {
    const client = createAuthClient({ ...BASE_CONFIG });
    const handler = vi.fn();
    client.onAuthStateChanged(handler);

    const channel = new BroadcastChannel('nuria:auth:sync');
    // Malformed — missing createdAt and tokens.accessToken
    channel.postMessage({ type: 'SESSION_SYNC', session: { evil: true } });

    await new Promise((r) => setTimeout(r, 10));

    expect(client.getSession()).toBeNull();
    expect(handler).not.toHaveBeenCalled();
    channel.close();
  });

  it('accepts SESSION_SYNC with null session (logout sync)', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(
      'nuria:session',
      JSON.stringify({ tokens: { accessToken: 'tok' }, createdAt: Date.now() }),
    );
    const client = createAuthClient({ ...BASE_CONFIG, storage });
    await client.init();

    expect(client.getSession()).not.toBeNull();

    const channel = new BroadcastChannel('nuria:auth:sync');
    channel.postMessage({ type: 'SESSION_SYNC', session: null });

    await new Promise((r) => setTimeout(r, 10));

    expect(client.getSession()).toBeNull();
    channel.close();
  });

  // ---------------------------------------------------------------------------
  // nonce (OIDC replay protection)
  // ---------------------------------------------------------------------------

  it('startLogin includes nonce in authorization URL', async () => {
    let capturedUrl = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    await client.startLogin();
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('nonce')).toBeTruthy();
  });

  it('startLogin stores nonce in storage', async () => {
    const storage = new MemoryStorageAdapter();
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      onRedirect: () => {},
    });

    await client.startLogin();
    expect(await storage.get('nuria:oauth:nonce')).toBeTruthy();
  });

  it('handleRedirectCallback rejects token without nonce claim when nonce was stored', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    await storage.set('nuria:oauth:nonce', 'my-nonce');

    // Server returns a plain token with no nonce claim — must be rejected
    const transport = makeMockTransport({ access_token: 'plain-token' });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?code=c&state=st',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.TOKEN_EXCHANGE_FAILED });
  });

  it('handleRedirectCallback rejects when token nonce does not match stored nonce', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    await storage.set('nuria:oauth:nonce', 'expected-nonce');

    const token = makeJwt({ sub: 'user-1', nonce: 'different-nonce' });
    const transport = makeMockTransport({ access_token: token });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?code=c&state=st',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.TOKEN_EXCHANGE_FAILED });
  });

  it('handleRedirectCallback accepts token when nonce matches stored nonce', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    await storage.set('nuria:oauth:nonce', 'correct-nonce');

    const token = makeJwt({ sub: 'user-1', nonce: 'correct-nonce' });
    const transport = makeMockTransport({ access_token: token });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    const session = await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(session.tokens.accessToken).toBe(token);
    expect(await storage.get('nuria:oauth:nonce')).toBeNull();
  });

  it('handleRedirectCallback clears nonce from storage after success', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    await storage.set('nuria:oauth:nonce', 'n1');

    const token = makeJwt({ sub: 'user-1', nonce: 'n1' });
    const transport = makeMockTransport({ access_token: token });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(await storage.get('nuria:oauth:nonce')).toBeNull();
  });

  it('handleRedirectCallback validates nonce from id_token when access token has no nonce claim', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    await storage.set('nuria:oauth:nonce', 'correct-nonce');

    const accessToken = makeJwt({ sub: 'user-1' }); // no nonce claim
    const idToken = makeJwt({ sub: 'user-1', nonce: 'correct-nonce' });
    const transport = makeMockTransport({
      access_token: accessToken,
      id_token: idToken,
    });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    const session = await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );
    expect(session.tokens.accessToken).toBe(accessToken);
    expect(await storage.get('nuria:oauth:nonce')).toBeNull();
  });

  it('handleRedirectCallback rejects when id_token nonce does not match and access token has no nonce', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    await storage.set('nuria:oauth:nonce', 'expected-nonce');

    const accessToken = makeJwt({ sub: 'user-1' }); // no nonce claim
    const idToken = makeJwt({ sub: 'user-1', nonce: 'wrong-nonce' });
    const transport = makeMockTransport({
      access_token: accessToken,
      id_token: idToken,
    });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?code=c&state=st',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.TOKEN_EXCHANGE_FAILED });
  });

  // ---------------------------------------------------------------------------
  // HTTPS enforcement
  // ---------------------------------------------------------------------------

  it('createAuthClient throws INVALID_CONFIG for http baseUrl (non-localhost)', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        baseUrl: 'http://evil.example.com',
        authorizationEndpoint: undefined,
        tokenEndpoint: undefined,
      } as never),
    ).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('createAuthClient accepts http://localhost as baseUrl', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        baseUrl: 'http://localhost:4000',
        authorizationEndpoint: 'http://localhost:4000/authorize',
        tokenEndpoint: 'http://localhost:4000/token',
      }),
    ).not.toThrow();
  });

  it('createAuthClient throws INVALID_CONFIG for http explicit endpoint (non-localhost)', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        tokenEndpoint: 'http://evil.example.com/token',
      }),
    ).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('createAuthClient throws INVALID_CONFIG for non-URL redirectUri', () => {
    expect(() =>
      createAuthClient({ ...BASE_CONFIG, redirectUri: 'not-a-url' }),
    ).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('createAuthClient throws INVALID_CONFIG for http redirectUri (non-localhost)', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        redirectUri: 'http://evil.example.com/callback',
      }),
    ).toThrowError(
      expect.objectContaining({ code: AuthErrorCode.INVALID_CONFIG }),
    );
  });

  it('createAuthClient accepts http://localhost redirectUri', () => {
    expect(() =>
      createAuthClient({
        ...BASE_CONFIG,
        redirectUri: 'http://localhost:3000/callback',
      }),
    ).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // getAccessToken — expiry when refresh disabled
  // ---------------------------------------------------------------------------

  it('getAccessToken returns null for expired token when enableRefreshToken is false', async () => {
    const storage = new MemoryStorageAdapter();
    const now = Date.now();
    const expiredSession = {
      tokens: { accessToken: 'expired-tok', expiresAt: now - 1000 },
      createdAt: now - 5000,
    };
    await storage.set('nuria:session', JSON.stringify(expiredSession));

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      enableRefreshToken: false,
    });
    await client.init();

    const token = await client.getAccessToken();
    expect(token).toBeNull();
    // Session should be cleared
    expect(client.getSession()).toBeNull();
  });

  it('getAccessToken returns valid token near expiry when enableRefreshToken is false', async () => {
    const storage = new MemoryStorageAdapter();
    const now = Date.now();
    // Token expires in 10s (within 30s window but not yet expired)
    const session = {
      tokens: { accessToken: 'almost-expired-tok', expiresAt: now + 10_000 },
      createdAt: now,
    };
    await storage.set('nuria:session', JSON.stringify(session));

    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      enableRefreshToken: false,
    });
    await client.init();

    const token = await client.getAccessToken();
    expect(token).toBe('almost-expired-tok');
  });

  it('loginWithAws posts idToken to /v2/sso/aws and stores the session', async () => {
    const storage = new MemoryStorageAdapter();
    const transport = makeMockTransport({
      access_token: 'aws-tok',
      token_type: 'Bearer',
      expires_in: 3600,
    });

    const client = createAuthClient({
      ...BASE_CONFIG,
      baseUrl: 'https://auth.example.com',
      storage,
      transport,
    });
    const session = await client.loginWithAws({ idToken: 'aws-id-token' });

    expect(session.tokens.accessToken).toBe('aws-tok');
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/sso/aws');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].credentials).toBe('include');
    expect(calls[0]![1].body).toEqual({ idToken: 'aws-id-token' });
  });

  it('loginWithAws rejects when idToken is missing', async () => {
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage: new MemoryStorageAdapter(),
    });
    await expect(client.loginWithAws({ idToken: '' })).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
  });

  it('loginWithGoogleCode posts code to /v2/google/code and stores the session', async () => {
    const storage = new MemoryStorageAdapter();
    const transport = makeMockTransport({
      access_token: 'g-code-tok',
      token_type: 'Bearer',
      expires_in: 3600,
    });

    const client = createAuthClient({
      ...BASE_CONFIG,
      baseUrl: 'https://auth.example.com',
      storage,
      transport,
    });
    const session = await client.loginWithGoogleCode({ code: '4/0Aabc' });

    expect(session.tokens.accessToken).toBe('g-code-tok');
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/google/code');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].credentials).toBe('include');
    expect(calls[0]![1].body).toEqual({ code: '4/0Aabc', redirectUri: undefined });
  });

  it('loginWithGoogleCode forwards redirectUri when provided', async () => {
    const transport = makeMockTransport({
      access_token: 'g-code-tok',
      token_type: 'Bearer',
      expires_in: 3600,
    });
    const client = createAuthClient({
      ...BASE_CONFIG,
      baseUrl: 'https://auth.example.com',
      storage: new MemoryStorageAdapter(),
      transport,
    });
    await client.loginWithGoogleCode({
      code: '4/0Aabc',
      redirectUri: 'https://accounts.nuria.com.br/google/callback',
    });
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    expect(calls[0]![1].body).toEqual({
      code: '4/0Aabc',
      redirectUri: 'https://accounts.nuria.com.br/google/callback',
    });
  });

  it('loginWithGoogleCode rejects when code is missing', async () => {
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage: new MemoryStorageAdapter(),
    });
    await expect(
      client.loginWithGoogleCode({ code: '' }),
    ).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
  });

  it('getLoginMethods returns the SDK defaults when none configured', async () => {
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage: new MemoryStorageAdapter(),
    });
    expect(client.getLoginMethods()).toEqual({
      enabled: ['password', 'google'],
      comingSoon: ['passwordless', 'aws_sso'],
    });
  });

  it('getLoginMethods merges partial overrides with defaults', async () => {
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage: new MemoryStorageAdapter(),
      // only override `enabled` — `comingSoon` should fall back to defaults
      loginMethods: { enabled: ['password', 'google', 'passwordless'] },
    });
    expect(client.getLoginMethods().enabled).toEqual([
      'password',
      'google',
      'passwordless',
    ]);
    // 'passwordless' got promoted to enabled, so it must be stripped from
    // the default comingSoon list to avoid double-rendering.
    expect(client.getLoginMethods().comingSoon).toEqual(['aws_sso']);
  });

  it('getLoginMethods drops unknown values, dedups, lowercases', async () => {
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage: new MemoryStorageAdapter(),
      loginMethods: {
        // intentional garbage to prove the resolver filters it
        enabled: ['PASSWORD', 'google', 'google', 'wat'] as never,
        comingSoon: [' aws_sso ', 'totally_unknown'] as never,
      },
    });
    expect(client.getLoginMethods()).toEqual({
      enabled: ['password', 'google'],
      comingSoon: ['aws_sso'],
    });
  });

  it('getLoginMethods returns a defensive copy', async () => {
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage: new MemoryStorageAdapter(),
    });
    const ref = client.getLoginMethods();
    ref.enabled.push('aws_sso');
    expect(client.getLoginMethods().enabled).toEqual(['password', 'google']);
  });

  it('does not auto-logout on 401 from a login attempt when no session exists', async () => {
    const storage = new MemoryStorageAdapter();
    const { FetchAuthTransport } =
      await import('../src/transport/fetch-transport');
    const fetchFn = vi.fn(
      async () =>
        new Response('{"error":"invalid_grant"}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const transport = new FetchAuthTransport({ fetchFn });
    const client = createAuthClient({
      ...BASE_CONFIG,
      baseUrl: 'https://auth.example.com',
      storage,
      transport,
    });

    const sessionListener = vi.fn();
    client.onAuthStateChanged(sessionListener);

    await expect(
      client.loginWithGoogle({ idToken: 'bad-id-token' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.HTTP_ERROR });

    // No active session, so the 401 must NOT cascade into a logout/notify.
    expect(sessionListener).not.toHaveBeenCalled();
  });

  it('does not auto-logout the active session on 401 from changePassword (wrong oldPassword)', async () => {
    const storage = new MemoryStorageAdapter();
    // Long-lived access token so getAccessToken short-circuits the refresh
    // path and we exercise the changePassword endpoint specifically.
    const session = {
      tokens: { accessToken: 'live-token', expiresAt: Date.now() + 3_600_000 },
      createdAt: Date.now(),
    };
    await storage.set('nuria:session', JSON.stringify(session));

    const { FetchAuthTransport } =
      await import('../src/transport/fetch-transport');
    const fetchFn = vi.fn(
      async () =>
        new Response('{"error":"invalid_credentials"}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const transport = new FetchAuthTransport({ fetchFn });
    const client = createAuthClient({
      ...BASE_CONFIG,
      baseUrl: 'https://auth.example.com',
      storage,
      transport,
    });
    await client.init();

    const sessionListener = vi.fn();
    client.onAuthStateChanged(sessionListener);

    await expect(
      client.changePassword({
        oldPassword: 'wrong',
        newPassword: 'new-strong-pass',
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.HTTP_ERROR });

    // Wrong oldPassword must surface as an error to the caller, NOT log the
    // user out of the active session.
    expect(client.getSession()).not.toBeNull();
    expect(sessionListener).not.toHaveBeenCalled();
    // Sanity check — we hit the changePassword endpoint, not the token endpoint.
    const calls = fetchFn.mock.calls as unknown as Array<[string, unknown]>;
    expect(calls[0]![0]).toBe('https://auth.example.com/v2/me/password');
  });

  it('handleRedirectCallback clears PKCE artifacts when the OAuth provider returns an error', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:nonce', 'no');
    await storage.set('nuria:oauth:code_verifier', 'cv');

    const client = createAuthClient({ ...BASE_CONFIG, storage });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?error=access_denied&error_description=user+rejected',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.CALLBACK_ERROR });

    expect(await storage.get('nuria:oauth:state')).toBeNull();
    expect(await storage.get('nuria:oauth:nonce')).toBeNull();
    expect(await storage.get('nuria:oauth:code_verifier')).toBeNull();
  });

  it('notify isolates listener throws so the rest of the fan-out still fires', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');
    const transport = makeMockTransport({ access_token: 'tok' });

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    const goodA = vi.fn();
    const goodB = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('listener boom');
    });

    client.onAuthStateChanged(goodA);
    client.onAuthStateChanged(bad);
    client.onAuthStateChanged(goodB);

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=c&state=st',
    );

    expect(goodA).toHaveBeenCalled();
    expect(bad).toHaveBeenCalled();
    // Critical: the listener AFTER the throwing one must still receive the
    // session. Otherwise a single buggy subscriber would silently break every
    // downstream component (React tree, BroadcastChannel post, etc.).
    expect(goodB).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('handleRedirectCallback clears PKCE artifacts on STATE_MISMATCH', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'expected');
    await storage.set('nuria:oauth:nonce', 'no');
    await storage.set('nuria:oauth:code_verifier', 'cv');

    const client = createAuthClient({ ...BASE_CONFIG, storage });

    await expect(
      client.handleRedirectCallback(
        'https://app.example.com/callback?code=c&state=tampered',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.STATE_MISMATCH });

    expect(await storage.get('nuria:oauth:state')).toBeNull();
    expect(await storage.get('nuria:oauth:nonce')).toBeNull();
    expect(await storage.get('nuria:oauth:code_verifier')).toBeNull();
  });
});
