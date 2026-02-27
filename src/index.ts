export { createNuriaAuthClient } from './client/create-client';
export { MemoryStorageAdapter } from './storage/memory-storage-adapter';
export { WebStorageAdapter } from './storage/web-storage-adapter';
export { CookieStorageAdapter } from './storage/cookie-storage-adapter';
export { FetchAuthTransport } from './transport/fetch-transport';
export { AuthError, AuthErrorCode } from './errors/auth-error';

export type {
  AuthTransport,
  AuthTransportRequest,
  AuthTransportResponse,
  NuriaAuthClient,
  NuriaAuthConfig,
  RedirectConfig,
  Session,
  StartLoginOptions,
  StorageAdapter,
  TokenSet,
  TransportInterceptor,
  WhitelabelConfig,
} from './core/types';
