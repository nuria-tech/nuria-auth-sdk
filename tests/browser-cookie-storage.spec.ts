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
});
