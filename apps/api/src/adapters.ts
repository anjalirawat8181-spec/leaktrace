import { createAdapters, type Adapters } from '@leaktrace/adapters';
import { getPool } from './db';

let current: Adapters | undefined;

export function getAdapters(): Adapters {
  current ??= createAdapters('local', { pool: getPool() });
  return current;
}

export function setAdapters(adapters: Adapters): void {
  current = adapters;
}
