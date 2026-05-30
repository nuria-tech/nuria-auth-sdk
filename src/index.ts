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
export {
  AuthError,
  AuthErrorCode,
  type AuthErrorDetails,
} from './errors/auth-error';

export {
  extractRoles,
  extractScopes,
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
  createGoogleCodeClient,
  GOOGLE_OAUTH2_STORAGE_KEYS,
  type GoogleCodeResponse,
  type CreateGoogleCodeClientOptions,
  type GoogleCodeClientHandle,
} from './utils/google-oauth2';
export {
  startAwsLogin,
  parseAwsQueryCallback,
  AWS_STORAGE_KEYS,
  type StartAwsLoginOptions,
  type AwsCallbackResult,
} from './utils/aws';
export {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  createPasskeyCredential,
  getPasskeyAssertion,
  type PasskeyRegistrationOptionsJSON,
  type PasskeyAuthenticationOptionsJSON,
  type PasskeyAttestationJSON,
  type PasskeyAssertionJSON,
  type PublicKeyCredentialDescriptorJSON,
} from './utils/webauthn';
export { base64UrlEncode, base64UrlDecode } from './core/base64url';

export type {
  AccountClient,
  ActorClaim,
  AuthTransport,
  AuthTransportRequest,
  AuthTransportResponse,
  AuthClient,
  AuthConfig,
  ConsentInfo,
  DataExport,
  DeviceInfo,
  DeviceUserCodeLookup,
  FederatedIdentityInfo,
  TotpEnrollment,
  TwoFactorStatus,
  Session,
  TokenClaims,
  StartLoginOptions,
  LoginCodeChallengeOptions,
  GoogleCodeLoginOptions,
  LoginMethod,
  LoginMethodsConfig,
  LoginMethodsConfigInput,
  LogoutOptions,
  OidcLoginOptions,
  OidcProvider,
  PasskeyInfo,
  PasskeyLoginOptions,
  PasswordLoginOptions,
  VerifyLoginCodeOptions,
  TwoFactorChallenge,
  StorageAdapter,
  TokenSet,
  TransportInterceptor,
} from './core/types';
