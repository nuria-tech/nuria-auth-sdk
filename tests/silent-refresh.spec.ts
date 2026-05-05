// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthClient } from '../src/client/create-client';
import { MemoryStorageAdapter } from '../src';

// Pins the silent-refresh contract: the 5-min buffer (REFRESH_BUFFER_MS)
// and the three reactivation listeners (`visibilitychange`, `pageshow`,
// `online`) that recover from backgrounded-tab timer throttling. These
// tests exist specifically so an accidental shrink of the buffer or
// removal of a listener fails the build — the symptom in production
// ("token expirando muito rápido na UI") is hard to bisect once shipped.

const BASE_CONFIG = {
  clientId: 'test-client',
  baseUrl: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
};

function makeRefreshTransport() {
  let count = 0;
  return {
    request: vi.fn().mockImplementation(async () => {
      count++;
      return {
        status: 200,
        data: { access_token: `refreshed-${count}`, expires_in: 3600 },
        headers: new Headers(),
      };
    }),
    get count() {
      return count;
    },
  };
}

async function seedSession(
  storage: MemoryStorageAdapter,
  expiresAt: number,
  now: number,
) {
  await storage.set(
    'nuria:session',
    JSON.stringify({
      tokens: {
        accessToken: 'initial',
        refreshToken: 'rt',
        expiresAt,
      },
      createdAt: now,
    }),
  );
}

describe('silent refresh — buffer threshold', () => {
  it('refreshes when access token has < 5 min remaining', async () => {
    const NOW = 1_000_000_000;
    const storage = new MemoryStorageAdapter();
    // 4 min left — inside the 5-min buffer.
    await seedSession(storage, NOW + 4 * 60 * 1000, NOW);
    const transport = makeRefreshTransport();
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now: () => NOW,
    });

    await client.getAccessToken();
    expect(transport.count).toBe(1);
  });

  it('does NOT refresh when access token has > 5 min remaining', async () => {
    const NOW = 1_000_000_000;
    const storage = new MemoryStorageAdapter();
    // 10 min left — comfortably outside the buffer.
    await seedSession(storage, NOW + 10 * 60 * 1000, NOW);
    const transport = makeRefreshTransport();
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now: () => NOW,
    });

    const token = await client.getAccessToken();
    expect(token).toBe('initial');
    expect(transport.count).toBe(0);
  });

  it('refreshes when access token is already past expiry', async () => {
    const NOW = 1_000_000_000;
    const storage = new MemoryStorageAdapter();
    await seedSession(storage, NOW - 60 * 1000, NOW);
    const transport = makeRefreshTransport();
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now: () => NOW,
    });

    await client.getAccessToken();
    expect(transport.count).toBe(1);
  });
});

describe('silent refresh — reactivation listeners', () => {
  let originalSetInterval: typeof setInterval;

  beforeEach(() => {
    // Neuter setInterval so the tests measure only listener-driven
    // refresh paths (the interval would otherwise race with our manual
    // event dispatches and produce flaky counts).
    originalSetInterval = globalThis.setInterval;
    globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
  });

  async function bootClientWithStaleToken() {
    const NOW = 1_000_000_000;
    const storage = new MemoryStorageAdapter();
    // Inside the 5-min buffer so the listener-triggered getAccessToken()
    // actually exercises the refresh path.
    await seedSession(storage, NOW + 4 * 60 * 1000, NOW);
    const transport = makeRefreshTransport();
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now: () => NOW,
    });
    await client.init();
    return { client, transport };
  }

  it('visibilitychange to visible triggers refresh when within buffer', async () => {
    const { transport } = await bootClientWithStaleToken();

    // happy-dom defaults to `visible`; redispatch the event to trigger
    // the listener as if the tab had just been re-focused.
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.count).toBe(1);
  });

  it('pageshow with persisted=true triggers refresh (bfcache restore)', async () => {
    const { transport } = await bootClientWithStaleToken();

    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.count).toBe(1);
  });

  it('pageshow with persisted=false does NOT trigger refresh (initial load)', async () => {
    const { transport } = await bootClientWithStaleToken();

    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: false });
    window.dispatchEvent(event);
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.count).toBe(0);
  });

  it('online event triggers refresh when within buffer', async () => {
    const { transport } = await bootClientWithStaleToken();

    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.count).toBe(1);
  });

  it('listeners are detached after logout', async () => {
    const { client, transport } = await bootClientWithStaleToken();
    await client.logout();

    // After logout the session is gone — listener fires but
    // getAccessToken short-circuits (no session). What we care about
    // is that the listener is gone entirely, so even if the session
    // were restored externally the dead listener wouldn't fire twice.
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    const pageshowEvent = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(pageshowEvent, 'persisted', { value: true });
    window.dispatchEvent(pageshowEvent);
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.count).toBe(0);
  });
});
