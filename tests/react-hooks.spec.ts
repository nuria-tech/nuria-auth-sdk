// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient, Session } from '../src/core/types';
import { AuthProvider, useAuth, useAuthSession } from '../src/react';

function createMockAuthClient(): AuthClient {
  let session: Session | null = null;
  const listeners = new Set<(next: Session | null) => void>();

  return {
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
    loginWithGoogleCode: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-google-code' },
      createdAt: Date.now(),
    })),
    loginWithPassword: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-password' },
      createdAt: Date.now(),
    })),
    forceResetPassword: vi.fn(async () => ({
      tokens: { accessToken: 'token-after-force-reset' },
      createdAt: Date.now(),
    })),
    loginWithPasskey: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-passkey' },
      createdAt: Date.now(),
    })),
    listOidcProviders: vi.fn(async () => []),
    startOidcLogin: vi.fn(async () => {}),
    handleOidcCallback: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-oidc' },
      createdAt: Date.now(),
    })),
    handleRedirectCallback: vi.fn(async () => {
      throw new Error('not used');
    }),
    getSession: vi.fn(() => session),
    getAccessToken: vi.fn(async () => {
      session = {
        tokens: { accessToken: 'token-from-hydrate' },
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
    hasSessionMarker: vi.fn(async () => false),
    isAuthenticated: vi.fn(() => session !== null),
    onAuthStateChanged: vi.fn((handler: (next: Session | null) => void) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }),
    getUserinfo: vi.fn(async () => ({})),
    checkSession: vi.fn(async () => true),
    resetPassword: vi.fn(async () => {}),
    recoverPassword: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
    ready: Promise.resolve(),
    init: vi.fn(async () => {}),
    getClaims: vi.fn(() => null),
    getActor: vi.fn(() => null),
    isImpersonating: vi.fn(() => false),
    startImpersonation: vi.fn(),
    stopImpersonation: vi.fn(async () => {}),
    getAssurance: vi.fn(() => null),
    satisfiesStepUp: vi.fn(() => false),
    stepUp: vi.fn(async () => {}),
    hasRole: vi.fn(() => false),
    hasGroup: vi.fn(() => false),
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
    sendMagicLink: vi.fn(async () => {}),
    loginWithMagicLink: vi.fn(async () => ({
      tokens: { accessToken: 'token-from-magic' },
      createdAt: Date.now(),
    })),
    account: {} as AuthClient['account'],
  };
}

describe('react hooks integration', () => {
  it('useAuthSession hydrates persisted session and reacts to auth events', async () => {
    const auth = createMockAuthClient();

    function TestComponent() {
      const { session, isLoading } = useAuthSession(auth);
      return createElement(
        'div',
        {},
        createElement('span', { 'data-testid': 'loading' }, String(isLoading)),
        createElement(
          'span',
          { 'data-testid': 'token' },
          session?.tokens.accessToken ?? 'none',
        ),
      );
    }

    render(createElement(TestComponent));

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
      expect(screen.getByTestId('token').textContent).toBe(
        'token-from-hydrate',
      );
    });

    await auth.logout();
    await waitFor(() => {
      expect(screen.getByTestId('token').textContent).toBe('none');
    });
  });

  it('useAuthSession unsubscribes on unmount', () => {
    const unsubscribe = vi.fn();
    const auth = {
      ...createMockAuthClient(),
      onAuthStateChanged: vi.fn(() => unsubscribe),
      getAccessToken: vi.fn(async () => null),
    } satisfies AuthClient;

    function TestComponent() {
      useAuthSession(auth);
      return createElement('div');
    }

    const view = render(createElement(TestComponent));
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('AuthProvider + useAuth expose login and logout actions', async () => {
    const auth = createMockAuthClient();

    function TestComponent() {
      const { login, logout } = useAuth();
      return createElement(
        'div',
        {},
        createElement(
          'button',
          {
            'data-testid': 'login',
            onClick: () => {
              void login();
            },
          },
          'login',
        ),
        createElement(
          'button',
          {
            'data-testid': 'logout',
            onClick: () => {
              void logout();
            },
          },
          'logout',
        ),
      );
    }

    render(
      createElement(AuthProvider, {
        auth,
        children: createElement(TestComponent),
      }),
    );

    fireEvent.click(screen.getByTestId('login'));
    fireEvent.click(screen.getByTestId('logout'));

    await waitFor(() => {
      expect(auth.startLogin).toHaveBeenCalledTimes(1);
      expect(auth.logout).toHaveBeenCalledTimes(1);
    });
  });

  it('useAuthSession refresh returns null and exposes error when auth fails', async () => {
    const boom = new Error('refresh failed');
    const auth = {
      ...createMockAuthClient(),
      getAccessToken: vi.fn(async () => {
        throw boom;
      }),
      getSession: vi.fn(() => null),
    } satisfies AuthClient;

    function TestComponent() {
      const { refresh, error, isLoading } = useAuthSession(auth);
      return createElement(
        'div',
        {},
        createElement(
          'button',
          {
            'data-testid': 'refresh',
            onClick: async () => {
              await refresh();
            },
          },
          'refresh',
        ),
        createElement('span', { 'data-testid': 'loading' }, String(isLoading)),
        createElement(
          'span',
          { 'data-testid': 'error' },
          error instanceof Error ? error.message : 'none',
        ),
      );
    }

    const view = render(createElement(TestComponent));

    await waitFor(() => {
      expect(
        view.container.querySelector('[data-testid="loading"]')?.textContent,
      ).toBe('false');
      expect(
        view.container.querySelector('[data-testid="error"]')?.textContent,
      ).toBe('refresh failed');
    });

    fireEvent.click(
      view.container.querySelector('[data-testid="refresh"]') as Element,
    );

    await waitFor(() => {
      expect(
        view.container.querySelector('[data-testid="error"]')?.textContent,
      ).toBe('refresh failed');
      expect(
        view.container.querySelector('[data-testid="loading"]')?.textContent,
      ).toBe('false');
    });
  });

  it('useAuth login forwards StartLoginOptions to auth.startLogin', async () => {
    const auth = createMockAuthClient();

    function TestComponent() {
      const { login } = useAuth();
      return createElement(
        'button',
        {
          'data-testid': 'login-with-options',
          onClick: () => {
            void login({ loginHint: 'user@example.com', scopes: ['openid'] });
          },
        },
        'login',
      );
    }

    const view = render(
      createElement(AuthProvider, {
        auth,
        children: createElement(TestComponent),
      }),
    );

    fireEvent.click(
      view.container.querySelector(
        '[data-testid="login-with-options"]',
      ) as Element,
    );

    await waitFor(() => {
      expect(auth.startLogin).toHaveBeenCalledWith({
        loginHint: 'user@example.com',
        scopes: ['openid'],
      });
    });

    view.unmount();
  });

  it('useAuth keeps stable login/logout references across re-renders so consumer effects do not loop', async () => {
    const auth = createMockAuthClient();
    const referenceChanges: string[] = [];

    function TestComponent() {
      const { login, logout, globalLogout } = useAuth();
      const [, force] = useState(0);
      const loginRef = useRef(login);
      const logoutRef = useRef(logout);
      const globalRef = useRef(globalLogout);

      if (loginRef.current !== login) {
        referenceChanges.push('login');
        loginRef.current = login;
      }
      if (logoutRef.current !== logout) {
        referenceChanges.push('logout');
        logoutRef.current = logout;
      }
      if (globalRef.current !== globalLogout) {
        referenceChanges.push('globalLogout');
        globalRef.current = globalLogout;
      }

      useEffect(() => {
        force(1);
      }, []);

      return createElement(
        'div',
        { 'data-testid': 'stable-marker' },
        'rendered',
      );
    }

    const view = render(
      createElement(AuthProvider, {
        auth,
        children: createElement(TestComponent),
      }),
    );

    await waitFor(() => {
      expect(
        view.container.querySelector('[data-testid="stable-marker"]')
          ?.textContent,
      ).toBe('rendered');
    });

    expect(referenceChanges).toEqual([]);
    view.unmount();
  });

  it('useAuthSession exposes isImpersonating and actor, updated on auth events', async () => {
    let impersonating = false;
    const actor = { sub: 'op-1', name: 'Lucas', email: 'lucas@nuria.com.br' };
    const auth = {
      ...createMockAuthClient(),
      isImpersonating: vi.fn(() => impersonating),
      getActor: vi.fn(() => (impersonating ? actor : null)),
    } satisfies AuthClient;

    function TestComponent() {
      const { isImpersonating, actor: a } = useAuthSession(auth);
      return createElement(
        'div',
        {},
        createElement('span', { 'data-testid': 'imp' }, String(isImpersonating)),
        createElement('span', { 'data-testid': 'actor' }, a?.name ?? 'none'),
      );
    }

    render(createElement(TestComponent));
    await waitFor(() =>
      expect(screen.getByTestId('imp').textContent).toBe('false'),
    );
    expect(screen.getByTestId('actor').textContent).toBe('none');

    impersonating = true;
    // trigger an auth state change
    const onAuthStateChanged = auth.onAuthStateChanged as ReturnType<typeof vi.fn>;
    const [handler] = onAuthStateChanged.mock.calls[0] as [(s: null) => void];
    handler(null);

    await waitFor(() =>
      expect(screen.getByTestId('imp').textContent).toBe('true'),
    );
    expect(screen.getByTestId('actor').textContent).toBe('Lucas');
  });

  it('AuthContext exposes startImpersonation and stopImpersonation', async () => {
    const auth = createMockAuthClient();

    function TestComponent() {
      const { startImpersonation, stopImpersonation } = useAuth();
      return createElement(
        'div',
        {},
        createElement(
          'button',
          {
            'data-testid': 'start',
            onClick: () => startImpersonation('tok', 9999999999),
          },
          'start',
        ),
        createElement(
          'button',
          {
            'data-testid': 'stop',
            onClick: () => void stopImpersonation(),
          },
          'stop',
        ),
      );
    }

    render(
      createElement(AuthProvider, {
        auth,
        children: createElement(TestComponent),
      }),
    );

    fireEvent.click(screen.getByTestId('start'));
    fireEvent.click(screen.getByTestId('stop'));

    await waitFor(() => {
      expect(auth.startImpersonation).toHaveBeenCalledWith('tok', 9999999999);
      expect(auth.stopImpersonation).toHaveBeenCalledTimes(1);
    });
  });

  it('ImpersonationBanner renders when impersonating and hides when not', async () => {
    let impersonating = false;
    const listeners = new Set<(s: null) => void>();
    const actor = { sub: 'op-1', name: 'Lucas', email: 'lucas@nuria.com.br' };
    const auth = {
      ...createMockAuthClient(),
      isImpersonating: vi.fn(() => impersonating),
      getActor: vi.fn(() => (impersonating ? actor : null)),
      getClaims: vi.fn(() =>
        impersonating
          ? ({ sub: 'u-1', name: 'Bianca', email: 'b@test.com' } as ReturnType<AuthClient['getClaims']>)
          : null,
      ),
      onAuthStateChanged: vi.fn((handler: (s: null) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      }),
    } satisfies AuthClient;

    const { ImpersonationBanner: Banner } = await import('../src/react');

    render(createElement(Banner, { auth }));

    expect(screen.queryByRole('alert')).toBeNull();

    impersonating = true;
    listeners.forEach((h) => h(null));

    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeNull(),
    );
    expect(screen.getByRole('alert').textContent).toContain('Lucas');
    expect(screen.getByRole('alert').textContent).toContain('Bianca');

    impersonating = false;
    listeners.forEach((h) => h(null));

    await waitFor(() =>
      expect(screen.queryByRole('alert')).toBeNull(),
    );
  });

  it('ImpersonationBanner stop button calls auth.stopImpersonation by default', async () => {
    let impersonating = true;
    const listeners = new Set<(s: null) => void>();
    const auth = {
      ...createMockAuthClient(),
      isImpersonating: vi.fn(() => impersonating),
      getActor: vi.fn(() => ({ sub: 'op', name: 'Op' })),
      getClaims: vi.fn(() => ({ sub: 'u', name: 'User', email: 'u@t.com' } as never)),
      stopImpersonation: vi.fn(async () => {
        impersonating = false;
        listeners.forEach((h) => h(null));
      }),
      onAuthStateChanged: vi.fn((handler: (s: null) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      }),
    } satisfies AuthClient;

    const { ImpersonationBanner: Banner } = await import('../src/react');
    render(createElement(Banner, { auth }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /encerrar/i }));

    await waitFor(() => {
      expect(auth.stopImpersonation).toHaveBeenCalledTimes(1);
    });
  });

  it('mountImpersonationBanner mounts to body and is idempotent', async () => {
    const auth = {
      ...createMockAuthClient(),
      isImpersonating: vi.fn(() => false),
      onAuthStateChanged: vi.fn(() => () => {}),
    } satisfies AuthClient;

    const { mountImpersonationBanner: mount } = await import('../src/react');

    const existing = document.getElementById('nuria-imp-banner-root');
    existing?.remove();

    const unmount = mount(auth);
    expect(document.getElementById('nuria-imp-banner-root')).not.toBeNull();

    const unmount2 = mount(auth);
    expect(document.querySelectorAll('#nuria-imp-banner-root')).toHaveLength(1);

    unmount();
    unmount2();
    expect(document.getElementById('nuria-imp-banner-root')).toBeNull();
  });
});
