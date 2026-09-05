import { serve } from '@hono/node-server';
import { getEnv } from './config/env.ts';
import { assertDomainInvariants } from './domain/constants.ts';
import { createApp } from './app.ts';
import { closePool } from './db/pool.ts';
import { startSyncScheduler, stopSyncScheduler } from './services/sync-scheduler.ts';
import { startTokenSweeper, stopTokenSweeper } from './services/token-sweeper.ts';

// Fail fast if the structural game rules were tampered with (§3.9).
assertDomainInvariants();

const env = getEnv();
const app = createApp();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port} (${env.NODE_ENV})`);
});

// Poll the score provider on a schedule (§5.2, §9.5). Without it the pipeline
// only moves when an admin triggers a sync by hand.
if (env.SYNC_SCHEDULER_ENABLED) startSyncScheduler();

// Spent refresh tokens are swept daily (§12). Unconditional: the table only
// grows without it, and a repeated DELETE costs nothing when there is nothing
// to delete.
startTokenSweeper();

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  stopSyncScheduler();
  stopTokenSweeper();
  server.close();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
