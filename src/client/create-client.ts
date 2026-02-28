import { DefaultNuriaAuthClient } from './nuria-auth-client';
import { AuthError, AuthErrorCode } from '../errors/auth-error';
import type { NuriaAuthClient, NuriaAuthConfig } from '../core/types';

export function createNuriaAuthClient(
  config: NuriaAuthConfig,
): NuriaAuthClient {
  if (!config || !config.mode) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'config.mode is required',
    );
  }
  return new DefaultNuriaAuthClient(config);
}
