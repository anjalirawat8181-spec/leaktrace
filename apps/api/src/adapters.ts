import { createAdapters, type Adapters } from '@leaktrace/adapters';
import { getPool } from './db';

let current: Adapters | undefined;

export function getAdapters(): Adapters {
  current ??= createAdapters('local', { pool: getPool() });
  return current;
}

/** Tests can swap in their own adapters (e.g. a temp data directory). */
export function setAdapters(adapters: Adapters): void {
  current = adapters;
}
