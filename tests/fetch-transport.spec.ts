import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FetchAuthTransport } from '../src/transport/fetch-transport';
import { AuthErrorCode } from '../src/errors/auth-error';

type FetchFn = typeof fetch;
type FetchMock = ReturnType<typeof vi.fn> & FetchFn;

function makeFetchMock(): FetchMock {
  return vi.fn() as unknown as FetchMock;
}

function makeResponse(
  status: number,
  body: unknown,
  contentType = 'application/json',
): Response {
  const headers = new Headers({ 'content-type': contentType });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(String(body)),
  } as unknown as Response;
}

describe('FetchAuthTransport', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = makeFetchMock();
  });

  it('makes a GET request by default', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { ok: true }));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock });
    const result = await transport.request('https://example.com/api');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true });
  });

  it('makes a POST request with JSON body', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, {}));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock });
    await transport.request('https://example.com/api', {
      method: 'POST',
      body: { foo: 'bar' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ foo: 'bar' }),
      }),
    );
  });

  it('sends custom headers', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, {}));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock });
    await transport.request('https://example.com/api', {
      headers: { Authorization: 'Bearer token' },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer token',
    );
  });

  it('appends query params and ignores undefined values', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, {}));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock });
    await transport.request('https://example.com/api', {
      query: { foo: 'bar', baz: undefined },
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('foo=bar');
    expect(url).not.toContain('baz');
  });

  it('parses text body for non-JSON content-type', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, 'plain text', 'text/plain'));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock });
    const result = await transport.request('https://example.com/api');
    expect(result.data).toBe('plain text');
  });

  it('throws HTTP_ERROR for non-ok status without retries', async () => {
    fetchMock.mockResolvedValue(makeResponse(400, {}));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock });
    await expect(
      transport.request('https://example.com/api'),
    ).rejects.toMatchObject({ code: AuthErrorCode.HTTP_ERROR });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-retryable status codes', async () => {
    fetchMock.mockResolvedValue(makeResponse(400, {}));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock, retries: 3 });
    await expect(
      transport.request('https://example.com/api'),
    ).rejects.toMatchObject({ code: AuthErrorCode.HTTP_ERROR });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable status and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(503, {}))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock, retries: 1 });
    const result = await transport.request('https://example.com/api');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ ok: true });
  });

  it('throws after exhausting all retries', async () => {
    fetchMock.mockResolvedValue(makeResponse(503, {}));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock, retries: 2 });
    await expect(
      transport.request('https://example.com/api'),
    ).rejects.toMatchObject({ code: AuthErrorCode.HTTP_ERROR });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('wraps network errors in NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock });
    await expect(
      transport.request('https://example.com/api'),
    ).rejects.toMatchObject({ code: AuthErrorCode.NETWORK_ERROR });
  });

  it('runs request interceptors', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, {}));
    const onRequest = vi
      .fn()
      .mockImplementation((_url: string, req: object) => ({
        ...req,
        headers: { 'X-Test': 'yes' },
      }));
    const transport = new FetchAuthTransport({
      fetchFn: fetchMock,
      interceptors: [{ onRequest }],
    });
    await transport.request('https://example.com/api');
    expect(onRequest).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Test']).toBe('yes');
  });

  it('runs response interceptors', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { a: 1 }));
    const onResponse = vi
      .fn()
      .mockImplementation((res: object) => ({ ...res, data: { b: 2 } }));
    const transport = new FetchAuthTransport({
      fetchFn: fetchMock,
      interceptors: [{ onResponse }],
    });
    const result = await transport.request('https://example.com/api');
    expect(onResponse).toHaveBeenCalled();
    expect(result.data).toEqual({ b: 2 });
  });

  it('aborts request after timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    });
    const transport = new FetchAuthTransport({
      fetchFn: fetchMock,
      timeoutMs: 100,
    });
    const promise = transport.request('https://example.com/api');
    vi.advanceTimersByTime(200);
    await expect(promise).rejects.toMatchObject({
      code: AuthErrorCode.NETWORK_ERROR,
    });
    vi.useRealTimers();
  });

  it('returns headers on successful response', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, {}));
    const transport = new FetchAuthTransport({ fetchFn: fetchMock });
    const result = await transport.request('https://example.com/api');
    expect(result.headers).toBeInstanceOf(Headers);
  });
});
