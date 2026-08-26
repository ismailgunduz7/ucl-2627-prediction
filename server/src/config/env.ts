import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { resolve } from 'node:path';

// Load the repo-root .env (one level up from server/) so a single env file
// serves the whole monorepo, matching .env.example.
loadDotenv({ path: resolve(process.cwd(), '../.env') });
loadDotenv(); // also allow a server-local .env to override, if present

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1_209_600),
  ADMIN_PATH: z.string().startsWith('/').default('/yonetim'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  FOOTBALL_DATA_API_TOKEN: z.string().default(''),
  // Background provider polling (§5.2). Off by default so local runs and the
  // mock clock stay under the admin's control; on for a real deployment.
  SYNC_SCHEDULER_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProd = () => getEnv().NODE_ENV === 'production';
