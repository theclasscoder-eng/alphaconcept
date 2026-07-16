/**
 * Signaling service entry point. Loads and validates env, builds the server,
 * starts periodic maintenance, and listens.
 */
import { loadEnv } from './env.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const { app, hub, repo, logger } = await buildServer(env);

  const sweepTimer = setInterval(() => {
    void hub.sweep();
  }, 30_000);
  sweepTimer.unref();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(sweepTimer);
    await app.close();
    await repo.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.SIGNALING_PORT, host: '0.0.0.0' });
  logger.info(
    { port: env.SIGNALING_PORT, store: env.SIGNALING_STORE, env: env.APP_ENV },
    'signaling server listening',
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
