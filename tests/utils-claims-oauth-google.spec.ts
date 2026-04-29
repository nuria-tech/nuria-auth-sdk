// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  extractRoles,
  extractCompanyOrigin,
  extractAvatarUrl,
  extractDisplayName,
  getInitials,
} from '../src/utils/claims';
import { buildOAuthAuthorizeUrl } from '../src/utils/oauth';
import {
  GOOGLE_STORAGE_KEYS,
  renderGoogleSignInButton,
  disableGoogleAutoSelect,
} from '../src/utils/google';
import { AuthError, AuthErrorCode } from '../src/errors/auth-error';

// ─── extractRoles ────────────────────────────────────────────────────────────

describe('extractRoles', () => {
  it('returns empty array for no sources', () => {
    expect(extractRoles()).toEqual([]);
  });

  it('returns empty array for null/undefined sources', () => {
    expect(extractRoles(null, undefined)).toEqual([]);
  });

  it('extracts from roles array', () => {
    expect(extractRoles({ roles: ['admin', 'user'] })).toEqual(['admin', 'user']);
  });

  it('extracts from roles comma-separated string', () => {
    expect(extractRoles({ roles: 'admin,user' })).toEqual(['admin', 'user']);
  });

  it('extracts from role (singular)', () => {
    expect(extractRoles({ role: 'editor' })).toEqual(['editor']);
  });

  it('extracts from permissions', () => {
    expect(extractRoles({ permissions: ['read', 'write'] })).toEqual(['read', 'write']);
  });

  it('extracts from scope (space-separated)', () => {
    expect(extractRoles({ scope: 'openid profile email' })).toEqual(['openid', 'profile', 'email']);
  });

  it('extracts from MS WS-Federation claim URI', () => {
    const key = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';
    expect(extractRoles({ [key]: 'admin' })).toEqual(['admin']);
  });

  it('deduplicates across multiple sources', () => {
    const result = extractRoles({ roles: 'admin,user' }, { roles: ['user', 'moderator'] });
    expect(result).toEqual(['admin', 'user', 'moderator']);
  });

  it('merges multiple sources', () => {
    const result = extractRoles({ roles: 'cmauth:*' }, { permissions: 'read' });
    expect(result).toEqual(['cmauth:*', 'read']);
  });
});

// ─── extractCompanyOrigin ────────────────────────────────────────────────────

describe('extractCompanyOrigin', () => {
  it('returns empty string for no sources', () => {
    expect(extractCompanyOrigin()).toBe('');
  });

  it('returns empty string for null source', () => {
    expect(extractCompanyOrigin(null)).toBe('');
  });

  it('extracts company_origin', () => {
    expect(extractCompanyOrigin({ company_origin: '180' })).toBe('180');
  });

  it('extracts companyOrigin (camelCase)', () => {
    expect(extractCompanyOrigin({ companyOrigin: '42' })).toBe('42');
  });

  it('extracts company_id', () => {
    expect(extractCompanyOrigin({ company_id: '99' })).toBe('99');
  });

  it('extracts company (fallback)', () => {
    expect(extractCompanyOrigin({ company: '7' })).toBe('7');
  });

  it('returns first non-empty value across sources', () => {
    expect(extractCompanyOrigin(null, { company_origin: '180' })).toBe('180');
  });

  it('first source wins when both have a value', () => {
    expect(
      extractCompanyOrigin({ company_origin: '1' }, { company_origin: '2' }),
    ).toBe('1');
  });
});

// ─── extractAvatarUrl ────────────────────────────────────────────────────────

describe('extractAvatarUrl', () => {
  it('returns empty string for no sources', () => {
    expect(extractAvatarUrl()).toBe('');
  });

  it('extracts picture', () => {
    expect(extractAvatarUrl({ picture: 'https://x/y.png' })).toBe('https://x/y.png');
  });

  it('prefers avatar_url over picture', () => {
    expect(
      extractAvatarUrl({ avatar_url: 'https://a/a.png', picture: 'https://b/b.png' }),
    ).toBe('https://a/a.png');
  });

  it('returns first non-empty value across sources', () => {
    expect(extractAvatarUrl(null, { picture: 'https://x/y.png' })).toBe('https://x/y.png');
  });

  it('skips blank values', () => {
    expect(extractAvatarUrl({ picture: '   ' }, { picture: 'https://x/y.png' })).toBe(
      'https://x/y.png',
    );
  });
});

// ─── extractDisplayName ──────────────────────────────────────────────────────

describe('extractDisplayName', () => {
  it('returns empty string for no sources', () => {
    expect(extractDisplayName()).toBe('');
  });

  it('extracts subject_name first', () => {
    expect(extractDisplayName({ subject_name: 'Lucas Passos', name: 'Other' })).toBe(
      'Lucas Passos',
    );
  });

  it('falls back to given_name', () => {
    expect(extractDisplayName({ given_name: 'Lucas' })).toBe('Lucas');
  });

  it('falls back to email local part when no name', () => {
    expect(extractDisplayName({ email: 'lucas@nuria.com.br' })).toBe('lucas');
  });

  it('prefers names before falling back to email across sources', () => {
    expect(
      extractDisplayName({ email: 'lucas@nuria.com.br' }, { name: 'Lucas Passos' }),
    ).toBe('Lucas Passos');
  });
});

// ─── getInitials ─────────────────────────────────────────────────────────────

describe('getInitials', () => {
  it('returns two initials for two words', () => {
    expect(getInitials('Lucas Passos')).toBe('LP');
  });

  it('returns single initial for one word', () => {
    expect(getInitials('Lucas')).toBe('L');
  });

  it('caps at max=2 by default for 3+ words', () => {
    expect(getInitials('Lucas da Silva Passos')).toBe('LD');
  });

  it('respects custom max', () => {
    expect(getInitials('Lucas da Silva', 3)).toBe('LDS');
  });

  it('trims and collapses whitespace', () => {
    expect(getInitials('  Lucas   Passos  ')).toBe('LP');
  });

  it('returns empty string for empty/null/undefined', () => {
    expect(getInitials('')).toBe('');
    expect(getInitials(null)).toBe('');
    expect(getInitials(undefined)).toBe('');
  });
});

// ─── buildOAuthAuthorizeUrl ──────────────────────────────────────────────────

describe('buildOAuthAuthorizeUrl', () => {
  const base = {
    baseUrl: 'https://auth.example.com',
    clientId: 'client-1',
    redirectUri: 'https://app.example.com/callback',
    state: 'st',
    codeChallenge: 'cc',
    sessionToken: 'tok',
  };

  it('builds a valid authorize URL', () => {
    const url = buildOAuthAuthorizeUrl(base);
    expect(url).toContain('https://auth.example.com/v2/oauth/authorize');
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=client-1');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('session_token=tok');
  });

  it('uses S256 as default code_challenge_method', () => {
    expect(buildOAuthAuthorizeUrl(base)).toContain('code_challenge_method=S256');
  });

  it('respects custom code_challenge_method', () => {
    const url = buildOAuthAuthorizeUrl({ ...base, codeChallengeMethod: 'plain' });
    expect(url).toContain('code_challenge_method=plain');
  });

  it('includes scope when provided', () => {
    const url = buildOAuthAuthorizeUrl({ ...base, scope: 'openid email' });
    expect(url).toContain('scope=openid+email');
  });

  it('includes nonce when provided', () => {
    const url = buildOAuthAuthorizeUrl({ ...base, nonce: 'n1' });
    expect(url).toContain('nonce=n1');
  });

  it('omits scope and nonce when not provided', () => {
    const url = buildOAuthAuthorizeUrl(base);
    expect(url).not.toContain('scope=');
    expect(url).not.toContain('nonce=');
  });
});

// ─── Google Identity Services (GIS) ─────────────────────────────────────────

interface MockGsi {
  initialize: ReturnType<typeof vi.fn>;
  renderButton: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  disableAutoSelect: ReturnType<typeof vi.fn>;
}

const installMockGis = (): MockGsi => {
  const mock: MockGsi = {
    initialize: vi.fn(),
    renderButton: vi.fn(),
    prompt: vi.fn(),
    cancel: vi.fn(),
    disableAutoSelect: vi.fn(),
  };
  (window as unknown as { google: { accounts: { id: MockGsi } } }).google = {
    accounts: { id: mock },
  };
  return mock;
};

// b64url helper for happy-dom (no Buffer; use btoa)
const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

const mintIdToken = (claims: Record<string, unknown>) =>
  `${b64url({ alg: 'RS256' })}.${b64url(claims)}.signature`;

describe('renderGoogleSignInButton', () => {
  it('initializes GIS with the stored nonce and renders the button', async () => {
    sessionStorage.clear();
    const gsi = installMockGis();
    const element = document.createElement('div');
    await renderGoogleSignInButton({
      clientId: 'google-client',
      element,
      onCredential: () => {},
    });
    expect(gsi.initialize).toHaveBeenCalledOnce();
    const config = gsi.initialize.mock.calls[0]![0];
    expect(config.client_id).toBe('google-client');
    expect(config.use_fedcm_for_prompt).toBe(true);
    expect(typeof config.nonce).toBe('string');
    expect(config.nonce.length).toBe(32);
    expect(sessionStorage.getItem(GOOGLE_STORAGE_KEYS.nonce)).toBe(config.nonce);
    expect(gsi.renderButton).toHaveBeenCalledWith(element, expect.objectContaining({ theme: 'outline' }));
  });

  it('invokes onCredential when the GIS callback fires with a matching nonce', async () => {
    sessionStorage.clear();
    const gsi = installMockGis();
    const onCredential = vi.fn();
    await renderGoogleSignInButton({
      clientId: 'gc',
      element: document.createElement('div'),
      onCredential,
    });
    const { nonce, callback } = gsi.initialize.mock.calls[0]![0];
    callback({
      credential: mintIdToken({ nonce, sub: 'u1', email: 'a@b' }),
      select_by: 'btn',
      clientId: 'gc',
    });
    expect(onCredential).toHaveBeenCalledOnce();
    const arg = onCredential.mock.calls[0]![0];
    expect(arg.idToken).toBeTruthy();
    expect(arg.selectBy).toBe('btn');
    // Nonce must be consumed once validated.
    expect(sessionStorage.getItem(GOOGLE_STORAGE_KEYS.nonce)).toBeNull();
  });

  it('forwards a STATE_MISMATCH error when the id_token nonce disagrees with storage', async () => {
    sessionStorage.clear();
    const gsi = installMockGis();
    const onCredential = vi.fn();
    const onError = vi.fn();
    await renderGoogleSignInButton({
      clientId: 'gc',
      element: document.createElement('div'),
      onCredential,
      onError,
    });
    const { callback } = gsi.initialize.mock.calls[0]![0];
    callback({
      credential: mintIdToken({ nonce: 'tampered', sub: 'u' }),
      select_by: 'btn',
      clientId: 'gc',
    });
    expect(onCredential).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    const err = onError.mock.calls[0]![0];
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe(AuthErrorCode.STATE_MISMATCH);
  });

  it('forwards STATE_MISMATCH when no nonce is stored at all (replay defense)', async () => {
    sessionStorage.clear();
    const gsi = installMockGis();
    const onCredential = vi.fn();
    const onError = vi.fn();
    await renderGoogleSignInButton({
      clientId: 'gc',
      element: document.createElement('div'),
      onCredential,
      onError,
    });
    sessionStorage.removeItem(GOOGLE_STORAGE_KEYS.nonce);
    const { callback } = gsi.initialize.mock.calls[0]![0];
    callback({
      credential: mintIdToken({ nonce: 'whatever' }),
      select_by: 'auto',
      clientId: 'gc',
    });
    expect(onCredential).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('disableGoogleAutoSelect', () => {
  it('calls GIS disableAutoSelect and clears the stored nonce', () => {
    const gsi = installMockGis();
    sessionStorage.setItem(GOOGLE_STORAGE_KEYS.nonce, 'pending');
    disableGoogleAutoSelect();
    expect(gsi.disableAutoSelect).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(GOOGLE_STORAGE_KEYS.nonce)).toBeNull();
  });
});
