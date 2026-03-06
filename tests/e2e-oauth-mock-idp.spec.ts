import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createAuthClient } from '../src';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

describe('e2e oauth flow with mock idp', () => {
  let server: Server;
  let baseUrl = '';
  let redirectUrl = '';
  let latestCode = '';
  let refreshCalls = 0;

  beforeAll(async () => {
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const requestUrl = new URL(req.url ?? '/', baseUrl);

      if (requestUrl.pathname === '/v2/oauth/authorize') {
        const state = requestUrl.searchParams.get('state');
        const redirectUri = requestUrl.searchParams.get('redirect_uri');
        if (!state || !redirectUri) {
          res.statusCode = 400;
          res.end('missing state or redirect_uri');
          return;
        }

        latestCode = `code-${Date.now()}`;
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', latestCode);
        callback.searchParams.set('state', state);

        res.statusCode = 302;
        res.setHeader('Location', callback.toString());
        res.end();
        return;
      }

      if (requestUrl.pathname === '/v2/oauth/token') {
        const body = await readBody(req);
        const params = new URLSearchParams(body);
        const grantType = params.get('grant_type');

        if (grantType === 'authorization_code') {
          if (params.get('code') !== latestCode) {
            res.statusCode = 400;
            res.end('invalid code');
            return;
          }

          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              access_token: 'access-initial',
              refresh_token: 'refresh-initial',
              token_type: 'Bearer',
              expires_in: 1,
            }),
          );
          return;
        }

        if (grantType === 'refresh_token') {
          refreshCalls++;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              access_token: `access-refresh-${refreshCalls}`,
              token_type: 'Bearer',
              expires_in: 3600,
            }),
          );
          return;
        }

        res.statusCode = 400;
        res.end('unsupported grant');
        return;
      }

      if (requestUrl.pathname === '/logout') {
        res.statusCode = 204;
        res.end();
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to start mock idp');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    redirectUrl = `${baseUrl}/app/callback`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => (err ? reject(err) : resolve()));
    });
  });

  it('runs login, callback, refresh and logout against mock idp', async () => {
    let now = 1_000;
    let capturedAuthRedirect = '';
    let capturedLogoutRedirect = '';

    const auth = createAuthClient({
      clientId: 'e2e-client',
      baseUrl,
      redirectUri: redirectUrl,
      logoutEndpoint: `${baseUrl}/logout`,
      enableRefreshToken: true,
      now: () => now,
      onRedirect: (url) => {
        if (url.includes('/logout')) {
          capturedLogoutRedirect = url;
          return;
        }
        capturedAuthRedirect = url;
      },
    });

    await auth.startLogin();
    expect(capturedAuthRedirect).toContain('/v2/oauth/authorize');

    const authResponse = await fetch(capturedAuthRedirect, {
      redirect: 'manual',
    });
    const callbackUrl = authResponse.headers.get('location');
    expect(callbackUrl).toContain('/app/callback');

    await auth.handleRedirectCallback(callbackUrl ?? '');
    expect(auth.getSession()?.tokens.accessToken).toBe('access-initial');

    now = 3_000;
    const refreshedToken = await auth.getAccessToken();
    expect(refreshedToken).toBe('access-refresh-1');
    expect(refreshCalls).toBe(1);

    await auth.logout({ returnTo: `${baseUrl}/app` });
    expect(auth.getSession()).toBeNull();
    expect(capturedLogoutRedirect).toContain('/logout');
    expect(capturedLogoutRedirect).toContain('returnTo=');
  });
});
