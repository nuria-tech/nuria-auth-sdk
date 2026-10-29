import { describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  AuthErrorCode,
  MemoryStorageAdapter,
  createAuthClient,
  type AuthTransportRequest,
} from '../src';

const BASE_CONFIG = {
  clientId: 'test-client',
  baseUrl: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
};

const MFA_BODY = {
  mfaRequired: true,
  mfa: {
    challengeId: 'chal-1',
    channel: 'totp',
    destinationMasked: 'app autenticador',
    expiresAt: 1_900_000_000,
    purpose: 'login',
  },
};

const STEP_UP_BODY = {
  stepUpRequired: true,
  stepUp: {
    challengeId: 'chal-2',
    channel: 'email',
    destinationMasked: 'l***@nuria.com.br',
    expiresAt: 1_900_000_000,
    purpose: 'step_up',
  },
};

const SUCCESS_BODY = {
  Token: 'x',
  RefreshToken: 'y',
  ExpiresAt: Date.now() + 60_000,
};

function makeMockTransport(data: Record<string, unknown> = {}) {
  return {
    request: vi
      .fn()
      .mockResolvedValue({ status: 200, data, headers: new Headers() }),
  };
}

function callsOf(transport: ReturnType<typeof makeMockTransport>) {
  return transport.request.mock.calls as Array<[string, AuthTransportRequest]>;
}

function makeClient(transport: ReturnType<typeof makeMockTransport>) {
  return createAuthClient({
    ...BASE_CONFIG,
    transport,
    storage: new MemoryStorageAdapter(),
  });
}

describe('MFA challenge on primary login endpoints', () => {
  const cases: Array<{
    name: string;
    path: string;
    run: (client: ReturnType<typeof makeClient>) => Promise<unknown>;
  }> = [
    {
      name: 'loginWithPassword',
      path: '/v2/login',
      run: (c) =>
        c.loginWithPassword({ email: 'a@nuria.com.br', password: 'pw' }),
    },
    {
      name: 'loginWithMagicLink',
      path: '/v2/login/magic/verify',
      run: (c) => c.loginWithMagicLink({ token: 'abc.def' }),
    },
    {
      name: 'verifyLoginCode',
      path: '/v2/2fa/verify-login',
      run: (c) => c.verifyLoginCode({ challengeId: 'c', code: '123456' }),
    },
    {
      name: 'forceResetPassword',
      path: '/v2/password/force-reset',
      run: (c) => c.forceResetPassword('new-password', 'reset-token'),
    },
  ];

  for (const { name, path, run } of cases) {
    it(`${name} throws MFA_REQUIRED with the challenge`, async () => {
      const transport = makeMockTransport(MFA_BODY);
      const error = (await run(makeClient(transport)).catch(
        (e: unknown) => e,
      )) as AuthError;

      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe(AuthErrorCode.MFA_REQUIRED);
      expect(error.details.mfa).toEqual({
        challengeId: 'chal-1',
        channel: 'totp',
        destinationMasked: 'app autenticador',
        expiresAt: 1_900_000_000,
        purpose: 'login',
      });
      expect(error.details.body).toEqual(MFA_BODY);
      expect(callsOf(transport)[0]![0]).toBe(`${BASE_CONFIG.baseUrl}${path}`);
    });

    it(`${name} throws STEP_UP_REQUIRED with the step-up challenge`, async () => {
      const transport = makeMockTransport(STEP_UP_BODY);
      const error = (await run(makeClient(transport)).catch(
        (e: unknown) => e,
      )) as AuthError;

      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe(AuthErrorCode.STEP_UP_REQUIRED);
      expect(error.details.stepUp?.challengeId).toBe('chal-2');
      expect(error.details.stepUp?.purpose).toBe('step_up');
    });

    it(`${name} still returns a session on a normal response`, async () => {
      const transport = makeMockTransport(SUCCESS_BODY);
      const session = (await run(makeClient(transport))) as {
        tokens: { accessToken: string; refreshToken?: string };
      };

      expect(session.tokens.accessToken).toBe('x');
      expect(session.tokens.refreshToken).toBeUndefined();
    });
  }

  it('does not treat mfaRequired false as a challenge', async () => {
    const transport = makeMockTransport({
      ...SUCCESS_BODY,
      mfaRequired: false,
    });
    const session = await makeClient(transport).loginWithPassword({
      email: 'a@nuria.com.br',
      password: 'pw',
    });

    expect(session.tokens.accessToken).toBe('x');
  });
});

describe('verifyMfaLogin', () => {
  it('sends challengeId and code and returns a session', async () => {
    const transport = makeMockTransport(SUCCESS_BODY);
    const session = await makeClient(transport).verifyMfaLogin({
      challengeId: 'chal-1',
      code: '123456',
    });

    const [url, req] = callsOf(transport)[0]!;
    expect(url).toBe('https://auth.example.com/v2/login/mfa/verify');
    expect(req.method).toBe('POST');
    expect(req.credentials).toBe('include');
    expect(req.body).toEqual({ challengeId: 'chal-1', code: '123456' });
    expect(session.tokens.accessToken).toBe('x');
    expect(session.tokens.refreshToken).toBeUndefined();
  });

  it('sends challengeId and recoveryCode and returns a session', async () => {
    const transport = makeMockTransport(SUCCESS_BODY);
    const session = await makeClient(transport).verifyMfaLogin({
      challengeId: 'chal-1',
      recoveryCode: 'ABCD-EFGH',
    });

    const [, req] = callsOf(transport)[0]!;
    expect(req.body).toEqual({
      challengeId: 'chal-1',
      recoveryCode: 'ABCD-EFGH',
    });
    expect(session.tokens.accessToken).toBe('x');
  });

  it('rejects a missing challengeId without calling the network', async () => {
    const transport = makeMockTransport(SUCCESS_BODY);
    await expect(
      makeClient(transport).verifyMfaLogin({
        challengeId: '',
        code: '123456',
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('rejects when neither code nor recoveryCode is given', async () => {
    const transport = makeMockTransport(SUCCESS_BODY);
    await expect(
      makeClient(transport).verifyMfaLogin({ challengeId: 'chal-1' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('rejects when both code and recoveryCode are given', async () => {
    const transport = makeMockTransport(SUCCESS_BODY);
    await expect(
      makeClient(transport).verifyMfaLogin({
        challengeId: 'chal-1',
        code: '123456',
        recoveryCode: 'ABCD-EFGH',
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CONFIG });
    expect(transport.request).not.toHaveBeenCalled();
  });
});

describe('AccountClient MFA surface', () => {
  function makeAccountTransport(data: unknown = {}) {
    return {
      request: vi.fn().mockImplementation(async (url: string) => ({
        status: 200,
        data:
          url === BASE_CONFIG.tokenEndpoint
            ? {
                access_token: 'access-123',
                token_type: 'Bearer',
                expires_in: 3600,
              }
            : data,
        headers: new Headers(),
      })),
    };
  }

  function lastCall(
    transport: ReturnType<typeof makeAccountTransport>,
  ): [string, AuthTransportRequest] {
    const calls = transport.request.mock.calls as Array<
      [string, AuthTransportRequest]
    >;
    return calls[calls.length - 1]!;
  }

  async function authedClient(
    transport: ReturnType<typeof makeAccountTransport>,
  ) {
    const storage = new MemoryStorageAdapter();
    void storage.set('nuria:auth:has_session', '1');
    const client = createAuthClient({
      ...BASE_CONFIG,
      storage,
      transport,
      enableRefreshToken: false,
    });
    await client.init();
    return client;
  }

  it('getTwoFactorStatus returns backupCodesRemaining when present', async () => {
    const transport = makeAccountTransport({
      totpEnabled: true,
      backupCodesRemaining: 7,
    });
    const client = await authedClient(transport);

    expect(await client.account.getTwoFactorStatus()).toEqual({
      totpEnabled: true,
      backupCodesRemaining: 7,
    });
  });

  it('getTwoFactorStatus returns null when backupCodesRemaining is missing or null', async () => {
    const missing = await authedClient(
      makeAccountTransport({ totpEnabled: true }),
    );
    expect(await missing.account.getTwoFactorStatus()).toEqual({
      totpEnabled: true,
      backupCodesRemaining: null,
    });

    const explicitNull = await authedClient(
      makeAccountTransport({ totpEnabled: true, backupCodesRemaining: null }),
    );
    expect(await explicitNull.account.getTwoFactorStatus()).toEqual({
      totpEnabled: true,
      backupCodesRemaining: null,
    });
  });

  it('disableTotp sends the code in the DELETE body', async () => {
    const transport = makeAccountTransport({});
    const client = await authedClient(transport);
    await client.account.disableTotp({ code: '123456' });

    const [url, req] = lastCall(transport);
    expect(url).toBe('https://auth.example.com/v2/me/2fa/totp');
    expect(req.method).toBe('DELETE');
    expect(req.body).toEqual({ code: '123456' });
  });

  it('getRecoveryCodes calls POST recovery-codes/view with the code', async () => {
    const transport = makeAccountTransport({
      recovery_codes: ['AAAA-1111', 'BBBB-2222'],
    });
    const client = await authedClient(transport);
    const codes = await client.account.getRecoveryCodes({ code: '654321' });

    const [url, req] = lastCall(transport);
    expect(url).toBe(
      'https://auth.example.com/v2/me/2fa/totp/recovery-codes/view',
    );
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({ code: '654321' });
    expect(codes).toEqual(['AAAA-1111', 'BBBB-2222']);
  });

  it('regenerateRecoveryCodes sends the code only when given', async () => {
    const transport = makeAccountTransport({ recovery_codes: ['CCCC-3333'] });
    const client = await authedClient(transport);

    await client.account.regenerateRecoveryCodes({ code: '111222' });
    expect(lastCall(transport)[1].body).toEqual({ code: '111222' });

    await client.account.regenerateRecoveryCodes();
    expect(lastCall(transport)[1].body).toBeUndefined();
  });

  it('enrollTotp without an argument still sends no body', async () => {
    const transport = makeAccountTransport({
      secret: 'S',
      otpauthUri: 'otpauth://x',
    });
    const client = await authedClient(transport);
    await client.account.enrollTotp();

    const [url, req] = lastCall(transport);
    expect(url).toBe('https://auth.example.com/v2/me/2fa/totp/enroll');
    expect(req.method).toBe('POST');
    expect(req.body).toBeUndefined();
  });

  it('enrollTotp sends the code when given', async () => {
    const transport = makeAccountTransport({
      secret: 'S',
      otpauthUri: 'otpauth://x',
    });
    const client = await authedClient(transport);
    await client.account.enrollTotp({ code: '999000' });

    expect(lastCall(transport)[1].body).toEqual({ code: '999000' });
  });
});
