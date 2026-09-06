import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { getEnv, isProd } from './config/env.ts';
import { ApiError } from './lib/errors.ts';
import { resolveLocale, t, withLocale } from './lib/i18n.ts';
import { authRoutes } from './routes/auth.ts';
import { adminRoutes } from './routes/admin.ts';
import { participantRoutes } from './routes/participant.ts';
import { cronRoutes } from './routes/cron.ts';
import { healthRoutes } from './routes/health.ts';
import type { AuthVariables } from './middleware/auth.ts';

export function createApp() {
  const { CLIENT_ORIGIN } = getEnv();
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use('*', logger());
  app.use(
    '/api/*',
    cors({
      origin: CLIENT_ORIGIN,
      credentials: true, // required so the refresh cookie is sent/accepted
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
    }),
  );

  // Every request runs inside its own language, so the labels the services
  // derive come out in it without any of them taking a locale argument.
  app.use('*', (c, next) => withLocale(resolveLocale(c.req.header('accept-language')), next));

  app.route('/health', healthRoutes);
  app.route('/api/auth', authRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/cron', cronRoutes);
  app.route('/api', participantRoutes);

  // Centralised error handling → consistent { error: { code, message } } shape.
  // The code is the truth; the sentence is rendered here, in the language the
  // request asked for, so no service has to know what language anyone reads.
  app.onError((err, c) => {
    const locale = resolveLocale(c.req.header('accept-language'));
    if (err instanceof ApiError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: t(locale, `errors.${err.code}`, err.params),
            details: err.details,
          },
        },
        err.status,
      );
    }
    console.error('Unhandled error:', err);
    return c.json(
      {
        error: {
          code: 'internal_error',
          message: isProd()
            ? t(locale, 'errors.internal_error')
            : String(err instanceof Error ? err.message : err),
        },
      },
      500,
    );
  });

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'not_found',
          message: t(resolveLocale(c.req.header('accept-language')), 'errors.not_found'),
        },
      },
      404,
    ),
  );

  return app;
}
