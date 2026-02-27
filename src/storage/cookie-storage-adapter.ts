import type { StorageAdapter } from '../core/types';

export interface CookieStorageCallbacks {
  getCookie(name: string): string | null | Promise<string | null>;
  setCookie(name: string, value: string): void | Promise<void>;
  removeCookie(name: string): void | Promise<void>;
}

export class CookieStorageAdapter implements StorageAdapter {
  constructor(private readonly callbacks: CookieStorageCallbacks) {}

  async get(key: string): Promise<string | null> {
    return this.callbacks.getCookie(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.callbacks.setCookie(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.callbacks.removeCookie(key);
  }
}
