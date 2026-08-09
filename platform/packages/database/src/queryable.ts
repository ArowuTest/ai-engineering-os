import type { Pool } from 'pg';

export type DatabaseQueryable = Pick<Pool, 'query'>;
