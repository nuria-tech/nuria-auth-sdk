import type { StorageAdapter } from '../core/types';

export interface BrowserCookieStorageOptions {
  domain?: string;
  path?: string;
  sameSite?: 'strict' | 'lax' | 'none';
  secure?: boolean;
}

const getCookieValue = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const result = document.cookie.match(
    `(^|;)\\s*${escapedName}\\s*=\\s*([^;]+)`,
  );
  if (!result) return null;
  const raw = result.pop() ?? null;
  if (raw == null) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export function createBrowserCookieStorage(
  options: BrowserCookieStorageOptions = {},
): StorageAdapter {
  const { domain, path = '/', sameSite = 'strict', secure = true } = options;

  const get = (key: string): string | null => {
    return getCookieValue(key);
  };

  const set = (key: string, value: string): void => {
    if (typeof document === 'undefined') return;
    let cookie = `${key}=${encodeURIComponent(value)}`;
    if (path) cookie += `; path=${path}`;
    if (domain) cookie += `; domain=${domain}`;
    if (sameSite) cookie += `; samesite=${sameSite}`;
    if (secure) cookie += `; secure`;
    document.cookie = cookie;
  };

  const remove = (key: string): void => {
    if (typeof document === 'undefined') return;
    let cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    if (path) cookie += `; path=${path}`;
    if (domain) cookie += `; domain=${domain}`;
    document.cookie = cookie;
  };

  return { get, set, remove };
}
