import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** An error carrying an HTTP status + machine-readable code for the client. */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static unauthorized(message = 'Kimlik doğrulanamadı', code = 'unauthorized') {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'Bunu yapma yetkin yok', code = 'forbidden') {
    return new ApiError(403, code, message);
  }
  static badRequest(message = 'Geçersiz istek', code = 'bad_request', details?: unknown) {
    return new ApiError(400, code, message, details);
  }
  static tooManyRequests(message: string, retryAfterSeconds: number) {
    return new ApiError(429, 'too_many_requests', message, { retryAfterSeconds });
  }
}
