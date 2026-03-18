import type {
  AuthTransport,
  AuthTransportRequest,
  AuthTransportResponse,
  TransportInterceptor,
} from '../core/types';
import { AuthError, AuthErrorCode } from '../errors/auth-error';

export interface FetchTransportOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  interceptors?: TransportInterceptor[];
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class FetchAuthTransport implements AuthTransport {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs?: number;
  private readonly retries: number;
  private readonly interceptors: TransportInterceptor[];

  constructor(options: FetchTransportOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs;
    this.retries = options.retries ?? 0;
    this.interceptors = options.interceptors ?? [];
  }

  async request<T = unknown>(
    url: string,
    req: AuthTransportRequest = {},
  ): Promise<AuthTransportResponse<T>> {
    let request = req;
    for (const i of this.interceptors) {
      if (i.onRequest) request = await i.onRequest(url, request);
    }

    const retries = request.retries ?? this.retries;
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timeout = request.timeoutMs ?? this.timeoutMs;
      const timer = timeout
        ? setTimeout(() => controller.abort(), timeout)
        : undefined;
      try {
        const defaultContentType =
          typeof request.body === 'string'
            ? 'application/x-www-form-urlencoded'
            : 'application/json';
        const res = await this.fetchFn(this.withQuery(url, request.query), {
          method: request.method ?? 'GET',
          credentials: request.credentials,
          headers: {
            'Content-Type': defaultContentType,
            ...(request.headers ?? {}),
          },
          body:
            request.body !== undefined
              ? typeof request.body === 'string'
                ? request.body
                : JSON.stringify(request.body)
              : undefined,
          signal: controller.signal,
        });
        const data = await this.parseBody<T>(res);
        if (!res.ok) {
          if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
            attempt += 1;
            continue;
          }
          throw new AuthError(AuthErrorCode.HTTP_ERROR, `HTTP ${res.status}`);
        }
        let out: AuthTransportResponse<T> = {
          status: res.status,
          data,
          headers: res.headers,
        };
        for (const i of this.interceptors) {
          if (i.onResponse) out = await i.onResponse(out);
        }
        return out;
      } catch (cause) {
        if (cause instanceof AuthError) throw cause;
        if (attempt < retries) {
          attempt += 1;
          continue;
        }
        throw new AuthError(
          AuthErrorCode.NETWORK_ERROR,
          'Network request failed',
          cause,
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  private withQuery(
    url: string,
    query?: Record<string, string | undefined>,
  ): string {
    if (!query) return url;
    const parsed = new URL(url);
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined) parsed.searchParams.set(k, v);
    });
    return parsed.toString();
  }

  private async parseBody<T>(res: Response): Promise<T> {
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    if (contentType.includes('application/json') || contentType === '') {
      try {
        return JSON.parse(text) as T;
      } catch {
        // Fall through to return raw text if JSON parsing fails
      }
    }
    return text as unknown as T;
  }
}
