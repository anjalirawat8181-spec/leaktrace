import { Pool } from 'pg';
import { loadSsmConfig, poolFromConfig } from '@leaktrace/adapters';

export async function connectDeployPool(): Promise<Pool> {
  if (process.env.APP_MODE === 'aws') return poolFromConfig(await loadSsmConfig());
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required outside aws mode');
  return new Pool({ connectionString: process.env.DATABASE_URL });
}
