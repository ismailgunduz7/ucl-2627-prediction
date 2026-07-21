import { serve } from '@hono/node-server';
import { getEnv } from './config/env.ts';
import { assertDomainInvariants } from './domain/constants.ts';
import { createApp } from './app.ts';
import { closePool } from './db/pool.ts';

// Fail fast if the structural game rules were tampered with (§3.9).
assertDomainInvariants();

const env = getEnv();
const app = createApp();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port} (${env.NODE_ENV})`);
});

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  server.close();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
