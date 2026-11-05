import type {
  AccountClient,
  AuthTransport,
  AuthTransportRequest,
  ConsentInfo,
  ConsentStatusResult,
  DataExport,
  DeviceInfo,
  FederatedIdentityInfo,
  PasskeyInfo,
  PhoneVerificationChallenge,
  SessionInfo,
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

export class DefaultAccountClient implements AccountClient {
  constructor(
    private readonly baseUrl: string,
    private readonly transport: AuthTransport,
    private readonly getAccessToken: () => Promise<string | null>,
    private readonly buildAuthHeaders: (
      method: string,
      url: string,
      accessToken: string,
    ) => Promise<Record<string, string>> = async (_m, _u, token) => ({
      Authorization: `Bearer ${token}`,
    }),
  ) {}

  async getTwoFactorStatus(): Promise<TwoFactorStatus> {
    const data = await this.authed<{
      totpEnabled?: boolean;
      backupCodesRemaining?: number | null;
    }>('/v2/me/2fa');
    return {
      totpEnabled: data?.totpEnabled === true,
      backupCodesRemaining:
        typeof data?.backupCodesRemaining === 'number'
          ? data.backupCodesRemaining
          : null,
    };
  }

  async enrollTotp(options?: { code?: string }): Promise<TotpEnrollment> {
    const data = await this.authed<{ secret?: string; otpauthUri?: string }>(
      '/v2/me/2fa/totp/enroll',
      { method: 'POST', ...optionalCodeBody(options) },
    );
    return { secret: data?.secret ?? '', otpauthUri: data?.otpauthUri ?? '' };
  }

  async confirmTotp(
    code: string,
  ): Promise<{ enabled: boolean; recoveryCodes: string[] }> {
    const trimmed = requireValue(code, 'code');
    const data = await this.authed<{
      success?: boolean;
      recovery_codes?: string[];
    }>('/v2/me/2fa/totp/confirm', { method: 'POST', body: { code: trimmed } });
    return {
      enabled: data?.success === true,
      recoveryCodes: Array.isArray(data?.recovery_codes)
        ? data.recovery_codes
        : [],
    };
  }

  async disableTotp(options: { code: string }): Promise<void> {
    const code = requireValue(options?.code ?? '', 'code');
    await this.authed('/v2/me/2fa/totp', {
      method: 'DELETE',
      body: { code },
    });
  }

  async getRecoveryCodes(options: { code: string }): Promise<string[] | null> {
    const code = requireValue(options?.code ?? '', 'code');
    try {
      const data = await this.authed<{ recovery_codes?: string[] }>(
        '/v2/me/2fa/totp/recovery-codes/view',
        { method: 'POST', body: { code } },
      );
      return Array.isArray(data?.recovery_codes) ? data.recovery_codes : null;
    } catch (e: unknown) {
      if (e instanceof AuthError && e.details.status === 404) return null;
      throw e;
    }
  }

  async regenerateRecoveryCodes(options?: {
    code?: string;
  }): Promise<string[]> {
    const data = await this.authed<{ recovery_codes?: string[] }>(
      '/v2/me/2fa/totp/recovery-codes',
      { method: 'POST', ...optionalCodeBody(options) },
    );
    return Array.isArray(data?.recovery_codes) ? data.recovery_codes : [];
  }

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

  async getConsentStatus(
    clientId: string,
    scope: string,
  ): Promise<ConsentStatusResult> {
    const id = requireValue(clientId, 'clientId');
    const params = new URLSearchParams({ client_id: id, scope });
    return this.authed<ConsentStatusResult>(
      `/v2/oauth/consent/status?${params}`,
    );
  }

  async grantConsent(clientId: string, scope: string): Promise<void> {
    const id = requireValue(clientId, 'clientId');
    await this.authed('/v2/oauth/consent', {
      method: 'POST',
      body: { client_id: id, scope },
    });
  }

  async listSessions(): Promise<SessionInfo[]> {
    const data = await this.authed<SessionInfo[]>('/v2/me/sessions');
    return Array.isArray(data) ? data : [];
  }

  async revokeSession(sessionId: string): Promise<void> {
    const id = requireValue(sessionId, 'sessionId');
    await this.authed(`/v2/me/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

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

  async listPasskeys(): Promise<PasskeyInfo[]> {
    const data = await this.authed<PasskeyInfo[]>('/v2/me/passkeys');
    return Array.isArray(data) ? data : [];
  }

  async enrollPasskey(name?: string): Promise<void> {
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

  async renamePasskey(credentialId: string, name: string): Promise<void> {
    const id = requireValue(credentialId, 'credentialId');
    const n = requireValue(name, 'name');
    await this.authed(`/v2/me/passkeys/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { name: n },
    });
  }

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

  async updateProfile(
    options: UpdateProfileOptions,
  ): Promise<UpdateProfileResult> {
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

  async sendEmailVerification(): Promise<void> {
    await this.authed('/v2/me/email/verify/send', { method: 'POST' });
  }

  async confirmEmailVerification(token: string): Promise<void> {
    const t = requireValue(token, 'token');
    await this.transport.request(`${this.baseUrl}/v2/email/verify/confirm`, {
      method: 'POST',
      body: { token: t },
      timeoutMs: 8_000,
    });
  }

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

function optionalCodeBody(options?: {
  code?: string;
}): { body: { code: string } } | Record<string, never> {
  const code = options?.code?.trim();
  return code ? { body: { code } } : {};
}

function requireValue(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AuthError(AuthErrorCode.INVALID_CONFIG, `${name} is required`);
  }
  return value.trim();
}
