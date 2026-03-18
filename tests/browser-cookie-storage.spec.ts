// @vitest-environment happy-dom

import { describe, expect, it, beforeEach } from 'vitest';
import { createBrowserCookieStorage } from '../src/storage/browser-cookie-storage';

describe('BrowserCookieStorage', () => {
  // Clear all cookies before each test
  beforeEach(() => {
    document.cookie.split(';').forEach((c) => {
      document.cookie = c
        .replace(/^ +/, '')
        .replace(/=.*/, `=;expires=${new Date().toUTCString()};path=/`);
    });
  });

  it('sets and gets a cookie with default path', () => {
    const storage = createBrowserCookieStorage({ secure: false });
    storage.set('my-key', 'my-value');
    expect(storage.get('my-key')).toBe('my-value');
  });

  it('removes a cookie', () => {
    const storage = createBrowserCookieStorage({ secure: false });
    storage.set('my-key', 'my-value');
    expect(storage.get('my-key')).toBe('my-value');

    storage.remove('my-key');
    expect(storage.get('my-key')).toBeNull();
  });

  it('handles non-existent cookie', () => {
    const storage = createBrowserCookieStorage({ secure: false });
    expect(storage.get('not-a-key')).toBeNull();
  });

  it('overwrites an existing cookie', () => {
    const storage = createBrowserCookieStorage({ secure: false });
    storage.set('my-key', 'value1');
    expect(storage.get('my-key')).toBe('value1');
    storage.set('my-key', 'value2');
    expect(storage.get('my-key')).toBe('value2');
  });

  it('encodes and decodes cookie values with special characters', () => {
    const storage = createBrowserCookieStorage({ secure: false });
    const value = 'email+tag@example.com;a=b c';
    storage.set('special-key', value);
    expect(storage.get('special-key')).toBe(value);
  });

  it('correctly reads cookie values that contain "=" characters', () => {
    const storage = createBrowserCookieStorage({ secure: false });
    // Base64-encoded strings frequently contain '=' padding
    const value = 'eyJhbGciOiJSUzI1NiJ9==';
    storage.set('token-key', value);
    expect(storage.get('token-key')).toBe(value);
  });

  it('remove() clears the cookie (samesite consistency)', () => {
    const storage = createBrowserCookieStorage({ secure: false, sameSite: 'lax' });
    storage.set('k', 'v');
    expect(storage.get('k')).toBe('v');
    storage.remove('k');
    expect(storage.get('k')).toBeNull();
  });

  it('handles empty cookie value', () => {
    const storage = createBrowserCookieStorage({ secure: false });
    storage.set('empty-key', '');
    expect(storage.get('empty-key')).toBe('');
  });

  it('does not match a cookie whose name is a prefix of another', () => {
    const storage = createBrowserCookieStorage({ secure: false });
    storage.set('token', 'short');
    storage.set('token-extra', 'long');
    expect(storage.get('token')).toBe('short');
    expect(storage.get('token-extra')).toBe('long');
  });
});
