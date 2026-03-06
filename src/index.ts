export { createAuthClient } from './client/create-client';
export { MemoryStorageAdapter } from './storage/memory-storage-adapter';
export { WebStorageAdapter } from './storage/web-storage-adapter';
export { CookieStorageAdapter } from './storage/cookie-storage-adapter';
export {
  createBrowserCookieStorage,
  type BrowserCookieStorageOptions,
} from './storage/browser-cookie-storage';
export { FetchAuthTransport } from './transport/fetch-transport';
export { AuthError, AuthErrorCode } from './errors/auth-error';

export type {
  AuthTransport,
  AuthTransportRequest,
  AuthTransportResponse,
  AuthClient,
  AuthConfig,
  Session,
  StartLoginOptions,
  LoginCodeChallengeOptions,
  GoogleLoginOptions,
  PasswordLoginOptions,
  VerifyLoginCodeOptions,
  TwoFactorChallenge,
  StorageAdapter,
  TokenSet,
  TransportInterceptor,
} from './core/types';
