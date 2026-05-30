import type { AssuranceLevel, TokenClaims } from '../core/types';

/**
 * Step-up authentication helpers (OIDC `acr`/`amr`/`auth_time`, RFC 8176).
 *
 * A 1:1 client-side mirror of the kernel's `StepUpPolicy` so a UI can decide,
 * *before* calling a sensitive endpoint, whether the current session already
 * meets the required assurance — and skip a needless re-auth round-trip when
 * it does. The kernel re-checks server-side; these helpers never grant access,
 * they only decide whether to prompt.
 */

// Authentication Context Class References (acr), ordered low → high. Namespaced
// under urn:nuria:acr so they never collide with a relying party's own scheme.
export const ACR_SINGLE_FACTOR = 'urn:nuria:acr:1';
export const ACR_MULTI_FACTOR = 'urn:nuria:acr:2';

// Authentication Method References (amr), RFC 8176.
export const AMR_PASSWORD = 'pwd';
export const AMR_OTP = 'otp'; // TOTP / email or SMS one-time code
export const AMR_SMS = 'sms';
export const AMR_MFA = 'mfa'; // marker: more than one factor was used
export const AMR_HARDWARE_KEY = 'hwk'; // passkey / security key (WebAuthn)
export const AMR_PIN = 'pin';

function rank(acr: string | undefined): number {
  if (acr === ACR_MULTI_FACTOR) return 2;
  if (acr === ACR_SINGLE_FACTOR) return 1;
  return 0;
}

function toAmrArray(amr: string | string[] | undefined): string[] {
  if (Array.isArray(amr))
    return amr.map((m) => String(m).trim()).filter(Boolean);
  if (typeof amr === 'string') {
    return amr
      .split(/[,\s]+/)
      .map((m) => m.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Derives the acr from the set of methods used: two or more distinct factors
 * (or an explicit `mfa` marker) → multi-factor; a single method →
 * single-factor; none → undefined. Mirrors `StepUpPolicy.DeriveAcr`.
 */
export function deriveAcr(
  amr: readonly string[] | undefined,
): string | undefined {
  if (!amr || amr.length === 0) return undefined;
  if (amr.includes(AMR_MFA) || amr.length >= 2) return ACR_MULTI_FACTOR;
  return ACR_SINGLE_FACTOR;
}

/**
 * True when `sessionAcr` satisfies `requiredAcr`. A lower-or-equal requirement
 * is met; an empty requirement is always met; a session with no acr only meets
 * "no requirement". Mirrors `StepUpPolicy.SatisfiesAcr`.
 */
export function satisfiesAcr(
  sessionAcr: string | undefined,
  requiredAcr: string | undefined,
): boolean {
  if (!requiredAcr || !requiredAcr.trim()) return true;
  return rank(sessionAcr) >= rank(requiredAcr);
}

/**
 * True when the authentication is fresh enough: `authTime` is within
 * `maxAgeSeconds` of `nowSeconds`. A null/zero/negative max-age means no
 * freshness requirement; a missing `authTime` fails any positive one. Mirrors
 * `StepUpPolicy.SatisfiesMaxAge`.
 */
export function satisfiesMaxAge(
  authTime: number | undefined,
  maxAgeSeconds: number | undefined,
  nowSeconds: number,
): boolean {
  if (!maxAgeSeconds || maxAgeSeconds <= 0) return true;
  if (authTime === undefined || authTime === null) return false;
  return nowSeconds - authTime <= maxAgeSeconds;
}

/** Reads the assurance level carried by a set of token claims. */
export function readAssurance(
  claims: TokenClaims | null | undefined,
): AssuranceLevel {
  if (!claims) return { amr: [] };
  return {
    acr: typeof claims.acr === 'string' ? claims.acr : undefined,
    amr: toAmrArray(claims.amr),
    authTime:
      typeof claims.auth_time === 'number' ? claims.auth_time : undefined,
  };
}
