import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import type { Db } from './repo';
import * as schema from './schema';

const sqlite = openDatabaseSync('benchbook.db');
// WAL: 書き込み完了済みのイベントを強制終了でも失わない / 外部キーを有効化
sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/** マイグレーション用（expo-sqlite専用の型） */
export const expoDb = drizzle(sqlite, { schema });

/** リポジトリ関数に渡すDB */
export const db = expoDb as unknown as Db;
