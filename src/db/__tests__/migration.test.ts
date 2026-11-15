import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { computeScore } from '@/domain/rules';

import { importBackup, parseBackup } from '../backup';
import { getGameBundle, listGames, type Db } from '../repo';
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

  it('0000 のスキーマで作ったデータが、以降のマイグレーション後も同じ集計値で読める', () => {
    // 0000 だけを含むマイグレーションフォルダを作り、当時のスキーマのDBを再現する
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchbook-mig-'));
    try {
      fs.mkdirSync(path.join(dir, 'meta'));
      const journal = JSON.parse(fs.readFileSync('./drizzle/meta/_journal.json', 'utf8'));
      journal.entries = journal.entries.slice(0, 1);
      fs.writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
      fs.copyFileSync('./drizzle/0000_init.sql', path.join(dir, '0000_init.sql'));

      const raw = new Database(':memory:');
      const db = drizzle(raw);
      migrate(db, { migrationsFolder: dir });
      raw.exec(`
        insert into games (id, date, status, current_period, created_at, team_a_name, team_b_name) values ('G1', '2026-11-01', 'live', 1, 1, 'A', 'B');
        insert into game_roster (id, game_id, side, number) values ('R4', 'G1', 'A', '4'), ('R10', 'G1', 'B', '10');
        insert into game_events (id, game_id, order_key, period, side, roster_id, type, created_at) values
          ('E1', 'G1', 1, 1, 'A', 'R4', 'FG3_MADE', 1),
          ('E2', 'G1', 2, 1, 'B', 'R10', 'FT_MADE', 2),
          ('E3', 'G1', 3, 1, 'A', 'R4', 'FOUL', 3);
      `);

      migrate(db, { migrationsFolder: './drizzle' });
      const bundle = getGameBundle(db as unknown as Db, 'G1')!;
      expect(computeScore(bundle.events)).toEqual({ A: 3, B: 1 });
      expect(bundle.events).toHaveLength(3);
      expect(bundle.events.every((e) => e.clockSeconds === null)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
