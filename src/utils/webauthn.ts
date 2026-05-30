import { base64UrlDecode, base64UrlEncode } from '../core/base64url';
import { AuthError, AuthErrorCode } from '../errors/auth-error';

/**
 * Browser-side WebAuthn / passkey (#18) glue. The Nuria kernel hands out
 * registration / authentication options as JSON with base64url-encoded
 * binary fields (challenge, credential ids, user handle); the browser
 * `navigator.credentials` API needs those as `ArrayBuffer`s and returns
 * `ArrayBuffer`s the kernel needs back as base64url. These helpers do that
 * translation and nothing else — all challenge/origin/signature verification
 * lives server-side in `WebAuthnService`.
 *
 * The shapes below mirror the kernel's begin responses
 * (`WebAuthnService.BeginRegistrationAsync` / `BeginAuthenticationAsync`) and
 * the finish request DTOs (`WebAuthnRegisterFinishRequestDto` /
 * `WebAuthnAuthenticateFinishRequestDto`).
 */

/** A `{type, id}` credential descriptor as emitted by the kernel (id = base64url). */
export interface PublicKeyCredentialDescriptorJSON {
  type: string;
  id: string;
  transports?: string[];
}

/** Registration options from `POST /v2/me/passkeys/register/begin`. */
export interface PasskeyRegistrationOptionsJSON {
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: Array<{ type: string; alg: number }>;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
}

/** Authentication options from `POST /v2/login/passkey/begin`. */
export interface PasskeyAuthenticationOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
}

/** Attestation result for `POST /v2/me/passkeys/register/finish`. */
export interface PasskeyAttestationJSON {
  id: string;
  rawId: string;
  type: string;
  name?: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
  };
}

/** Assertion result for `POST /v2/login/passkey/finish`. */
export interface PasskeyAssertionJSON {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
}

/** True when the runtime exposes the WebAuthn API (a secure browser context). */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials
  );
}

/**
 * Resolves whether a user-verifying platform authenticator (Touch ID / Windows
 * Hello / Android biometrics) is available, so a UI can decide whether to
 * surface "use a passkey on this device". Resolves `false` (never throws) when
 * WebAuthn is unsupported or the probe itself fails.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function descriptorToNative(
  d: PublicKeyCredentialDescriptorJSON,
): PublicKeyCredentialDescriptor {
  return {
    type: 'public-key',
    id: base64UrlDecode(d.id),
    transports: d.transports as AuthenticatorTransport[] | undefined,
  };
}

function ensureSupported(): void {
  if (!isWebAuthnSupported()) {
    throw new AuthError(
      AuthErrorCode.INVALID_CONFIG,
      'WebAuthn is not available in this environment',
    );
  }
}

/**
 * Drives `navigator.credentials.create()` from the kernel's registration
 * options and returns the attestation JSON the kernel expects at
 * `register/finish`. `name` is echoed back so the credential is stored with a
 * friendly label.
 */
export async function createPasskeyCredential(
  options: PasskeyRegistrationOptionsJSON,
  name?: string,
): Promise<PasskeyAttestationJSON> {
  ensureSupported();

  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: options.rp,
    user: {
      id: base64UrlDecode(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    challenge: base64UrlDecode(options.challenge),
    pubKeyCredParams: options.pubKeyCredParams.map((p) => ({
      type: 'public-key',
      alg: p.alg,
    })),
    timeout: options.timeout,
    attestation: options.attestation,
    authenticatorSelection: options.authenticatorSelection,
    excludeCredentials: options.excludeCredentials?.map(descriptorToNative),
  };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (cause) {
    throw new AuthError(
      AuthErrorCode.CALLBACK_ERROR,
      'Passkey registration was cancelled or failed',
      cause,
    );
  }
  if (!credential) {
    throw new AuthError(
      AuthErrorCode.CALLBACK_ERROR,
      'Passkey registration returned no credential',
    );
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: base64UrlEncode(credential.rawId),
    type: credential.type,
    name: name?.trim() ? name.trim() : undefined,
    response: {
      clientDataJSON: base64UrlEncode(response.clientDataJSON),
      attestationObject: base64UrlEncode(response.attestationObject),
    },
  };
}

/**
 * Drives `navigator.credentials.get()` from the kernel's authentication
 * options and returns the assertion JSON the kernel expects at
 * `passkey/finish`.
 */
export async function getPasskeyAssertion(
  options: PasskeyAuthenticationOptionsJSON,
): Promise<PasskeyAssertionJSON> {
  ensureSupported();

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64UrlDecode(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    userVerification: options.userVerification,
    allowCredentials: options.allowCredentials?.map(descriptorToNative),
  };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (cause) {
    throw new AuthError(
      AuthErrorCode.CALLBACK_ERROR,
      'Passkey login was cancelled or failed',
      cause,
    );
  }
  if (!credential) {
    throw new AuthError(
      AuthErrorCode.CALLBACK_ERROR,
      'Passkey login returned no credential',
    );
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: base64UrlEncode(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: base64UrlEncode(response.clientDataJSON),
      authenticatorData: base64UrlEncode(response.authenticatorData),
      signature: base64UrlEncode(response.signature),
      userHandle: response.userHandle
        ? base64UrlEncode(response.userHandle)
        : undefined,
    },
  };
}
