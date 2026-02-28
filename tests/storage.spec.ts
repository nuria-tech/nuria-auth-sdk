// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStorageAdapter } from '../src/storage/memory-storage-adapter';
import { WebStorageAdapter } from '../src/storage/web-storage-adapter';
import { CookieStorageAdapter } from '../src/storage/cookie-storage-adapter';

describe('MemoryStorageAdapter', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
  });

  it('returns null for missing key', () => {
    expect(adapter.get('missing')).toBeNull();
  });

  it('stores and retrieves a value', () => {
    adapter.set('key', 'value');
    expect(adapter.get('key')).toBe('value');
  });

  it('overwrites existing value', () => {
    adapter.set('key', 'v1');
    adapter.set('key', 'v2');
    expect(adapter.get('key')).toBe('v2');
  });

  it('removes a value', () => {
    adapter.set('key', 'value');
    adapter.remove('key');
    expect(adapter.get('key')).toBeNull();
  });

  it('removing a missing key does not throw', () => {
    expect(() => adapter.remove('missing')).not.toThrow();
  });

  it('isolates keys between instances', () => {
    const other = new MemoryStorageAdapter();
    adapter.set('key', 'value');
    expect(other.get('key')).toBeNull();
  });
});

describe('WebStorageAdapter', () => {
  let adapter: WebStorageAdapter;

  beforeEach(() => {
    localStorage.clear();
    adapter = new WebStorageAdapter(localStorage);
  });

  it('returns null for missing key', () => {
    expect(adapter.get('missing')).toBeNull();
  });

  it('stores and retrieves a value', () => {
    adapter.set('key', 'value');
    expect(adapter.get('key')).toBe('value');
  });

  it('overwrites existing value', () => {
    adapter.set('key', 'v1');
    adapter.set('key', 'v2');
    expect(adapter.get('key')).toBe('v2');
  });

  it('removes a value', () => {
    adapter.set('key', 'value');
    adapter.remove('key');
    expect(adapter.get('key')).toBeNull();
  });

  it('works with sessionStorage', () => {
    const session = new WebStorageAdapter(sessionStorage);
    session.set('k', 'v');
    expect(session.get('k')).toBe('v');
    session.remove('k');
    expect(session.get('k')).toBeNull();
  });
});

describe('CookieStorageAdapter', () => {
  it('delegates get to callback', async () => {
    const getCookie = vi.fn().mockResolvedValue('cookie-value');
    const adapter = new CookieStorageAdapter({
      getCookie,
      setCookie: vi.fn(),
      removeCookie: vi.fn(),
    });
    const result = await adapter.get('key');
    expect(getCookie).toHaveBeenCalledWith('key');
    expect(result).toBe('cookie-value');
  });

  it('delegates set to callback', async () => {
    const setCookie = vi.fn().mockResolvedValue(undefined);
    const adapter = new CookieStorageAdapter({
      getCookie: vi.fn(),
      setCookie,
      removeCookie: vi.fn(),
    });
    await adapter.set('key', 'value');
    expect(setCookie).toHaveBeenCalledWith('key', 'value');
  });

  it('delegates remove to callback', async () => {
    const removeCookie = vi.fn().mockResolvedValue(undefined);
    const adapter = new CookieStorageAdapter({
      getCookie: vi.fn(),
      setCookie: vi.fn(),
      removeCookie,
    });
    await adapter.remove('key');
    expect(removeCookie).toHaveBeenCalledWith('key');
  });

  it('handles sync callbacks', async () => {
    const adapter = new CookieStorageAdapter({
      getCookie: vi.fn().mockReturnValue('sync-value'),
      setCookie: vi.fn(),
      removeCookie: vi.fn(),
    });
    expect(await adapter.get('k')).toBe('sync-value');
  });

  it('returns null when callback returns null', async () => {
    const adapter = new CookieStorageAdapter({
      getCookie: vi.fn().mockResolvedValue(null),
      setCookie: vi.fn(),
      removeCookie: vi.fn(),
    });
    expect(await adapter.get('missing')).toBeNull();
  });
});
