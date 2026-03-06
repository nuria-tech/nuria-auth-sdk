import { describe, expect, it, vi } from 'vitest';
import {
  createNuxtAuthClient,
  createNuxtCookieStorageAdapter,
} from '../src/nuxt';

const BASE_CONFIG = {
  clientId: 'test-client',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
};

describe('nuxt entrypoint', () => {
  it('cookie storage adapter delegates get/set/remove to Nuxt cookie API', async () => {
    const cookies = {
      get: vi.fn(async () => 'value-from-cookie'),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const storage = createNuxtCookieStorageAdapter(cookies);

    expect(await storage.get('key')).toBe('value-from-cookie');
    await storage.set('key', 'value');
    await storage.remove('key');

    expect(cookies.get).toHaveBeenCalledWith('key');
    expect(cookies.set).toHaveBeenCalledWith('key', 'value');
    expect(cookies.remove).toHaveBeenCalledWith('key');
  });

  it('createNuxtAuthClient hydrates session from cookie-backed storage', async () => {
    const store: Record<string, string | undefined> = {
      'nuria:session': JSON.stringify({
        tokens: { accessToken: 'token-from-cookie' },
        createdAt: Date.now(),
      }),
    };

    const cookies = {
      get: vi.fn(async (name: string) => store[name]),
      set: vi.fn((name: string, value: string) => {
        store[name] = value;
      }),
      remove: vi.fn((name: string) => {
        delete store[name];
      }),
    };

    const auth = createNuxtAuthClient(BASE_CONFIG, cookies);
    const token = await auth.getAccessToken();
    expect(token).toBe('token-from-cookie');

    await auth.logout();
    expect(cookies.remove).toHaveBeenCalledWith('nuria:session');
    expect(cookies.remove).toHaveBeenCalledWith('nuria:oauth:state');
    expect(cookies.remove).toHaveBeenCalledWith('nuria:oauth:code_verifier');
  });
});
