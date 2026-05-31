import { describe, expect, it, vi } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  createAuthClient,
  createDpopSigner,
  DpopSigner,
  type AuthTransportRequest,
} from '../src';

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(seg)));
}

async function makeSigner(now?: () => number): Promise<DpopSigner> {
  return createDpopSigner(now ? { now } : undefined);
}

describe('DpopSigner', () => {
  it('exports a P-256 EC public JWK and a stable thumbprint', async () => {
    const signer = await makeSigner();
    const jwk = await signer.getPublicJwk();
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    expect(jwk.x).toBeTruthy();
    expect(jwk.y).toBeTruthy();
    const t1 = await signer.getThumbprint();
    const t2 = await signer.getThumbprint();
    expect(t1).toBe(t2);
    expect(t1).not.toMatch(/[+/=]/); // base64url
  });

  it('mints a dpop+jwt proof with the right header and claims', async () => {
    const signer = await makeSigner(() => 1_700_000_000_000);
    const proof = await signer.createProof({
      htm: 'post',
      htu: 'https://auth.nuria.com.br/v2/oauth/token?foo=bar#frag',
    });
    const [h, p, sig] = proof.split('.');
    const header = decodeSegment(h!);
    const payload = decodeSegment(p!);

    expect(header.typ).toBe('dpop+jwt');
    expect(header.alg).toBe('ES256');
    expect((header.jwk as { kty: string }).kty).toBe('EC');
    // htm uppercased; htu stripped of query + fragment.
    expect(payload.htm).toBe('POST');
    expect(payload.htu).toBe('https://auth.nuria.com.br/v2/oauth/token');
    expect(payload.iat).toBe(1_700_000_000); // seconds, from injected now
    expect(typeof payload.jti).toBe('string');
    expect(payload.ath).toBeUndefined();
    expect(sig).toBeTruthy();
  });

  it('binds the proof to an access token via ath', async () => {
    const signer = await makeSigner();
    const token = 'header.payload.signature';
    const proof = await signer.createProof({
      htm: 'GET',
      htu: 'https://auth.nuria.com.br/v2/oauth/userinfo',
      accessToken: token,
    });
    const payload = decodeSegment(proof.split('.')[1]!);

    const expected = base64UrlEncode(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    );
    expect(payload.ath).toBe(expected);
  });

  it('produces fresh jti values per proof', async () => {
    const signer = await makeSigner();
    const a = decodeSegment(
      (await signer.createProof({ htm: 'GET', htu: 'https://x/y' })).split(
        '.',
      )[1]!,
    );
    const b = decodeSegment(
      (await signer.createProof({ htm: 'GET', htu: 'https://x/y' })).split(
        '.',
      )[1]!,
    );
    expect(a.jti).not.toBe(b.jti);
  });

  it('signs proofs verifiable by the embedded public key', async () => {
    const signer = await makeSigner();
    const proof = await signer.createProof({
      htm: 'GET',
      htu: 'https://auth.nuria.com.br/v2/oauth/userinfo',
    });
    const [h, p, sig] = proof.split('.');
    const jwk = decodeSegment(h!).jwk as JsonWebKey;
    const key = await crypto.subtle.importKey(
      'jwk',
      { ...jwk, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64UrlDecode(sig!),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});

// ── Integration with the auth client ───────────────────────────────────────

const BASE_CONFIG = {
  clientId: 'test-client',
  baseUrl: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  userinfoEndpoint: 'https://auth.example.com/userinfo',
  redirectUri: 'https://app.example.com/callback',
};

function makeTransport(data: unknown = {}) {
  return {
    request: vi.fn().mockResolvedValue({
      status: 200,
      data,
      headers: new Headers(),
    }),
  };
}

async function authedClient(
  transport: ReturnType<typeof makeTransport>,
  extra: Record<string, unknown> = {},
) {
  // v8: no token at rest. Seed the "has session" marker and let init()
  // bootstrap the in-memory access token via the cookie refresh. The token
  // endpoint must yield `tok-abc` so the rest of the assertions (Bearer/DPoP
  // tok-abc) hold; all other URLs fall through to the test's payload.
  const resourceRequest = transport.request;
  transport.request = vi
    .fn()
    .mockImplementation(async (url: string, req?: AuthTransportRequest) => {
      if (url === BASE_CONFIG.tokenEndpoint) {
        return {
          status: 200,
          data: {
            access_token: 'tok-abc',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          headers: new Headers(),
        };
      }
      return resourceRequest(url, req);
    }) as typeof transport.request;

  const storage = new Map<string, string>([['nuria:auth:has_session', '1']]);
  const client = createAuthClient({
    ...BASE_CONFIG,
    enableRefreshToken: false,
    transport: transport as never,
    storage: {
      get: (k) => storage.get(k) ?? null,
      set: (k, v) => void storage.set(k, v),
      remove: (k) => void storage.delete(k),
    },
    ...extra,
  });
  await client.init();
  return client;
}

describe('AuthClient + DPoP', () => {
  it('defaults to a Bearer header when DPoP is not configured', async () => {
    const transport = makeTransport({ sub: 'u1' });
    const client = await authedClient(transport);
    await client.getUserinfo();
    const [, req] = transport.request.mock.calls[
      transport.request.mock.calls.length - 1
    ]! as [string, AuthTransportRequest];
    expect(req.headers).toEqual({ Authorization: 'Bearer tok-abc' });
  });

  it('presents resource requests under the DPoP scheme with an ath proof', async () => {
    const dpop = await makeSigner();
    const transport = makeTransport({ sub: 'u1' });
    const client = await authedClient(transport, { dpop });

    await client.getUserinfo();
    const [url, req] = transport.request.mock.calls[
      transport.request.mock.calls.length - 1
    ]! as [string, AuthTransportRequest];
    const headers = req.headers!;
    expect(headers.Authorization).toBe('DPoP tok-abc');
    expect(headers.DPoP).toBeTruthy();
    const payload = decodeSegment(headers.DPoP!.split('.')[1]!);
    expect(payload.htm).toBe('GET');
    expect(payload.htu).toBe(url);
    expect(payload.ath).toBeTruthy(); // bound to the access token
  });

  it('routes account calls through the DPoP scheme too', async () => {
    const dpop = await makeSigner();
    const transport = makeTransport([]);
    const client = await authedClient(transport, { dpop });
    await client.account.listPasskeys();
    const [, req] = transport.request.mock.calls[
      transport.request.mock.calls.length - 1
    ]! as [string, AuthTransportRequest];
    expect(req.headers!.Authorization).toBe('DPoP tok-abc');
    expect(req.headers!.DPoP).toBeTruthy();
  });

  it('attaches a DPoP proof (no ath) to the token request that binds the token', async () => {
    const dpop = await makeSigner();
    // The code exchange POSTs the token endpoint; capture its headers.
    const transport = makeTransport({
      access_token: 'bound-token',
      token_type: 'DPoP',
      expires_in: 900,
    });
    // No stored nonce → the exchange skips nonce validation, keeping this test
    // focused on the DPoP binding header. (Nonce handling is covered elsewhere.)
    const storage = new Map<string, string>([
      ['nuria:oauth:state', 'st'],
      ['nuria:oauth:code_verifier', 'verifier-xyz'],
    ]);
    const client = createAuthClient({
      ...BASE_CONFIG,
      dpop,
      enableRefreshToken: false,
      transport: transport as never,
      storage: {
        get: (k) => storage.get(k) ?? null,
        set: (k, v) => void storage.set(k, v),
        remove: (k) => void storage.delete(k),
      },
    });

    await client.handleRedirectCallback(
      'https://app.example.com/callback?code=abc&state=st',
    );

    const [tokenUrl, tokenReq] = transport.request.mock.calls[0]! as [
      string,
      AuthTransportRequest,
    ];
    expect(tokenUrl).toBe('https://auth.example.com/token');
    const proofPayload = decodeSegment(tokenReq.headers!.DPoP!.split('.')[1]!);
    expect(proofPayload.htm).toBe('POST');
    expect(proofPayload.htu).toBe('https://auth.example.com/token');
    expect(proofPayload.ath).toBeUndefined(); // minting, not presenting
  });
});
