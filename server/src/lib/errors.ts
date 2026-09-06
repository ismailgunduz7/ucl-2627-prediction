import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { MessageParams } from './i18n.ts';

/**
 * An error carrying an HTTP status and a machine-readable code.
 *
 * It deliberately holds no words. The code names the message in
 * `src/i18n/messages.ts`, and the edge renders it in the language the request
 * asked for, so the same failure reads correctly for a Turkish and an English
 * reader without the services knowing either language.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    public readonly params?: MessageParams,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  static unauthorized(code = 'unauthorized', params?: MessageParams) {
    return new ApiError(401, code, params);
  }
  static forbidden(code = 'forbidden', params?: MessageParams) {
    return new ApiError(403, code, params);
  }
  static badRequest(code = 'bad_request', params?: MessageParams, details?: unknown) {
    return new ApiError(400, code, params, details);
  }
  static tooManyRequests(retryAfterSeconds: number) {
    return new ApiError(
      429,
      'too_many_requests',
      { minutes: Math.ceil(retryAfterSeconds / 60) },
      { retryAfterSeconds },
    );
  }
}
