// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AWS_STORAGE_KEYS,
  consumePendingAwsIdToken,
  parseAwsHashCallback,
  startAwsLogin,
} from '../src/utils/aws';

afterEach(() => {
  sessionStorage.clear();
});

describe('startAwsLogin', () => {
  it('derives the authorization endpoint from issuerUrl', () => {
    const onRedirect = vi.fn();
    startAwsLogin({
      clientId: 'aws-client',
      redirectUri: 'https://app.example.com/callback',
      issuerUrl: 'https://identitycenter.amazonaws.com/ssoins-12345abcde/',
      onRedirect,
    });
    expect(onRedirect).toHaveBeenCalledOnce();
    const url = onRedirect.mock.calls[0]![0] as string;
    expect(url).toContain(
      'https://identitycenter.amazonaws.com/ssoins-12345abcde/authorize',
    );
    expect(url).toContain('response_type=id_token');
    expect(url).toContain('client_id=aws-client');
    expect(url).toContain('scope=openid+email+profile');
    expect(url).toContain('nonce=');
    expect(url).toContain('state=');
  });

  it('honors a fully-qualified authorizationEndpoint over issuerUrl', () => {
    const onRedirect = vi.fn();
    startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: 'https://issuer.example.com/',
      authorizationEndpoint: 'https://oidc.example.com/oauth2/authorize',
      onRedirect,
    });
    const url = onRedirect.mock.calls[0]![0] as string;
    expect(url).toContain('https://oidc.example.com/oauth2/authorize?');
  });

  it('appends params with `&` when authorizationEndpoint already has a query string', () => {
    const onRedirect = vi.fn();
    startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      authorizationEndpoint: 'https://oidc.example.com/authorize?foo=bar',
      onRedirect,
    });
    const url = onRedirect.mock.calls[0]![0] as string;
    expect(url).toContain('?foo=bar&response_type=id_token');
  });

  it('throws when neither issuerUrl nor authorizationEndpoint is provided', () => {
    expect(() =>
      startAwsLogin({
        clientId: 'c',
        redirectUri: 'https://app.example.com/cb',
        onRedirect: () => {},
      }),
    ).toThrow(/issuerUrl.*authorizationEndpoint/);
  });

  it('persists nonce, state and returnSearch to sessionStorage', () => {
    startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: 'https://identitycenter.amazonaws.com/ssoins-x/',
      returnSearch: '?next=/dashboard',
      onRedirect: () => {},
    });
    expect(sessionStorage.getItem(AWS_STORAGE_KEYS.nonce)).toBeTruthy();
    expect(sessionStorage.getItem(AWS_STORAGE_KEYS.state)).toBeTruthy();
    expect(sessionStorage.getItem(AWS_STORAGE_KEYS.returnSearch)).toBe(
      '?next=/dashboard',
    );
  });

  it('respects custom scopes', () => {
    const onRedirect = vi.fn();
    startAwsLogin({
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      issuerUrl: 'https://identitycenter.amazonaws.com/ssoins-x/',
      scopes: ['openid', 'sso:account:access'],
      onRedirect,
    });
    const url = onRedirect.mock.calls[0]![0] as string;
    expect(url).toContain('scope=openid+sso%3Aaccount%3Aaccess');
  });
});

describe('parseAwsHashCallback', () => {
  it('returns null for empty hash', () => {
    expect(parseAwsHashCallback('')).toBeNull();
    expect(parseAwsHashCallback('#')).toBeNull();
  });

  it('returns null when no id_token in hash', () => {
    expect(parseAwsHashCallback('#state=abc')).toBeNull();
  });

  it('returns null when state mismatches stored state', () => {
    sessionStorage.setItem(AWS_STORAGE_KEYS.state, 'expected');
    expect(
      parseAwsHashCallback('#id_token=tok123&state=tampered'),
    ).toBeNull();
  });

  it('extracts id_token, returnSearch, clears nonce/state/returnSearch', () => {
    sessionStorage.setItem(AWS_STORAGE_KEYS.nonce, 'n');
    sessionStorage.setItem(AWS_STORAGE_KEYS.state, 's-value');
    sessionStorage.setItem(AWS_STORAGE_KEYS.returnSearch, '?next=/x');

    const result = parseAwsHashCallback('#id_token=tok123&state=s-value');
    expect(result).toEqual({ idToken: 'tok123', returnSearch: '?next=/x' });
    expect(sessionStorage.getItem(AWS_STORAGE_KEYS.nonce)).toBeNull();
    expect(sessionStorage.getItem(AWS_STORAGE_KEYS.state)).toBeNull();
    expect(sessionStorage.getItem(AWS_STORAGE_KEYS.returnSearch)).toBeNull();
    expect(sessionStorage.getItem(AWS_STORAGE_KEYS.pendingIdToken)).toBe(
      'tok123',
    );
  });

  it('accepts callbacks without state when no state was stored', () => {
    const result = parseAwsHashCallback('#id_token=plain');
    expect(result).toEqual({ idToken: 'plain', returnSearch: '' });
  });
});

describe('consumePendingAwsIdToken', () => {
  it('returns null when no pending token', () => {
    expect(consumePendingAwsIdToken()).toBeNull();
  });

  it('returns and removes the pending token', () => {
    sessionStorage.setItem(AWS_STORAGE_KEYS.pendingIdToken, 'id-tok');
    expect(consumePendingAwsIdToken()).toBe('id-tok');
    expect(sessionStorage.getItem(AWS_STORAGE_KEYS.pendingIdToken)).toBeNull();
  });
});
