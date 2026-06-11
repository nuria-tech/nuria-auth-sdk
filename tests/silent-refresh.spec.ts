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
  // DPoP and autoInit disabled: these tests measure refresh timing and control
  // init() explicitly. AutoDpopSigner adds crypto/IndexedDB async overhead that
  // makes setTimeout(0) flaky; autoInit would race with the explicit init() call.
  dpop: false as const,
  autoInit: false as const,
};

/**
 * v8-aware transport. The token endpoint mints a token expiring at a
 * configurable `expiresAt` (so we can pin it inside/outside the 5-min buffer);
 * `count` tracks how many times the token endpoint was hit. The initial
 * cookie-bootstrap refresh (on init) is therefore call #1 — subsequent
 * refreshes increment it further.
 */
function makeRefreshTransport(tokenExpiresAt: number) {
  let count = 0;
  return {
    request: vi.fn().mockImplementation(async () => {
      count++;
      return {
        status: 200,
        data: {
          access_token: `refreshed-${count}`,
          expiresAt: tokenExpiresAt,
        },
        headers: new Headers(),
      };
    }),
    get count() {
      return count;
    },
  };
}

/**
 * v8: tokens are never persisted. The only at-rest signal is the
 * non-sensitive "has session" marker; init() uses it to bootstrap the
 * in-memory access token via a cookie refresh.
 */
async function seedMarker(storage: MemoryStorageAdapter) {
  await storage.set('nuria:auth:has_session', '1');
}

describe('silent refresh — buffer threshold', () => {
  it('refreshes when access token has < 5 min remaining', async () => {
    const NOW = 1_000_000_000_000;
    const storage = new MemoryStorageAdapter();
    await seedMarker(storage);
    // Bootstrap mints a token with 4 min left — inside the 5-min buffer.
    const transport = makeRefreshTransport(NOW + 4 * 60 * 1000);
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now: () => NOW,
    });

    await client.init(); // bootstrap = call #1
    const afterBootstrap = transport.count;
    await client.getAccessToken();
    // The near-expiry token triggers exactly one additional refresh.
    expect(transport.count - afterBootstrap).toBe(1);
  });

  it('does NOT refresh when access token has > 5 min remaining', async () => {
    const NOW = 1_000_000_000_000;
    const storage = new MemoryStorageAdapter();
    await seedMarker(storage);
    // Bootstrap mints a token with 10 min left — comfortably outside the buffer.
    const transport = makeRefreshTransport(NOW + 10 * 60 * 1000);
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now: () => NOW,
    });

    await client.init();
    const afterBootstrap = transport.count;
    const token = await client.getAccessToken();
    // No refresh — returns the bootstrapped token unchanged.
    expect(token).toBe(`refreshed-${afterBootstrap}`);
    expect(transport.count - afterBootstrap).toBe(0);
  });

  it('refreshes when access token is already past expiry', async () => {
    const NOW = 2_000_000_000_000;
    const storage = new MemoryStorageAdapter();
    await seedMarker(storage);
    const transport = makeRefreshTransport(NOW - 60 * 1000);
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now: () => NOW,
    });

    await client.init();
    const afterBootstrap = transport.count;
    await client.getAccessToken();
    expect(transport.count - afterBootstrap).toBe(1);
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
    const NOW = 1_000_000_000_000;
    const storage = new MemoryStorageAdapter();
    await seedMarker(storage);
    // Bootstrap mints a token inside the 5-min buffer so the
    // listener-triggered getAccessToken() actually exercises the refresh path.
    const transport = makeRefreshTransport(NOW + 4 * 60 * 1000);
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      now: () => NOW,
    });
    await client.init();
    // The cookie bootstrap is the only call so far; subsequent counts are
    // listener-driven refreshes.
    const afterBootstrap = transport.count;
    return { client, transport, afterBootstrap };
  }

  it('visibilitychange to visible triggers refresh when within buffer', async () => {
    const { transport, afterBootstrap } = await bootClientWithStaleToken();

    // happy-dom defaults to `visible`; redispatch the event to trigger
    // the listener as if the tab had just been re-focused.
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.count - afterBootstrap).toBe(1);
  });

  it('pageshow with persisted=true triggers refresh (bfcache restore)', async () => {
    const { transport, afterBootstrap } = await bootClientWithStaleToken();

    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.count - afterBootstrap).toBe(1);
  });

  it('pageshow with persisted=false does NOT trigger refresh (initial load)', async () => {
    const { transport, afterBootstrap } = await bootClientWithStaleToken();

    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: false });
    window.dispatchEvent(event);
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.count - afterBootstrap).toBe(0);
  });

  it('online event triggers refresh when within buffer', async () => {
    const { transport, afterBootstrap } = await bootClientWithStaleToken();

    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.count - afterBootstrap).toBe(1);
  });

  it('listeners are detached after logout', async () => {
    const { client, transport, afterBootstrap } =
      await bootClientWithStaleToken();
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

    expect(transport.count - afterBootstrap).toBe(0);
  });
});
