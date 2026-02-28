export enum AuthErrorCode {
  INVALID_CONFIG = 'INVALID_CONFIG',
  UNSUPPORTED_MODE = 'UNSUPPORTED_MODE',
  UNSUPPORTED_OPERATION = 'UNSUPPORTED_OPERATION',
  STATE_MISMATCH = 'STATE_MISMATCH',
  CALLBACK_ERROR = 'CALLBACK_ERROR',
  TOKEN_EXCHANGE_FAILED = 'TOKEN_EXCHANGE_FAILED',
  REFRESH_FAILED = 'REFRESH_FAILED',
  STORAGE_ERROR = 'STORAGE_ERROR',
  MISSING_CODE = 'MISSING_CODE',
  MISSING_STATE = 'MISSING_STATE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  HTTP_ERROR = 'HTTP_ERROR',
}

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
