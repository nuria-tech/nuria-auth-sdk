import { describe, it, expect } from 'vitest';
import { AuthError, AuthErrorCode } from '../src/errors/auth-error';

describe('AuthError', () => {
  it('is an instance of Error', () => {
    const err = new AuthError(AuthErrorCode.INVALID_CONFIG, 'bad config');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthError);
  });

  it('sets name to AuthError', () => {
    const err = new AuthError(AuthErrorCode.INVALID_CONFIG, 'msg');
    expect(err.name).toBe('AuthError');
  });

  it('stores code and message', () => {
    const err = new AuthError(AuthErrorCode.NETWORK_ERROR, 'network failure');
    expect(err.code).toBe(AuthErrorCode.NETWORK_ERROR);
    expect(err.message).toBe('network failure');
  });

  it('stores cause when provided', () => {
    const cause = new Error('root');
    const err = new AuthError(AuthErrorCode.STORAGE_ERROR, 'storage', cause);
    expect(err.cause).toBe(cause);
  });

  it('cause is undefined when not provided', () => {
    const err = new AuthError(AuthErrorCode.HTTP_ERROR, 'http');
    expect(err.cause).toBeUndefined();
  });

  it('covers all error codes', () => {
    const codes = Object.values(AuthErrorCode);
    expect(codes.length).toBeGreaterThan(0);
    codes.forEach((code) => {
      const err = new AuthError(code, 'test');
      expect(err.code).toBe(code);
    });
  });

  it('defaults details to an empty object', () => {
    const err = new AuthError(AuthErrorCode.HTTP_ERROR, 'msg');
    expect(err.details).toEqual({});
  });

  it('stores details when provided', () => {
    const err = new AuthError(
      AuthErrorCode.HTTP_ERROR,
      'HTTP 404',
      undefined,
      {
        status: 404,
        error: 'not_found',
        errorCode: 'resource_not_found',
        errorDescription: 'User was not found',
        traceId: 'trace-123',
      },
    );
    expect(err.details.status).toBe(404);
    expect(err.details.errorCode).toBe('resource_not_found');
    expect(err.details.errorDescription).toBe('User was not found');
    expect(err.details.traceId).toBe('trace-123');
  });
});
