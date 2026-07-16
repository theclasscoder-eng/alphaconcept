import type { Repository } from './types.js';
import { MemoryRepository } from './memory.js';

export * from './types.js';
export { MemoryRepository } from './memory.js';

/** Instantiate the configured repository backend. */
export async function createRepository(store: 'memory' | 'prisma'): Promise<Repository> {
  if (store === 'prisma') {
    const { PrismaRepository } = await import('./prisma.js');
    return PrismaRepository.create();
  }
  return new MemoryRepository();
}
