import { describe, expect, it } from 'vitest';
import { normalizeTokenSet, parseUrl, timingSafeEqual } from '../src/core/utils';
import { AuthError, AuthErrorCode } from '../src/errors/auth-error';

describe('Utils', () => {
  describe('timingSafeEqual', () => {
    it('returns true for identical strings', () => {
      expect(timingSafeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings of same length', () => {
      expect(timingSafeEqual('abc', 'abd')).toBe(false);
    });

    it('returns false for strings of different lengths', () => {
      expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    });

    it('returns true for empty strings', () => {
      expect(timingSafeEqual('', '')).toBe(true);
    });
  });

  describe('parseUrl', () => {
    it('parses a valid URL', () => {
      const url = 'https://example.com/foo?bar=baz';
      const parsed = parseUrl(url);
      expect(parsed).toBeInstanceOf(URL);
      expect(parsed.pathname).toBe('/foo');
    });

    it('throws on an invalid URL', () => {
      expect(() => parseUrl('not a url')).toThrow(AuthError);
      expect(() => parseUrl('not a url')).toThrowErrorMatchingSnapshot();
    });
  });

  describe('normalizeTokenSet', () => {
    const now = () => 1_000_000_000_000;

    it('normalizes snake_case to camelCase and calculates expiresAt', () => {
      const raw = {
        access_token: 'ac',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt',
        id_token: 'idt',
        scope: 'openid',
      };
      const normalized = normalizeTokenSet(raw, now);
      expect(normalized).toEqual({
        accessToken: 'ac',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshToken: 'rt',
        idToken: 'idt',
        scope: 'openid',
        expiresAt: 1_000_000_000_000 + 3600 * 1000,
      });
    });

    it('handles camelCase input', () => {
      const raw = {
        accessToken: 'ac',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshToken: 'rt',
        idToken: 'idt',
        scope: 'openid',
      };
      const normalized = normalizeTokenSet(raw, now);
      expect(normalized.accessToken).toBe('ac');
      expect(normalized.refreshToken).toBe('rt');
    });

    it('throws if access_token is missing', () => {
      expect(() => normalizeTokenSet({}, now)).toThrow(AuthError);
      expect(() => normalizeTokenSet({}, now)).toThrowError(
        expect.objectContaining({ code: AuthErrorCode.TOKEN_EXCHANGE_FAILED }),
      );
    });

    it('handles missing optional fields', () => {
      const raw = { access_token: 'ac' };
      const normalized = normalizeTokenSet(raw, now);
      expect(normalized.accessToken).toBe('ac');
      expect(normalized.refreshToken).toBeUndefined();
      expect(normalized.expiresAt).toBeUndefined();
    });
  });
});
