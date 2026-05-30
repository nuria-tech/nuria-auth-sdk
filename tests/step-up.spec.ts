import { describe, expect, it } from 'vitest';
import {
  ACR_MULTI_FACTOR,
  ACR_SINGLE_FACTOR,
  AMR_MFA,
  AMR_OTP,
  AMR_PASSWORD,
  createAuthClient,
  deriveAcr,
  readAssurance,
  satisfiesAcr,
  satisfiesMaxAge,
} from '../src';

// Builds an unsigned JWT (header.payload.sig) carrying the given claims, so
// getClaims() / getAssurance() can decode it without any crypto.
function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

describe('step-up pure helpers (mirror StepUpPolicy)', () => {
  it('derives acr from the methods used', () => {
    expect(deriveAcr(undefined)).toBeUndefined();
    expect(deriveAcr([])).toBeUndefined();
    expect(deriveAcr([AMR_PASSWORD])).toBe(ACR_SINGLE_FACTOR);
    expect(deriveAcr([AMR_PASSWORD, AMR_OTP])).toBe(ACR_MULTI_FACTOR);
    expect(deriveAcr([AMR_MFA])).toBe(ACR_MULTI_FACTOR);
  });

  it('ranks acr so higher satisfies lower', () => {
    expect(satisfiesAcr(ACR_MULTI_FACTOR, ACR_SINGLE_FACTOR)).toBe(true);
    expect(satisfiesAcr(ACR_SINGLE_FACTOR, ACR_MULTI_FACTOR)).toBe(false);
    expect(satisfiesAcr(undefined, ACR_SINGLE_FACTOR)).toBe(false);
    // No requirement is always met.
    expect(satisfiesAcr(undefined, undefined)).toBe(true);
    expect(satisfiesAcr(undefined, '  ')).toBe(true);
  });

  it('gates freshness on max-age', () => {
    expect(satisfiesMaxAge(1000, undefined, 5000)).toBe(true); // no requirement
    expect(satisfiesMaxAge(1000, 0, 5000)).toBe(true);
    expect(satisfiesMaxAge(undefined, 300, 5000)).toBe(false); // can't prove
    expect(satisfiesMaxAge(4800, 300, 5000)).toBe(true); // 200s old ≤ 300
    expect(satisfiesMaxAge(4600, 300, 5000)).toBe(false); // 400s old > 300
  });

  it('reads assurance from claims, normalizing amr', () => {
    expect(readAssurance(null)).toEqual({ amr: [] });
    expect(
      readAssurance({ acr: ACR_MULTI_FACTOR, amr: 'pwd otp', auth_time: 123 }),
    ).toEqual({ acr: ACR_MULTI_FACTOR, amr: ['pwd', 'otp'], authTime: 123 });
    expect(readAssurance({ amr: ['hwk', 'mfa'] }).amr).toEqual(['hwk', 'mfa']);
  });
});

const BASE_CONFIG = {
  clientId: 'test-client',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
};

function clientWithClaims(claims: Record<string, unknown>, now: number) {
  const storage = new Map<string, string>([
    [
      'nuria:session',
      JSON.stringify({
        tokens: { accessToken: fakeJwt(claims), expiresAt: now + 3_600_000 },
        createdAt: now,
      }),
    ],
  ]);
  return createAuthClient({
    ...BASE_CONFIG,
    enableRefreshToken: false,
    now: () => now,
    storage: {
      get: (k) => storage.get(k) ?? null,
      set: (k, v) => void storage.set(k, v),
      remove: (k) => void storage.delete(k),
    },
  });
}

describe('AuthClient step-up', () => {
  const NOW = 5_000_000; // ms

  it('getAssurance returns null without a session, the level with one', async () => {
    const noSession = createAuthClient(BASE_CONFIG);
    expect(noSession.getAssurance()).toBeNull();

    const client = clientWithClaims(
      { acr: ACR_MULTI_FACTOR, amr: ['pwd', 'otp'], auth_time: 4900 },
      NOW,
    );
    await client.init();
    expect(client.getAssurance()).toEqual({
      acr: ACR_MULTI_FACTOR,
      amr: ['pwd', 'otp'],
      authTime: 4900,
    });
  });

  it('satisfiesStepUp combines acr rank and freshness against now()', async () => {
    // now() = 5_000_000ms → 5000s. auth_time 4900 → 100s old.
    const mfaFresh = clientWithClaims(
      { acr: ACR_MULTI_FACTOR, amr: ['pwd', 'otp'], auth_time: 4900 },
      NOW,
    );
    await mfaFresh.init();
    expect(mfaFresh.satisfiesStepUp(ACR_MULTI_FACTOR)).toBe(true);
    expect(mfaFresh.satisfiesStepUp(ACR_MULTI_FACTOR, 300)).toBe(true);
    expect(mfaFresh.satisfiesStepUp(ACR_MULTI_FACTOR, 50)).toBe(false); // 100s > 50

    const singleFactor = clientWithClaims(
      { acr: ACR_SINGLE_FACTOR, amr: ['pwd'], auth_time: 4990 },
      NOW,
    );
    await singleFactor.init();
    expect(singleFactor.satisfiesStepUp(ACR_MULTI_FACTOR)).toBe(false);
    expect(singleFactor.satisfiesStepUp(ACR_SINGLE_FACTOR)).toBe(true);

    const noSession = createAuthClient(BASE_CONFIG);
    expect(noSession.satisfiesStepUp(ACR_SINGLE_FACTOR)).toBe(false);
  });

  it('stepUp redirects with acr_values, max_age and prompt=login', async () => {
    let redirected = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        redirected = url;
      },
    });

    await client.stepUp({ maxAgeSeconds: 120 });

    const url = new URL(redirected);
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('acr_values')).toBe(ACR_MULTI_FACTOR);
    expect(url.searchParams.get('max_age')).toBe('120');
  });

  it('stepUp honors a custom acr', async () => {
    let redirected = '';
    const client = createAuthClient({
      ...BASE_CONFIG,
      onRedirect: (url) => {
        redirected = url;
      },
    });
    await client.stepUp({ acr: ACR_SINGLE_FACTOR });
    expect(new URL(redirected).searchParams.get('acr_values')).toBe(
      ACR_SINGLE_FACTOR,
    );
  });
});
