/**
 * Validated environment configuration. The process refuses to start if required
 * secrets are missing or weak. No secret has a default value.
 */
import { z } from 'zod';

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SIGNALING_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  SIGNALING_PUBLIC_URL: z.string().default('ws://localhost:8080'),
  SIGNALING_STORE: z.enum(['memory', 'prisma']).default('memory'),
  SIGNALING_ALLOWED_ORIGINS: z.string().default('*'),

  DATABASE_URL: z.string().optional(),

  // Secrets: must be present and reasonably long. No defaults.
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  DEVICE_CHALLENGE_SECRET: z.string().min(16, 'DEVICE_CHALLENGE_SECRET must be at least 16 chars'),

  STUN_URL: z.string().default('stun:stun.l.google.com:19302'),
  TURN_URL: z.string().optional(),
  TURN_SHARED_SECRET: z.string().optional(),
  TURN_CREDENTIAL_TTL: z.coerce.number().int().positive().default(3600),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid signaling environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.SIGNALING_STORE === 'prisma' && !env.DATABASE_URL) {
    throw new Error('SIGNALING_STORE=prisma requires DATABASE_URL to be set.');
  }
  if (env.TURN_URL && !env.TURN_SHARED_SECRET) {
    throw new Error('TURN_URL requires TURN_SHARED_SECRET to derive time-limited credentials.');
  }
  return env;
}
