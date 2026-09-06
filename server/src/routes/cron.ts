import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '../config/env.ts';
import { ApiError } from '../lib/errors.ts';
import { runCronTick } from '../services/cron-service.ts';

/**
 * The heartbeat an external cron service pings (§5.2).
 *
 * Deliberately outside `/api/admin`: an admin session is a browser thing, and
 * the caller here is a machine with a shared secret. It is also outside the
 * obscured admin path, so the URL can be pasted into a cron service without
 * handing that path out.
 */
export const cronRoutes = new Hono();

/** Constant-time, and false for a missing or wrong-length secret. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function assertAuthorised(header: string | undefined, bearer: string | undefined): void {
  const { CRON_SECRET } = getEnv();
  if (!CRON_SECRET) {
    // Refusing beats running unauthenticated: this endpoint calls the provider.
    throw ApiError.forbidden('cron_disabled');
  }
  const provided = header ?? bearer?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secretMatches(provided, CRON_SECRET)) {
    throw ApiError.unauthorized('invalid_cron_secret');
  }
}

/**
 * POST and GET both work. Some cron services only send GET, and this is not a
 * URL a browser can be tricked into loading usefully: it needs a secret header.
 */
async function tick(header: string | undefined, bearer: string | undefined) {
  assertAuthorised(header, bearer);
  return runCronTick();
}

cronRoutes.post('/tick', async (c) =>
  c.json(await tick(c.req.header('x-cron-secret'), c.req.header('authorization'))),
);
cronRoutes.get('/tick', async (c) =>
  c.json(await tick(c.req.header('x-cron-secret'), c.req.header('authorization'))),
);
