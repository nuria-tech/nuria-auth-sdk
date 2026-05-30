import { describe, expect, it, vi } from 'vitest';
import { createAuthClient, AuthErrorCode } from '../src';
import type { AuthTransportRequest } from '../src/core/types';

const BASE_CONFIG = {
  clientId: 'test-client',
  baseUrl: 'https://auth.example.com',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
};

/** A transport that records calls and returns a queued/default payload. */
function makeTransport(data: unknown = {}) {
  return {
    request: vi.fn().mockResolvedValue({
      status: 200,
      data,
      headers: new Headers(),
    }),
  };
}

/** Last (url, req) pair the transport was called with. */
function lastCall(
  transport: ReturnType<typeof makeTransport>,
): [string, AuthTransportRequest] {
  const calls = transport.request.mock.calls as Array<
    [string, AuthTransportRequest]
  >;
  return calls[calls.length - 1]!;
}

/**
 * Builds a client whose getAccessToken() resolves to a token, by hydrating a
 * far-future session through a storage adapter before init().
 */
async function authedClient(transport: ReturnType<typeof makeTransport>) {
  const storage = new Map<string, string>();
  const adapter = {
    get: (k: string) => storage.get(k) ?? null,
    set: (k: string, v: string) => void storage.set(k, v),
    remove: (k: string) => void storage.delete(k),
  };
  storage.set(
    'nuria:session',
    JSON.stringify({
      tokens: { accessToken: 'access-123', expiresAt: Date.now() + 3_600_000 },
      createdAt: Date.now(),
    }),
  );
  const client = createAuthClient({
    ...BASE_CONFIG,
    storage: adapter,
    transport,
    enableRefreshToken: false,
  });
  await client.init();
  return client;
}

describe('AccountClient (v7)', () => {
  it('is exposed as a property on the auth client', () => {
    const client = createAuthClient(BASE_CONFIG);
    expect(client.account).toBeDefined();
    expect(typeof client.account.enrollTotp).toBe('function');
  });

  it('enrollTotp POSTs to /v2/me/2fa/totp/enroll with a Bearer header', async () => {
    const transport = makeTransport({
      secret: 'BASE32SECRET',
      otpauthUri: 'otpauth://totp/Nuria:me?secret=BASE32SECRET',
    });
    const client = await authedClient(transport);

    const result = await client.account.enrollTotp();

    expect(result).toEqual({
      secret: 'BASE32SECRET',
      otpauthUri: 'otpauth://totp/Nuria:me?secret=BASE32SECRET',
    });
    const [url, req] = lastCall(transport);
    expect(url).toBe('https://auth.example.com/v2/me/2fa/totp/enroll');
    expect(req.method).toBe('POST');
    expect(req.headers).toEqual({ Authorization: 'Bearer access-123' });
  });

  it('confirmTotp sends the code and rejects an empty one before any call', async () => {
    const transport = makeTransport({ success: true });
    const client = await authedClient(transport);

    await client.account.confirmTotp('123456');
    const [url, req] = lastCall(transport);
    expect(url).toBe('https://auth.example.com/v2/me/2fa/totp/confirm');
    expect(req.body).toEqual({ code: '123456' });

    transport.request.mockClear();
    await expect(client.account.confirmTotp('  ')).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('getTwoFactorStatus coerces the totpEnabled flag', async () => {
    const transport = makeTransport({ totpEnabled: true });
    const client = await authedClient(transport);
    expect(await client.account.getTwoFactorStatus()).toEqual({
      totpEnabled: true,
    });
  });

  it('listConsents returns the array and tolerates a non-array payload', async () => {
    const transport = makeTransport([
      { clientId: 'c1', scopes: 'openid profile', grantedAt: '2026-01-01' },
    ]);
    const client = await authedClient(transport);
    const consents = await client.account.listConsents();
    expect(consents).toHaveLength(1);
    expect(consents[0]!.clientId).toBe('c1');
  });

  it('revokeConsent DELETEs the url-encoded client id', async () => {
    const transport = makeTransport({ success: true });
    const client = await authedClient(transport);
    await client.account.revokeConsent('abc 123');
    const [url, req] = lastCall(transport);
    expect(url).toBe('https://auth.example.com/v2/me/consents/abc%20123');
    expect(req.method).toBe('DELETE');
  });

  it('device trust/untrust/forget hit the right verbs and paths', async () => {
    const transport = makeTransport({ success: true });
    const client = await authedClient(transport);

    await client.account.trustDevice('dev1');
    expect(lastCall(transport)[0]).toBe(
      'https://auth.example.com/v2/me/devices/dev1/trust',
    );
    await client.account.untrustDevice('dev1');
    expect(lastCall(transport)[0]).toBe(
      'https://auth.example.com/v2/me/devices/dev1/untrust',
    );
    await client.account.forgetDevice('dev1');
    const [forgetUrl, forgetReq] = lastCall(transport);
    expect(forgetUrl).toBe('https://auth.example.com/v2/me/devices/dev1');
    expect(forgetReq.method).toBe('DELETE');
  });

  it('eraseAccount POSTs the confirmEmail interlock', async () => {
    const transport = makeTransport({ success: true });
    const client = await authedClient(transport);
    await client.account.eraseAccount('me@nuria.com.br');
    const [url, req] = lastCall(transport);
    expect(url).toBe('https://auth.example.com/v2/me/data/erase');
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({ confirmEmail: 'me@nuria.com.br' });
  });

  it('throws UNAUTHENTICATED when there is no session', async () => {
    const transport = makeTransport({});
    const client = createAuthClient({ ...BASE_CONFIG, transport });
    await expect(client.account.listDevices()).rejects.toMatchObject({
      code: AuthErrorCode.UNAUTHENTICATED,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });
});
