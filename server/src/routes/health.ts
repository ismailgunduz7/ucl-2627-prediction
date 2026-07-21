import { Hono } from 'hono';
import { query } from '../db/pool.ts';

export const healthRoutes = new Hono();

// Liveness: process is up.
healthRoutes.get('/', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

// Readiness: DB reachable.
healthRoutes.get('/ready', async (c) => {
  try {
    await query('SELECT 1');
    return c.json({ status: 'ready', db: 'up' });
  } catch {
    return c.json({ status: 'degraded', db: 'down' }, 503);
  }
});
