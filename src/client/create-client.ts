import { DefaultAuthClient } from './nuria-auth-client';
import { AuthError, AuthErrorCode } from '../errors/auth-error';
import type { AuthClient, AuthConfig } from '../core/types';

export function createAuthClient(config: AuthConfig): AuthClient {
  if (!config?.clientId) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.clientId is required',
    );
  }
  if (!config.authorizationEndpoint) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.authorizationEndpoint is required',
    );
  }
  if (!config.tokenEndpoint) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.tokenEndpoint is required',
    );
  }
  if (!config.redirectUri) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.redirectUri is required',
    );
  }
  return new DefaultAuthClient(config);
}
