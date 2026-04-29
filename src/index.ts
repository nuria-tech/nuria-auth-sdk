export {
  createAuthClient,
  DEFAULT_LOGIN_METHODS,
} from './client/create-client';
export { MemoryStorageAdapter } from './storage/memory-storage-adapter';
export { WebStorageAdapter } from './storage/web-storage-adapter';
export { CookieStorageAdapter } from './storage/cookie-storage-adapter';
export {
  createBrowserCookieStorage,
  type BrowserCookieStorageOptions,
} from './storage/browser-cookie-storage';
export { FetchAuthTransport } from './transport/fetch-transport';
export { AuthError, AuthErrorCode } from './errors/auth-error';

export {
  extractRoles,
  extractCompanyOrigin,
  extractAvatarUrl,
  extractDisplayName,
  getInitials,
} from './utils/claims';
export {
  buildOAuthAuthorizeUrl,
  type OAuthAuthorizeParams,
} from './utils/oauth';
export {
  renderGoogleSignInButton,
  promptGoogleOneTap,
  cancelGooglePrompt,
  disableGoogleAutoSelect,
  GOOGLE_STORAGE_KEYS,
  type GoogleCredentialResponse,
  type RenderGoogleSignInButtonOptions,
  type PromptGoogleOneTapOptions,
} from './utils/google';
export {
  startAwsLogin,
  parseAwsQueryCallback,
  AWS_STORAGE_KEYS,
  type StartAwsLoginOptions,
  type AwsCallbackResult,
} from './utils/aws';

export type {
  AuthTransport,
  AuthTransportRequest,
  AuthTransportResponse,
  AuthClient,
  AuthConfig,
  Session,
  TokenClaims,
  StartLoginOptions,
  LoginCodeChallengeOptions,
  GoogleLoginOptions,
  AwsLoginOptions,
  LoginMethod,
  LoginMethodsConfig,
  LoginMethodsConfigInput,
  PasswordLoginOptions,
  VerifyLoginCodeOptions,
  TwoFactorChallenge,
  StorageAdapter,
  TokenSet,
  TransportInterceptor,
} from './core/types';
