import { firstValueFrom, from } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  createAngularAuthFacade,
  createBearerInterceptor,
} from '../src/angular';
import type { AuthClient, Session } from '../src/core/types';

function createMockAuth() {
  let session: Session | null = null;
  const listeners = new Set<(next: Session | null) => void>();
  const unsubscribe = vi.fn();

  const auth: AuthClient = {
    startLogin: vi.fn(async () => {}),
    startLoginCodeChallenge: vi.fn(async () => ({
      challengeId: 'challenge-id',
      channel: 'email',
      destinationMasked: 'u***@mail.com',
      expiresAt: Date.now() + 300_000,
      purpose: 'login',
    })),
    verifyLoginCode: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-code' },
      createdAt: Date.now(),
    })),
    loginWithCodeSent: vi.fn(async () => ({
      challengeId: 'challenge-id',
      channel: 'email',
      destinationMasked: 'u***@mail.com',
      expiresAt: Date.now() + 300_000,
      purpose: 'login',
    })),
    completeLoginWithCode: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-code' },
      createdAt: Date.now(),
    })),
    loginWithGoogle: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-google' },
      createdAt: Date.now(),
    })),
    loginWithAws: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-aws' },
      createdAt: Date.now(),
    })),
    loginWithPassword: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-password' },
      createdAt: Date.now(),
    })),
    handleRedirectCallback: vi.fn(async () => {
      throw new Error('not used');
    }),
    getSession: vi.fn(() => session),
    getAccessToken: vi.fn(async () => {
      session = {
        tokens: { accessToken: 'token-from-refresh' },
        createdAt: Date.now(),
      };
      return session.tokens.accessToken;
    }),
    logout: vi.fn(async () => {
      session = null;
      listeners.forEach((listener) => listener(session));
    }),
    globalLogout: vi.fn(async () => {
      session = null;
      listeners.forEach((listener) => listener(session));
    }),
    revokeSession: vi.fn(async () => {}),
    revokeAllSessions: vi.fn(async () => {}),
    isAuthenticated: vi.fn(() => session !== null),
    onAuthStateChanged: vi.fn((handler) => {
      listeners.add(handler);
      return () => {
        unsubscribe();
        listeners.delete(handler);
      };
    }),
    init: vi.fn(async () => {}),
    getClaims: vi.fn(() => null),
    hasRole: vi.fn(() => false),
    hasGroup: vi.fn(() => false),
    getUserinfo: vi.fn(async () => ({})),
    checkSession: vi.fn(async () => true),
    resetPassword: vi.fn(async () => {}),
    recoverPassword: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
    getLoginMethods: vi.fn(() => ({ enabled: [], comingSoon: [] })),
    startSilentRefresh: vi.fn(),
    stopSilentRefresh: vi.fn(),
    lookupDeviceUserCode: vi.fn(async () => ({
      userCode: 'WDJB-MJHT',
      clientId: 'client',
      clientName: 'Test',
      expiresAt: '',
    })),
    approveDeviceUserCode: vi.fn(async () => {}),
    denyDeviceUserCode: vi.fn(async () => {}),
  };

  return { auth, unsubscribe };
}

describe('angular entrypoint', () => {
  it('creates facade and refreshes state', async () => {
    const { auth } = createMockAuth();
    const facade = createAngularAuthFacade(auth);

    const events: string[] = [];
    const sub = facade.state$.subscribe((state) => {
      events.push(
        state.isLoading
          ? 'loading'
          : (state.session?.tokens.accessToken ?? 'none'),
      );
    });

    await facade.refresh();
    expect(facade.snapshot().session?.tokens.accessToken).toBe(
      'token-from-refresh',
    );
    expect(events).toContain('token-from-refresh');

    sub.unsubscribe();
    facade.destroy();
  });

  it('destroy unsubscribes listener', () => {
    const { auth, unsubscribe } = createMockAuth();
    const facade = createAngularAuthFacade(auth);
    facade.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('facade login/logout delegates to auth client', async () => {
    const { auth } = createMockAuth();
    const facade = createAngularAuthFacade(auth);

    await facade.login();
    await facade.logout();
    await facade.globalLogout({ returnTo: 'https://app.example.com' });

    expect(auth.startLogin).toHaveBeenCalledTimes(1);
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(auth.globalLogout).toHaveBeenCalledWith({
      returnTo: 'https://app.example.com',
    });

    facade.destroy();
  });

  it('facade login forwards StartLoginOptions to auth.startLogin', async () => {
    const { auth } = createMockAuth();
    const facade = createAngularAuthFacade(auth);

    await facade.login({ loginHint: 'user@example.com', scopes: ['openid'] });
    expect(auth.startLogin).toHaveBeenCalledWith({
      loginHint: 'user@example.com',
      scopes: ['openid'],
    });

    facade.destroy();
  });

  it('refresh returns null and stores error when getAccessToken fails', async () => {
    const boom = new Error('refresh-failed');
    const { auth } = createMockAuth();
    auth.getAccessToken = vi.fn(async () => {
      throw boom;
    });
    auth.getSession = vi.fn(() => null);

    const facade = createAngularAuthFacade(auth);
    const result = await facade.refresh();

    expect(result).toBeNull();
    expect(facade.snapshot().error).toBe(boom);
    expect(facade.snapshot().isLoading).toBe(false);

    facade.destroy();
  });
});

describe('createBearerInterceptor', () => {
  function makeReq(url = 'https://api.example.com/data') {
    return {
      url,
      clone: vi.fn((updates: { setHeaders: Record<string, string> }) => ({
        ...updates,
        url,
      })),
    } as unknown as Parameters<ReturnType<typeof createBearerInterceptor>>[0];
  }

  it('attaches Authorization header when token is available', async () => {
    const { auth } = createMockAuth();
    auth.getAccessToken = vi.fn(async () => 'my-access-token');

    const interceptor = createBearerInterceptor(auth);
    const req = makeReq();
    const next = vi.fn((r: unknown) => from([{ type: 'response', body: r }]));

    await firstValueFrom(interceptor(req, next as never));

    expect(req.clone).toHaveBeenCalledWith({
      setHeaders: { Authorization: 'Bearer my-access-token' },
    });
  });

  it('passes request through unchanged when no token', async () => {
    const { auth } = createMockAuth();
    auth.getAccessToken = vi.fn(async () => null);

    const interceptor = createBearerInterceptor(auth);
    const req = makeReq();
    const next = vi.fn((r: unknown) => from([{ type: 'response', body: r }]));

    await firstValueFrom(interceptor(req, next as never));

    expect(req.clone).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(req);
  });
});
