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

    await client.startLogin({ extraParams: { ui_locales: 'pt-BR', prompt: 'login' } });
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('ui_locales')).toBe('pt-BR');
    expect(parsed.searchParams.get('prompt')).toBe('login');
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

  it('handleRedirectCallback keeps state when token exchange fails', async () => {
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

    expect(await storage.get('nuria:oauth:state')).toBe('test-state');
    expect(await storage.get('nuria:oauth:code_verifier')).toBe('test-verifier');
  });

  // ---------------------------------------------------------------------------
  // getClaims
  // ---------------------------------------------------------------------------

  function makeJwt(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const body = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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

    const claims = { sub: 'user-1', email: 'user@example.com', roles: 'admin,editor', exp: 9999999999 };
    const transport = makeMockTransport({ access_token: makeJwt(claims) });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback('https://app.example.com/callback?code=c&state=st');
    const decoded = client.getClaims();

    expect(decoded?.sub).toBe('user-1');
    expect(decoded?.email).toBe('user@example.com');
    expect(decoded?.roles).toBe('admin,editor');
  });

  it('getClaims returns null for malformed access token', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:oauth:state', 'st');
    await storage.set('nuria:oauth:code_verifier', 'vf');

    const transport = makeMockTransport({ access_token: 'not.a.valid-jwt-payload' });
    const client = createAuthClient({ ...BASE_CONFIG, storage, transport });

    await client.handleRedirectCallback('https://app.example.com/callback?code=c&state=st');
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

    await client.handleRedirectCallback('https://app.example.com/callback?code=c&state=st');
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

    await client.handleRedirectCallback('https://app.example.com/callback?code=c&state=st');
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

    await client.handleRedirectCallback('https://app.example.com/callback?code=c&state=st');
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

    await client.handleRedirectCallback('https://app.example.com/callback?code=c&state=st');
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

    const transport = makeMockTransport({ access_token: 'tok', auth_provider: 'google' });
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

    const transport = makeMockTransport({ access_token: 'tok', authProvider: 'password' });
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
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ tokens: expect.objectContaining({ accessToken: 'stored-tok' }) }));
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

    await client.handleRedirectCallback('https://app.example.com/callback?code=c&state=st');

    expect(postMessage).toHaveBeenCalledWith({
      type: 'SESSION_SYNC',
      session: expect.objectContaining({ tokens: expect.objectContaining({ accessToken: 'tok' }) }),
    });

    postMessage.mockRestore();
  });

  it('init() does not broadcast session to other tabs', async () => {
    const postMessage = vi.spyOn(BroadcastChannel.prototype, 'postMessage');

    const storage = new MemoryStorageAdapter();
    await storage.set('nuria:session', JSON.stringify({ tokens: { accessToken: 'tok' }, createdAt: Date.now() }));

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
    const incomingSession = { tokens: { accessToken: 'from-other-tab' }, createdAt: Date.now() };
    channel.postMessage({ type: 'SESSION_SYNC', session: incomingSession });

    // BroadcastChannel delivers async — allow microtasks to flush
    await new Promise((r) => setTimeout(r, 10));

    expect(client.getSession()?.tokens.accessToken).toBe('from-other-tab');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ tokens: expect.objectContaining({ accessToken: 'from-other-tab' }) }));
    channel.close();
  });
});
