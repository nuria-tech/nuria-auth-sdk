import type { StorageAdapter } from '../core/types';

export interface BrowserCookieStorageOptions {
  domain?: string;
  /**
   * Path attribute set on every cookie this adapter writes. Defaults to
   * `'/'` to keep the SDK working out-of-the-box across the full site, but
   * the cookie is then readable by any same-origin script under any path —
   * which is broader than most apps need. Prefer a narrower scope (e.g.
   * `'/auth'` or `'/account'`) when the consumer only reads the cookie
   * from a known sub-tree; this limits where a same-origin XSS can pull
   * the value from.
   */
  path?: string;
  sameSite?: 'strict' | 'lax' | 'none';
  secure?: boolean;
}

/**
 * **Security note.** A cookie written from JS is necessarily readable by
 * JS, so any same-origin XSS can exfiltrate the session. This adapter is a
 * pragmatic option for SPAs that need a SDK-managed session, but it is
 * **not** a substitute for a backend-issued `HttpOnly; Secure` cookie set
 * by a BFF. If your threat model includes credential theft via XSS, run
 * the auth flow through a BFF and let the server own the session cookie.
 */

const getCookieValue = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Use a pattern that captures everything up to ; or end-of-string,
  // supporting cookie values that contain '=' characters.
  const result = document.cookie.match(
    new RegExp(`(?:^|;)\\s*${escapedName}\\s*=\\s*([^;]*?)\\s*(?:;|$)`),
  );
  if (!result) return null;
  const raw = result[1] ?? null;
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
    if (sameSite) cookie += `; samesite=${sameSite}`;
    if (secure) cookie += `; secure`;
    document.cookie = cookie;
  };

  return { get, set, remove };
}
