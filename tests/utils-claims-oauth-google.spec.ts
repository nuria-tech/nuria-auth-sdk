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
  startGoogleLogin,
  parseGoogleHashCallback,
  consumePendingGoogleIdToken,
} from '../src/utils/google';

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

// ─── Google utils ─────────────────────────────────────────────────────────────

describe('startGoogleLogin', () => {
  it('calls onRedirect with a Google accounts URL containing the nonce', () => {
    const onRedirect = vi.fn();
    startGoogleLogin({
      clientId: 'google-client',
      redirectUri: 'https://app.example.com/callback',
      onRedirect,
    });
    expect(onRedirect).toHaveBeenCalledOnce();
    expect(onRedirect).toHaveBeenCalledWith(expect.stringContaining('accounts.google.com'));
    expect(onRedirect).toHaveBeenCalledWith(expect.stringContaining('response_type=id_token'));
    expect(onRedirect).toHaveBeenCalledWith(expect.stringContaining('client_id=google-client'));
    expect(onRedirect).toHaveBeenCalledWith(expect.stringContaining('nonce='));
  });

  it('persists nonce and returnSearch to sessionStorage', () => {
    startGoogleLogin({
      clientId: 'gc',
      redirectUri: 'https://app.example.com/cb',
      returnSearch: '?state=x',
      onRedirect: () => {},
    });
    expect(sessionStorage.getItem(GOOGLE_STORAGE_KEYS.nonce)).toBeTruthy();
    expect(sessionStorage.getItem(GOOGLE_STORAGE_KEYS.returnSearch)).toBe('?state=x');
  });
});

describe('parseGoogleHashCallback', () => {
  it('returns null for empty hash', () => {
    expect(parseGoogleHashCallback('')).toBeNull();
    expect(parseGoogleHashCallback('#')).toBeNull();
  });

  it('returns null when no id_token in hash', () => {
    expect(parseGoogleHashCallback('#state=abc')).toBeNull();
  });

  it('extracts id_token and returnSearch, clears storage', () => {
    sessionStorage.setItem(GOOGLE_STORAGE_KEYS.returnSearch, '?state=pkce');
    sessionStorage.setItem(GOOGLE_STORAGE_KEYS.nonce, 'nonce-value');

    const result = parseGoogleHashCallback('#id_token=tok123&state=s');
    expect(result).toEqual({ idToken: 'tok123', returnSearch: '?state=pkce' });

    expect(sessionStorage.getItem(GOOGLE_STORAGE_KEYS.nonce)).toBeNull();
    expect(sessionStorage.getItem(GOOGLE_STORAGE_KEYS.returnSearch)).toBeNull();
    expect(sessionStorage.getItem(GOOGLE_STORAGE_KEYS.pendingIdToken)).toBe('tok123');
  });
});

describe('consumePendingGoogleIdToken', () => {
  it('returns null when no pending token', () => {
    sessionStorage.removeItem(GOOGLE_STORAGE_KEYS.pendingIdToken);
    expect(consumePendingGoogleIdToken()).toBeNull();
  });

  it('returns and removes the pending token', () => {
    sessionStorage.setItem(GOOGLE_STORAGE_KEYS.pendingIdToken, 'id-tok');
    expect(consumePendingGoogleIdToken()).toBe('id-tok');
    expect(sessionStorage.getItem(GOOGLE_STORAGE_KEYS.pendingIdToken)).toBeNull();
  });
});
