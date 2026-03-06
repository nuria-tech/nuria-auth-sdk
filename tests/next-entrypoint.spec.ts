import { describe, expect, it, vi } from 'vitest';
import {
  createNextAuthClient,
  createNextCookieStorageAdapter,
} from '../src/next';

const BASE_CONFIG = {
  clientId: 'test-client',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
};

describe('next entrypoint', () => {
  it('cookie storage adapter delegates get/set/remove to Next cookie API', async () => {
    const cookies = {
      get: vi.fn(async () => 'value-from-cookie'),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const storage = createNextCookieStorageAdapter(cookies);

    expect(await storage.get('key')).toBe('value-from-cookie');
    await storage.set('key', 'value');
    await storage.remove('key');

    expect(cookies.get).toHaveBeenCalledWith('key');
    expect(cookies.set).toHaveBeenCalledWith('key', 'value');
    expect(cookies.remove).toHaveBeenCalledWith('key');
  });

  it('createNextAuthClient hydrates session from cookie-backed storage', async () => {
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

    const auth = createNextAuthClient(BASE_CONFIG, cookies);
    const token = await auth.getAccessToken();
    expect(token).toBe('token-from-cookie');

    await auth.logout();
    expect(cookies.remove).toHaveBeenCalledWith('nuria:session');
    expect(cookies.remove).toHaveBeenCalledWith('nuria:oauth:state');
    expect(cookies.remove).toHaveBeenCalledWith('nuria:oauth:code_verifier');
  });
});
