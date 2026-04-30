export enum AuthErrorCode {
  INVALID_CONFIG = 'INVALID_CONFIG',
  STATE_MISMATCH = 'STATE_MISMATCH',
  CALLBACK_ERROR = 'CALLBACK_ERROR',
  TOKEN_EXCHANGE_FAILED = 'TOKEN_EXCHANGE_FAILED',
  REFRESH_FAILED = 'REFRESH_FAILED',
  STORAGE_ERROR = 'STORAGE_ERROR',
  MISSING_CODE = 'MISSING_CODE',
  MISSING_STATE = 'MISSING_STATE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  HTTP_ERROR = 'HTTP_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
}

export interface AuthErrorDetails {
  status?: number;
  error?: string;
  errorCode?: string;
  errorDescription?: string;
  traceId?: string;
  feature?: string;
  body?: unknown;
}

export class AuthError extends Error {
  public readonly details: AuthErrorDetails;

  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly cause?: unknown,
    details: AuthErrorDetails = {},
  ) {
    super(message);
    this.name = 'AuthError';
    this.details = details;
  }
}
