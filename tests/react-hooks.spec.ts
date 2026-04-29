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
    init: vi.fn(async () => {}),
    getClaims: vi.fn(() => null),
    hasRole: vi.fn(() => false),
    hasGroup: vi.fn(() => false),
    getLoginMethods: vi.fn(() => ({ enabled: [], comingSoon: [] })),
    startSilentRefresh: vi.fn(),
    stopSilentRefresh: vi.fn(),
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
});
