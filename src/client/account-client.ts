import type {
  AccountClient,
  AuthTransport,
  AuthTransportRequest,
  ConsentInfo,
  DataExport,
  DeviceInfo,
  FederatedIdentityInfo,
  PasskeyInfo,
  PhoneVerificationChallenge,
  TotpEnrollment,
  TwoFactorStatus,
  UpdateProfileOptions,
  UpdateProfileResult,
} from '../core/types';
import { AuthError, AuthErrorCode } from '../errors/auth-error';
import {
  createPasskeyCredential,
  type PasskeyRegistrationOptionsJSON,
} from '../utils/webauthn';

/**
 * Implements the v7 {@link AccountClient} surface. Thin Bearer-authenticated
 * wrappers over the kernel's `/v2/me/*` endpoints. The access token is pulled
 * lazily via the injected `getAccessToken` (which the owning auth client keeps
 * fresh through silent refresh), so these calls ride the same session as the
 * rest of the SDK without holding their own token state.
 */
export class DefaultAccountClient implements AccountClient {
  constructor(
    private readonly baseUrl: string,
    private readonly transport: AuthTransport,
    private readonly getAccessToken: () => Promise<string | null>,
    /**
     * Builds the auth headers for a request. Injected by the owning auth
     * client so DPoP-bound sessions present the `DPoP` scheme + proof; falls
     * back to a plain Bearer header when omitted.
     */
    private readonly buildAuthHeaders: (
      method: string,
      url: string,
      accessToken: string,
    ) => Promise<Record<string, string>> = async (_m, _u, token) => ({
      Authorization: `Bearer ${token}`,
    }),
  ) {}

  // ── Two-factor (TOTP) ────────────────────────────────────────────────

  async getTwoFactorStatus(): Promise<TwoFactorStatus> {
    const data = await this.authed<{ totpEnabled?: boolean }>('/v2/me/2fa');
    return { totpEnabled: data?.totpEnabled === true };
  }

  async enrollTotp(): Promise<TotpEnrollment> {
    const data = await this.authed<{ secret?: string; otpauthUri?: string }>(
      '/v2/me/2fa/totp/enroll',
      { method: 'POST' },
    );
    return { secret: data?.secret ?? '', otpauthUri: data?.otpauthUri ?? '' };
  }

  async confirmTotp(code: string): Promise<void> {
    const trimmed = requireValue(code, 'code');
    await this.authed('/v2/me/2fa/totp/confirm', {
      method: 'POST',
      body: { code: trimmed },
    });
  }

  async disableTotp(): Promise<void> {
    await this.authed('/v2/me/2fa/totp', { method: 'DELETE' });
  }

  // ── OAuth consents ───────────────────────────────────────────────────

  async listConsents(): Promise<ConsentInfo[]> {
    const data = await this.authed<ConsentInfo[]>('/v2/me/consents');
    return Array.isArray(data) ? data : [];
  }

  async revokeConsent(clientId: string): Promise<void> {
    const id = requireValue(clientId, 'clientId');
    await this.authed(`/v2/me/consents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ── Known devices ────────────────────────────────────────────────────

  async listDevices(): Promise<DeviceInfo[]> {
    const data = await this.authed<DeviceInfo[]>('/v2/me/devices');
    return Array.isArray(data) ? data : [];
  }

  async trustDevice(deviceKey: string): Promise<void> {
    const key = requireValue(deviceKey, 'deviceKey');
    await this.authed(`/v2/me/devices/${encodeURIComponent(key)}/trust`, {
      method: 'POST',
    });
  }

  async untrustDevice(deviceKey: string): Promise<void> {
    const key = requireValue(deviceKey, 'deviceKey');
    await this.authed(`/v2/me/devices/${encodeURIComponent(key)}/untrust`, {
      method: 'POST',
    });
  }

  async forgetDevice(deviceKey: string): Promise<void> {
    const key = requireValue(deviceKey, 'deviceKey');
    await this.authed(`/v2/me/devices/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  }

  // ── Passkeys (WebAuthn / FIDO2) ──────────────────────────────────────

  async listPasskeys(): Promise<PasskeyInfo[]> {
    const data = await this.authed<PasskeyInfo[]>('/v2/me/passkeys');
    return Array.isArray(data) ? data : [];
  }

  async enrollPasskey(name?: string): Promise<void> {
    // begin → navigator.credentials.create() → finish. The challenge is
    // single-use and bound to this subject server-side, so the whole dance
    // must complete on one in-flight session.
    const options = await this.authed<PasskeyRegistrationOptionsJSON>(
      '/v2/me/passkeys/register/begin',
      { method: 'POST', body: name?.trim() ? { name: name.trim() } : {} },
    );
    const attestation = await createPasskeyCredential(options, name);
    await this.authed('/v2/me/passkeys/register/finish', {
      method: 'POST',
      body: attestation,
    });
  }

  async deletePasskey(credentialId: string): Promise<void> {
    const id = requireValue(credentialId, 'credentialId');
    await this.authed(`/v2/me/passkeys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ── Federated identity links ─────────────────────────────────────────

  async listIdentities(): Promise<FederatedIdentityInfo[]> {
    const data =
      await this.authed<FederatedIdentityInfo[]>('/v2/me/identities');
    return Array.isArray(data) ? data : [];
  }

  async unlinkIdentity(provider: string): Promise<void> {
    const p = requireValue(provider, 'provider');
    await this.authed(`/v2/me/identities/${encodeURIComponent(p)}`, {
      method: 'DELETE',
    });
  }

  // ── Profile ──────────────────────────────────────────────────────────

  async updateProfile(options: UpdateProfileOptions): Promise<UpdateProfileResult> {
    if (!options.name && !options.cellphone) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'At least one of name or cellphone is required for updateProfile',
      );
    }
    const body: Record<string, string> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.cellphone !== undefined) body.cellphone = options.cellphone;
    return this.authed<UpdateProfileResult>('/v2/me', {
      method: 'PATCH',
      body,
    });
  }

  // ── Email verification ────────────────────────────────────────────────

  async sendEmailVerification(): Promise<void> {
    await this.authed('/v2/me/email/verify/send', { method: 'POST' });
  }

  async confirmEmailVerification(token: string): Promise<void> {
    const t = requireValue(token, 'token');
    // No session required — token is self-authenticating. Use transport directly.
    await this.transport.request(`${this.baseUrl}/v2/email/verify/confirm`, {
      method: 'POST',
      body: { token: t },
      timeoutMs: 8_000,
    });
  }

  // ── Phone verification ────────────────────────────────────────────────

  async sendPhoneVerification(): Promise<PhoneVerificationChallenge> {
    const data = await this.authed<Record<string, unknown>>(
      '/v2/me/phone/verify/send',
      { method: 'POST' },
    );
    return {
      challengeId: String(data.challengeId ?? ''),
      channel: String(data.channel ?? ''),
      destinationMasked: String(data.destinationMasked ?? ''),
      expiresAt: Number(data.expiresAt ?? 0),
    };
  }

  async confirmPhoneVerification(options: {
    challengeId: string;
    code: string;
  }): Promise<void> {
    if (!options?.challengeId || !options?.code) {
      throw new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'challengeId and code are required for confirmPhoneVerification',
      );
    }
    await this.authed('/v2/me/phone/verify/confirm', {
      method: 'POST',
      body: { challengeId: options.challengeId, code: options.code },
    });
  }

  // ── LGPD data-subject rights ─────────────────────────────────────────

  async exportData(): Promise<DataExport> {
    return this.authed<DataExport>('/v2/me/data');
  }

  async eraseAccount(confirmEmail: string): Promise<void> {
    const email = requireValue(confirmEmail, 'confirmEmail');
    await this.authed('/v2/me/data/erase', {
      method: 'POST',
      body: { confirmEmail: email },
    });
  }

  // ── internal ─────────────────────────────────────────────────────────

  private async authed<T = unknown>(
    path: string,
    req: AuthTransportRequest = {},
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new AuthError(
        AuthErrorCode.UNAUTHENTICATED,
        'A valid session is required for account management.',
      );
    }
    const url = `${this.baseUrl}${path}`;
    const authHeaders = await this.buildAuthHeaders(
      req.method ?? 'GET',
      url,
      accessToken,
    );
    const response = await this.transport.request<T>(url, {
      ...req,
      headers: {
        ...(req.headers ?? {}),
        ...authHeaders,
      },
      timeoutMs: req.timeoutMs ?? 8_000,
    });
    return response.data;
  }
}

function requireValue(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AuthError(AuthErrorCode.INVALID_CONFIG, `${name} is required`);
  }
  return value.trim();
}
