import { createAuthClient } from '../client/create-client';
import type { AuthClient, AuthConfig } from '../core/types';
import { CookieStorageAdapter } from '../storage/cookie-storage-adapter';

export interface NextCookieApi {
  get: (
    name: string,
  ) => string | null | undefined | Promise<string | null | undefined>;
  set: (name: string, value: string) => void | Promise<void>;
  remove: (name: string) => void | Promise<void>;
}

export function createNextCookieStorageAdapter(
  cookies: NextCookieApi,
): CookieStorageAdapter {
  return new CookieStorageAdapter({
    getCookie: async (name) => (await cookies.get(name)) ?? null,
    setCookie: (name, value) => cookies.set(name, value),
    removeCookie: (name) => cookies.remove(name),
  });
}

export function createNextAuthClient(
  config: AuthConfig,
  cookies: NextCookieApi,
): AuthClient {
  return createAuthClient({
    ...config,
    storage: createNextCookieStorageAdapter(cookies),
  });
}
