import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { Db } from '../repo';
import * as schema from '../schema';

/** アプリと同じマイグレーションSQLを当てたテスト用DB（既定はメモリ上） */
export function openTestDb(path = ':memory:'): { db: Db; raw: Database.Database } {
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return { db: db as unknown as Db, raw };
}
