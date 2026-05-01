// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGoogleCodeClient,
  GOOGLE_OAUTH2_STORAGE_KEYS,
} from '../src/utils/google-oauth2';
import { AuthError, AuthErrorCode } from '../src/errors/auth-error';

interface MockOauth2 {
  initCodeClient: ReturnType<typeof vi.fn>;
}

interface CapturedConfig {
  client_id: string;
  scope: string;
  state?: string;
  callback?: (resp: {
    code?: string;
    scope?: string;
    state?: string;
    authuser?: string;
    error?: string;
    error_description?: string;
  }) => void;
  error_callback?: (err: { type: string; message?: string }) => void;
  ux_mode?: string;
  redirect_uri?: string;
  login_hint?: string;
  hd?: string;
  select_account?: boolean;
  prompt?: string;
}

const installMockOauth2 = (): { mock: MockOauth2; requestCode: ReturnType<typeof vi.fn> } => {
  const requestCode = vi.fn();
  const mock: MockOauth2 = {
    initCodeClient: vi.fn(() => ({ requestCode })),
  };
  (window as unknown as { google: { accounts: { oauth2: MockOauth2 } } }).google = {
    accounts: { oauth2: mock },
  };
  return { mock, requestCode };
};

const lastConfig = (mock: MockOauth2): CapturedConfig =>
  mock.initCodeClient.mock.calls[mock.initCodeClient.mock.calls.length - 1]![0] as CapturedConfig;

describe('createGoogleCodeClient', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    delete (window as unknown as { google?: unknown }).google;
  });

  it('initializes the GIS code client with sensible defaults and a stored CSRF state', async () => {
    const { mock } = installMockOauth2();
    await createGoogleCodeClient({
      clientId: 'gc',
      onCode: () => {},
    });
    expect(mock.initCodeClient).toHaveBeenCalledOnce();
    const cfg = lastConfig(mock);
    expect(cfg.client_id).toBe('gc');
    expect(cfg.scope).toBe('openid email profile');
    expect(cfg.ux_mode).toBe('popup');
    expect(typeof cfg.state).toBe('string');
    expect(cfg.state!.length).toBe(32);
    expect(sessionStorage.getItem(GOOGLE_OAUTH2_STORAGE_KEYS.state)).toBe(cfg.state);
  });

  it('forwards login_hint, hd, select_account, prompt, and custom scope/state', async () => {
    const { mock } = installMockOauth2();
    await createGoogleCodeClient({
      clientId: 'gc',
      scope: 'openid email',
      loginHint: 'lucas@nuria.com.br',
      hd: 'nuria.com.br',
      selectAccount: true,
      prompt: 'consent',
      state: 'fixed-state-123',
      onCode: () => {},
    });
    const cfg = lastConfig(mock);
    expect(cfg.scope).toBe('openid email');
    expect(cfg.login_hint).toBe('lucas@nuria.com.br');
    expect(cfg.hd).toBe('nuria.com.br');
    expect(cfg.select_account).toBe(true);
    expect(cfg.prompt).toBe('consent');
    expect(cfg.state).toBe('fixed-state-123');
  });

  it('requires redirectUri when uxMode is "redirect"', async () => {
    installMockOauth2();
    await expect(
      createGoogleCodeClient({
        clientId: 'gc',
        uxMode: 'redirect',
        onCode: () => {},
      }),
    ).rejects.toThrowError(/redirectUri is required/);
  });

  it('passes redirect_uri through in redirect mode', async () => {
    const { mock } = installMockOauth2();
    await createGoogleCodeClient({
      clientId: 'gc',
      uxMode: 'redirect',
      redirectUri: 'https://accounts.nuria.com.br/google/callback',
      onCode: () => {},
    });
    const cfg = lastConfig(mock);
    expect(cfg.ux_mode).toBe('redirect');
    expect(cfg.redirect_uri).toBe('https://accounts.nuria.com.br/google/callback');
  });

  it('routes the code through onCode when GIS callback fires with a matching state', async () => {
    const { mock, requestCode } = installMockOauth2();
    const onCode = vi.fn();
    const handle = await createGoogleCodeClient({
      clientId: 'gc',
      state: 'state-A',
      onCode,
    });
    handle.requestCode();
    expect(requestCode).toHaveBeenCalledOnce();
    const cfg = lastConfig(mock);
    cfg.callback!({
      code: 'auth-code-xyz',
      scope: 'openid email profile',
      state: 'state-A',
      authuser: '0',
    });
    expect(onCode).toHaveBeenCalledOnce();
    expect(onCode.mock.calls[0]![0]).toEqual({
      code: 'auth-code-xyz',
      scope: 'openid email profile',
      state: 'state-A',
      authuser: '0',
    });
    // CSRF token consumed.
    expect(sessionStorage.getItem(GOOGLE_OAUTH2_STORAGE_KEYS.state)).toBeNull();
  });

  it('forwards STATE_MISMATCH to onError when GIS returns a different state', async () => {
    const { mock } = installMockOauth2();
    const onCode = vi.fn();
    const onError = vi.fn();
    await createGoogleCodeClient({
      clientId: 'gc',
      state: 'state-A',
      onCode,
      onError,
    });
    const cfg = lastConfig(mock);
    cfg.callback!({
      code: 'auth-code-xyz',
      scope: 'openid email profile',
      state: 'tampered-state',
    });
    expect(onCode).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    const err = onError.mock.calls[0]![0];
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe(AuthErrorCode.STATE_MISMATCH);
  });

  it('forwards OAuth-level errors (Google "error" field) to onError', async () => {
    const { mock } = installMockOauth2();
    const onCode = vi.fn();
    const onError = vi.fn();
    await createGoogleCodeClient({ clientId: 'gc', onCode, onError });
    const cfg = lastConfig(mock);
    cfg.callback!({
      error: 'access_denied',
      error_description: 'User denied access',
    });
    expect(onCode).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0].message).toContain('access_denied');
    expect(onError.mock.calls[0]![0].message).toContain('User denied access');
  });

  it('forwards GIS-level errors (popup blocked, dismissed) to onError via error_callback', async () => {
    const { mock } = installMockOauth2();
    const onCode = vi.fn();
    const onError = vi.fn();
    await createGoogleCodeClient({ clientId: 'gc', onCode, onError });
    const cfg = lastConfig(mock);
    cfg.error_callback!({ type: 'popup_closed', message: 'Popup window closed' });
    expect(onCode).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0].message).toContain('popup_closed');
    // Stored state cleared so the next attempt mints a fresh one.
    expect(sessionStorage.getItem(GOOGLE_OAUTH2_STORAGE_KEYS.state)).toBeNull();
  });

  it('forwards errors when GIS callback returns no code and no error', async () => {
    const { mock } = installMockOauth2();
    const onCode = vi.fn();
    const onError = vi.fn();
    await createGoogleCodeClient({ clientId: 'gc', onCode, onError });
    const cfg = lastConfig(mock);
    cfg.callback!({});
    expect(onCode).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0].message).toMatch(/no code and no error/i);
  });
});
