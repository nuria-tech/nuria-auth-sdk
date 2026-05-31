// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  createAuthClient,
  createPasskeyCredential,
  getPasskeyAssertion,
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
  type AuthTransportRequest,
  type PasskeyAuthenticationOptionsJSON,
  type PasskeyRegistrationOptionsJSON,
} from '../src';
import { AuthErrorCode } from '../src';

function bytes(...vals: number[]): ArrayBuffer {
  return new Uint8Array(vals).buffer;
}

/** Installs a minimal WebAuthn surface on the happy-dom window/navigator. */
function installWebAuthn(creds: Partial<CredentialsContainer>): void {
  // PublicKeyCredential just needs to be defined for the support probe.
  (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential =
    (window as unknown as { PublicKeyCredential?: unknown })
      .PublicKeyCredential ?? function PublicKeyCredential() {};
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: creds,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  // Drop the stubbed credentials container so unrelated tests see a clean env.
  if ('credentials' in navigator) {
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: undefined,
    });
  }
});

describe('base64url codec', () => {
  it('round-trips arbitrary bytes without padding', () => {
    const raw = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = base64UrlEncode(raw);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlDecode(encoded))).toEqual(Array.from(raw));
  });

  it('decodes a value the kernel would emit (url-safe alphabet)', () => {
    // "??>>" in standard base64 → uses - and _ in url-safe form.
    expect(Array.from(base64UrlDecode('-_8'))).toEqual([251, 255]);
  });
});

describe('isWebAuthnSupported / platform authenticator', () => {
  it('is false when navigator.credentials is absent', () => {
    expect(isWebAuthnSupported()).toBe(false);
  });

  it('detects support and probes the platform authenticator', async () => {
    installWebAuthn({ create: vi.fn(), get: vi.fn() } as never);
    (
      window as unknown as { PublicKeyCredential: Record<string, unknown> }
    ).PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi
      .fn()
      .mockResolvedValue(true);
    expect(isWebAuthnSupported()).toBe(true);
    await expect(isPlatformAuthenticatorAvailable()).resolves.toBe(true);
  });

  it('platform probe resolves false (never throws) on error', async () => {
    installWebAuthn({ create: vi.fn(), get: vi.fn() } as never);
    (
      window as unknown as { PublicKeyCredential: Record<string, unknown> }
    ).PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi
      .fn()
      .mockRejectedValue(new Error('nope'));
    await expect(isPlatformAuthenticatorAvailable()).resolves.toBe(false);
  });
});

describe('createPasskeyCredential', () => {
  const regOptions: PasskeyRegistrationOptionsJSON = {
    rp: { id: 'nuria.com.br', name: 'Nuria' },
    user: {
      id: base64UrlEncode(bytes(10, 20, 30)),
      name: 'lucas@nuria.com.br',
      displayName: 'Lucas',
    },
    challenge: base64UrlEncode(bytes(1, 2, 3, 4)),
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    excludeCredentials: [
      { type: 'public-key', id: base64UrlEncode(bytes(9, 9, 9)) },
    ],
  };

  it('decodes options to buffers, calls create(), serializes attestation', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'cred-id',
      rawId: bytes(5, 6, 7),
      type: 'public-key',
      response: {
        clientDataJSON: bytes(100, 101),
        attestationObject: bytes(200, 201),
      },
    });
    installWebAuthn({ create } as never);

    const result = await createPasskeyCredential(regOptions, '  My Laptop  ');

    // Options passed to navigator.credentials.create were decoded to buffers.
    const arg = create.mock.calls[0]![0] as {
      publicKey: PublicKeyCredentialCreationOptions;
    };
    expect(arg.publicKey.challenge).toBeInstanceOf(Uint8Array);
    expect(
      Array.from(new Uint8Array(arg.publicKey.challenge as ArrayBuffer)),
    ).toEqual([1, 2, 3, 4]);
    expect(
      Array.from(new Uint8Array(arg.publicKey.user.id as ArrayBuffer)),
    ).toEqual([10, 20, 30]);
    expect(arg.publicKey.excludeCredentials![0]!.id).toBeInstanceOf(Uint8Array);

    // Result is the finish DTO with base64url-encoded binary fields + trimmed name.
    expect(result.id).toBe('cred-id');
    expect(result.name).toBe('My Laptop');
    expect(Array.from(base64UrlDecode(result.rawId))).toEqual([5, 6, 7]);
    expect(Array.from(base64UrlDecode(result.response.clientDataJSON))).toEqual(
      [100, 101],
    );
    expect(
      Array.from(base64UrlDecode(result.response.attestationObject)),
    ).toEqual([200, 201]);
  });

  it('wraps a user cancellation as a CALLBACK_ERROR AuthError', async () => {
    const create = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    installWebAuthn({ create } as never);
    await expect(createPasskeyCredential(regOptions)).rejects.toMatchObject({
      code: AuthErrorCode.CALLBACK_ERROR,
    });
  });

  it('throws INVALID_CONFIG when WebAuthn is unavailable', async () => {
    await expect(createPasskeyCredential(regOptions)).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CONFIG,
    });
  });
});

describe('getPasskeyAssertion', () => {
  const authOptions: PasskeyAuthenticationOptionsJSON = {
    challenge: base64UrlEncode(bytes(7, 8, 9)),
    rpId: 'nuria.com.br',
    userVerification: 'preferred',
    allowCredentials: [
      { type: 'public-key', id: base64UrlEncode(bytes(1, 1)) },
    ],
  };

  it('decodes options, calls get(), serializes assertion incl. userHandle', async () => {
    const get = vi.fn().mockResolvedValue({
      id: 'cred-id',
      rawId: bytes(2, 3),
      type: 'public-key',
      response: {
        clientDataJSON: bytes(11),
        authenticatorData: bytes(22),
        signature: bytes(33),
        userHandle: bytes(44),
      },
    });
    installWebAuthn({ get } as never);

    const result = await getPasskeyAssertion(authOptions);

    const arg = get.mock.calls[0]![0] as {
      publicKey: PublicKeyCredentialRequestOptions;
    };
    expect(
      Array.from(new Uint8Array(arg.publicKey.challenge as ArrayBuffer)),
    ).toEqual([7, 8, 9]);
    expect(result.response.userHandle).toBeDefined();
    expect(Array.from(base64UrlDecode(result.response.signature))).toEqual([
      33,
    ]);
    expect(Array.from(base64UrlDecode(result.response.userHandle!))).toEqual([
      44,
    ]);
  });

  it('omits userHandle when the authenticator returns none', async () => {
    const get = vi.fn().mockResolvedValue({
      id: 'cred-id',
      rawId: bytes(2, 3),
      type: 'public-key',
      response: {
        clientDataJSON: bytes(11),
        authenticatorData: bytes(22),
        signature: bytes(33),
        userHandle: null,
      },
    });
    installWebAuthn({ get } as never);
    const result = await getPasskeyAssertion(authOptions);
    expect(result.response.userHandle).toBeUndefined();
  });
});

const BASE_CONFIG = {
  clientId: 'test-client',
  baseUrl: 'https://auth.example.com',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
};

/** A transport that returns a queued payload per call, in order. */
function makeSequencedTransport(payloads: unknown[]) {
  let i = 0;
  return {
    request: vi.fn(async () => ({
      status: 200,
      data: payloads[Math.min(i++, payloads.length - 1)],
      headers: new Headers(),
    })),
  };
}

function calls(transport: { request: ReturnType<typeof vi.fn> }) {
  return transport.request.mock.calls as Array<[string, AuthTransportRequest]>;
}

describe('account.enrollPasskey (end to end)', () => {
  it('runs begin → create() → finish, posting the attestation', async () => {
    const regOptions = {
      rp: { id: 'nuria.com.br', name: 'Nuria' },
      user: {
        id: base64UrlEncode(bytes(1)),
        name: 'me',
        displayName: 'Me',
      },
      challenge: base64UrlEncode(bytes(2, 2)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    };
    const create = vi.fn().mockResolvedValue({
      id: 'new-cred',
      rawId: bytes(3),
      type: 'public-key',
      response: {
        clientDataJSON: bytes(4),
        attestationObject: bytes(5),
      },
    });
    installWebAuthn({ create } as never);

    // v8: no token at rest. Seed the marker and let init() bootstrap the
    // in-memory token via the cookie refresh. The token endpoint yields an
    // access token; the begin/finish endpoints get the sequenced payloads.
    const storage = new Map<string, string>([['nuria:auth:has_session', '1']]);
    const sequenced = makeSequencedTransport([regOptions, {}]);
    const transport = {
      request: vi.fn().mockImplementation(async (url: string) => {
        if (url === BASE_CONFIG.tokenEndpoint) {
          return {
            status: 200,
            data: {
              access_token: 'tok',
              token_type: 'Bearer',
              expires_in: 3600,
            },
            headers: new Headers(),
          };
        }
        return sequenced.request();
      }),
    };
    const client = createAuthClient({
      ...BASE_CONFIG,
      enableRefreshToken: false,
      transport: transport as never,
      storage: {
        get: (k) => storage.get(k) ?? null,
        set: (k, v) => void storage.set(k, v),
        remove: (k) => void storage.delete(k),
      },
    });
    await client.init();

    await client.account.enrollPasskey('My Laptop');

    // The first transport call is the bootstrap refresh; filter to the
    // passkey-registration requests.
    const passkeyCalls = calls(transport).filter(([url]) =>
      url.includes('/passkeys/register/'),
    );
    const [beginUrl] = passkeyCalls[0]!;
    const [finishUrl, finishReq] = passkeyCalls[1]!;
    expect(beginUrl).toBe(
      'https://auth.example.com/v2/me/passkeys/register/begin',
    );
    expect(finishUrl).toBe(
      'https://auth.example.com/v2/me/passkeys/register/finish',
    );
    expect(finishReq.method).toBe('POST');
    expect((finishReq.body as { name?: string }).name).toBe('My Laptop');
    expect((finishReq.body as { id?: string }).id).toBe('new-cred');
  });
});

describe('client.loginWithPasskey (passwordless)', () => {
  it('runs begin → get() → finish, then establishes a session', async () => {
    const authOptions = {
      challenge: base64UrlEncode(bytes(9, 9)),
      rpId: 'nuria.com.br',
      userVerification: 'preferred',
      allowCredentials: [],
    };
    const get = vi.fn().mockResolvedValue({
      id: 'cred',
      rawId: bytes(1),
      type: 'public-key',
      response: {
        clientDataJSON: bytes(2),
        authenticatorData: bytes(3),
        signature: bytes(4),
        userHandle: bytes(5),
      },
    });
    installWebAuthn({ get } as never);

    const transport = makeSequencedTransport([
      authOptions,
      { access_token: 'pk-access', token_type: 'Bearer', expires_in: 900 },
    ]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      enableRefreshToken: false,
      transport: transport as never,
    });

    const session = await client.loginWithPasskey({ email: 'me@nuria.com.br' });

    expect(session.tokens.accessToken).toBe('pk-access');
    const [beginUrl, beginReq] = calls(transport)[0]!;
    const [finishUrl] = calls(transport)[1]!;
    expect(beginUrl).toBe('https://auth.example.com/v2/login/passkey/begin');
    expect((beginReq.body as { email?: string }).email).toBe('me@nuria.com.br');
    expect(finishUrl).toBe('https://auth.example.com/v2/login/passkey/finish');
    expect(client.isAuthenticated()).toBe(true);
  });

  it('sends an empty body for usernameless login', async () => {
    const get = vi.fn().mockResolvedValue({
      id: 'cred',
      rawId: bytes(1),
      type: 'public-key',
      response: {
        clientDataJSON: bytes(2),
        authenticatorData: bytes(3),
        signature: bytes(4),
      },
    });
    installWebAuthn({ get } as never);
    const transport = makeSequencedTransport([
      { challenge: base64UrlEncode(bytes(1)), allowCredentials: [] },
      { access_token: 'pk', expires_in: 900 },
    ]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      enableRefreshToken: false,
      transport: transport as never,
    });
    await client.loginWithPasskey();
    expect(calls(transport)[0]![1].body).toEqual({});
  });
});
