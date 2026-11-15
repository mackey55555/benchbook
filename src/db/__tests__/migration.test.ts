import fs from 'node:fs';
import path from 'node:path';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { computeScore } from '@/domain/rules';

import { importBackup, parseBackup } from '../backup';
import { getGameBundle, listGames } from '../repo';
import { openTestDb } from './testDb';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'backup-v1.json'), 'utf8');

/**
 * 既存データの移行テスト。
 * マイグレーションを追加したら、追加前のスキーマで作ったデータ（このフィクスチャ）が
 * 追加後も同じ集計値で読めることをここで確認する。フィクスチャは書き換えない。
 */
describe('マイグレーション', () => {
  it('v1のバックアップを読み込み、集計値が変わらない', () => {
    const { db } = openTestDb();
    const result = importBackup(db, parseBackup(fixture));
    expect(result).toMatchObject({ games: 1, events: 6, teams: 2, players: 3 });
    const game = listGames(db)[0];
    expect(game.score).toEqual({ A: 5, B: 2 });
    const bundle = getGameBundle(db, game.game.id)!;
    expect(computeScore(bundle.events)).toEqual({ A: 5, B: 2 });
    expect(bundle.roster).toHaveLength(3);
    expect(bundle.checks[0]).toMatchObject({ period: 1, matched: true });
  });

  it('データのあるDBに再度マイグレーションをかけても内容が変わらない', () => {
    const { db } = openTestDb();
    importBackup(db, parseBackup(fixture));
    const before = getGameBundle(db, listGames(db)[0].game.id);
    migrate(db as unknown as BetterSQLite3Database, { migrationsFolder: './drizzle' });
    expect(getGameBundle(db, listGames(db)[0].game.id)).toEqual(before);
  });
});
