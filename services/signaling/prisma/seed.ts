/**
 * Development seed. Only meaningful for the Prisma/Postgres backend; with the
 * in-memory store there is nothing to persist. Safe to run repeatedly.
 */
async function main(): Promise<void> {
  if ((process.env.SIGNALING_STORE ?? 'memory') !== 'prisma') {
    console.log('SIGNALING_STORE is not "prisma"; nothing to seed.');
    return;
  }
  const { PrismaClient } = (await import('@prisma/client')) as unknown as {
    PrismaClient: new () => { $disconnect(): Promise<void> };
  };
  const db = new PrismaClient();
  console.log('Connected to database. No demo records are seeded by default.');
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
