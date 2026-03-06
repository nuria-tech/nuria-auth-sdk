import { describe, expect, it, vi } from 'vitest';
import type { AuthClient, Session } from '../src/core/types';
import { createAngularAuthFacade } from '../src/angular';

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
    isAuthenticated: vi.fn(() => session !== null),
    onAuthStateChanged: vi.fn((handler) => {
      listeners.add(handler);
      return () => {
        unsubscribe();
        listeners.delete(handler);
      };
    }),
    getUserinfo: vi.fn(async () => ({})),
  };

  return { auth, unsubscribe };
}

describe('angular entrypoint', () => {
  it('creates facade and refreshes state', async () => {
    const { auth } = createMockAuth();
    const facade = createAngularAuthFacade(auth);

    const events: string[] = [];
    const sub = facade.state$.subscribe((state) => {
      events.push(state.isLoading ? 'loading' : state.session?.tokens.accessToken ?? 'none');
    });

    await facade.refresh();
    expect(facade.snapshot().session?.tokens.accessToken).toBe('token-from-refresh');
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
});
