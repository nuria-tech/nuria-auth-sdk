// @vitest-environment happy-dom

import { createApp, defineComponent, h, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient, Session } from '../src/core/types';
import { provideAuth, useAuth, useAuthSession } from '../src/vue';

function createMockAuth(): AuthClient {
  let session: Session | null = null;
  const listeners = new Set<(next: Session | null) => void>();

  return {
    startLogin: vi.fn(async () => {}),
    startLoginCodeChallenge: vi.fn(async () => ({
      challengeId: 'c',
      channel: 'email',
      destinationMasked: 'u***@m.com',
      expiresAt: Date.now() + 300_000,
      purpose: 'login',
    })),
    verifyLoginCode: vi.fn(async () => ({
      tokens: { accessToken: 'tok' },
      createdAt: Date.now(),
    })),
    loginWithGoogleCode: vi.fn(async () => ({
      tokens: { accessToken: 'tok' },
      createdAt: Date.now(),
    })),
    loginWithPassword: vi.fn(async () => ({
      tokens: { accessToken: 'tok' },
      createdAt: Date.now(),
    })),
    forceResetPassword: vi.fn(async () => ({
      tokens: { accessToken: 'tok' },
      createdAt: Date.now(),
    })),
    loginWithPasskey: vi.fn(async () => ({
      tokens: { accessToken: 'tok' },
      createdAt: Date.now(),
    })),
    listOidcProviders: vi.fn(async () => []),
    startOidcLogin: vi.fn(async () => {}),
    handleOidcCallback: vi.fn(async () => ({
      tokens: { accessToken: 'tok' },
      createdAt: Date.now(),
    })),
    handleRedirectCallback: vi.fn(async () => {
      throw new Error('not used');
    }),
    getSession: vi.fn(() => session),
    getAccessToken: vi.fn(async () => {
      session = { tokens: { accessToken: 'tok-hydrate' }, createdAt: Date.now() };
      return session.tokens.accessToken;
    }),
    logout: vi.fn(async () => {
      session = null;
      listeners.forEach((l) => l(null));
    }),
    globalLogout: vi.fn(async () => {
      session = null;
      listeners.forEach((l) => l(null));
    }),
    revokeSession: vi.fn(async () => {}),
    revokeAllSessions: vi.fn(async () => {}),
    hasSessionMarker: vi.fn(async () => false),
    isAuthenticated: vi.fn(() => session !== null),
    onAuthStateChanged: vi.fn((handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }),
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
    sendMagicLink: vi.fn(async () => {}),
    loginWithMagicLink: vi.fn(async () => ({
      tokens: { accessToken: 'tok' },
      createdAt: Date.now(),
    })),
    account: {} as AuthClient['account'],
  };
}

/** Mounts a component that calls setup() and returns its result + teardown. */
function withSetup<T>(setup: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const div = document.createElement('div');
  document.body.appendChild(div);
  const app = createApp({
    setup() {
      result = setup();
      return {};
    },
    render() {
      return null;
    },
  });
  app.mount(div);
  return {
    result,
    unmount: () => {
      app.unmount();
      div.remove();
    },
  };
}

describe('vue useAuthSession', () => {
  it('hydrates session and exposes isAuthenticated', async () => {
    const auth = createMockAuth();
    const { result, unmount } = withSetup(() => useAuthSession(auth));

    expect(result.isLoading.value).toBe(true);

    await nextTick();
    await new Promise((r) => setTimeout(r, 10));

    expect(auth.getAccessToken).toHaveBeenCalled();
    expect(result.isLoading.value).toBe(false);
    unmount();
  });

  it('starts and stops silent refresh on mount/unmount', async () => {
    const auth = createMockAuth();
    const { unmount } = withSetup(() => useAuthSession(auth));

    await nextTick();
    expect(auth.startSilentRefresh).toHaveBeenCalledTimes(1);

    unmount();
    expect(auth.stopSilentRefresh).toHaveBeenCalledTimes(1);
  });

  it('updates isImpersonating and actor on auth state change', async () => {
    let impersonating = false;
    const actor = { sub: 'op-1', name: 'Lucas', email: 'lucas@nuria.com.br' };
    const auth = createMockAuth();
    auth.isImpersonating = vi.fn(() => impersonating);
    auth.getActor = vi.fn(() => (impersonating ? actor : null));

    const { result, unmount } = withSetup(() => useAuthSession(auth));
    await nextTick();
    await new Promise((r) => setTimeout(r, 10));

    expect(result.isImpersonating.value).toBe(false);
    expect(result.actor.value).toBeNull();

    impersonating = true;
    const onAuthStateChanged = auth.onAuthStateChanged as ReturnType<typeof vi.fn>;
    const [handler] = onAuthStateChanged.mock.calls[0] as [(s: null) => void];
    handler(null);
    await nextTick();

    expect(result.isImpersonating.value).toBe(true);
    expect(result.actor.value).toEqual(actor);
    unmount();
  });

  it('exposes hasRole and hasGroup delegates', async () => {
    const auth = createMockAuth();
    auth.hasRole = vi.fn((role) => role === 'admin');
    auth.hasGroup = vi.fn((group) => group === 'engineering');

    const { result, unmount } = withSetup(() => useAuthSession(auth));
    await nextTick();

    expect(result.hasRole('admin')).toBe(true);
    expect(result.hasRole('unknown')).toBe(false);
    expect(result.hasGroup('engineering')).toBe(true);
    expect(result.hasGroup('other')).toBe(false);
    unmount();
  });

  it('exposes getAssurance, satisfiesStepUp, stepUp delegates', async () => {
    const auth = createMockAuth();
    auth.getAssurance = vi.fn(() => 'aal1' as never);
    auth.satisfiesStepUp = vi.fn(() => true);
    auth.stepUp = vi.fn(async () => {});

    const { result, unmount } = withSetup(() => useAuthSession(auth));
    await nextTick();

    expect(result.getAssurance()).toBe('aal1');
    expect(result.satisfiesStepUp('aal2')).toBe(true);
    await result.stepUp();
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('refresh updates session state', async () => {
    const auth = createMockAuth();
    const { result, unmount } = withSetup(() => useAuthSession(auth));
    await nextTick();
    await new Promise((r) => setTimeout(r, 10));

    const newSession = await result.refresh();
    expect(auth.getAccessToken).toHaveBeenCalledTimes(2);
    expect(newSession).not.toBeNull();
    unmount();
  });

  it('refresh stores error on failure', async () => {
    const boom = new Error('network error');
    const auth = createMockAuth();
    auth.getAccessToken = vi.fn(async () => {
      throw boom;
    });
    const { result, unmount } = withSetup(() => useAuthSession(auth));
    await nextTick();
    await new Promise((r) => setTimeout(r, 10));

    const val = await result.refresh();
    expect(val).toBeNull();
    expect(result.error.value).toBe(boom);
    unmount();
  });
});

describe('vue provideAuth / useAuth', () => {
  it('useAuth returns the provided auth client via parent/child injection', () => {
    const auth = createMockAuth();
    let captured: AuthClient | null = null;

    // Child component — calls useAuth() which injects from parent
    const Child = defineComponent({
      setup() {
        captured = useAuth();
        return {};
      },
      render() {
        return h('span');
      },
    });

    // Parent component — calls provideAuth() then renders Child
    const div = document.createElement('div');
    document.body.appendChild(div);
    const app = createApp(
      defineComponent({
        setup() {
          provideAuth(auth);
          return {};
        },
        render() {
          return h(Child);
        },
      }),
    );
    app.mount(div);

    expect(captured).toBe(auth);

    app.unmount();
    div.remove();
  });

  it('useAuth throws when called outside a provisioned tree', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    let threw = false;
    const app = createApp(
      defineComponent({
        setup() {
          try {
            useAuth();
          } catch {
            threw = true;
          }
          return {};
        },
        render() {
          return h('span');
        },
      }),
    );
    app.mount(div);
    app.unmount();
    div.remove();
    expect(threw).toBe(true);
  });
});
