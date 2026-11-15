import { eq, inArray } from 'drizzle-orm';

import { RepoError, type Db } from './repo';
import * as schema from './schema';

const { teams, players, games, gameRoster, gameStaff, gameEvents, periodChecks } = schema;

export const BACKUP_FORMAT = 'benchbook-backup';
export const BACKUP_VERSION = 1;

type Row = Record<string, string | number | boolean | null>;

export interface BackupData {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  scope: 'game' | 'all';
  teams: Row[];
  players: Row[];
  games: Row[];
  gameRoster: Row[];
  gameStaff: Row[];
  gameEvents: Row[];
  periodChecks: Row[];
}

type ColType = 'string' | 'number' | 'boolean' | 'string?' | 'number?';

/** バックアップに含める列と型。ここにない列は読み込み時に捨てる */
const COLUMNS = {
  teams: { id: 'string', name: 'string', isOwn: 'boolean', createdAt: 'number' },
  players: { id: 'string', teamId: 'string', number: 'string', name: 'string', isActive: 'boolean' },
  games: {
    id: 'string',
    date: 'string',
    leagueName: 'string',
    venue: 'string',
    ownSide: 'string',
    teamAName: 'string',
    teamBName: 'string',
    periodMinutes: 'number',
    otMinutes: 'number',
    status: 'string',
    currentPeriod: 'number',
    createdAt: 'number',
    finishedAt: 'number?',
  },
  gameRoster: {
    id: 'string',
    gameId: 'string',
    side: 'string',
    playerId: 'string?',
    number: 'string',
    name: 'string',
    isStarter: 'boolean',
    isCaptain: 'boolean',
  },
  gameStaff: { id: 'string', gameId: 'string', side: 'string', role: 'string', name: 'string' },
  gameEvents: {
    id: 'string',
    gameId: 'string',
    orderKey: 'number',
    period: 'number',
    side: 'string?',
    rosterId: 'string?',
    type: 'string',
    foulKind: 'string?',
    ftAwarded: 'number?',
    createdAt: 'number',
    voidedAt: 'number?',
    replacesEventId: 'string?',
  },
  periodChecks: {
    gameId: 'string',
    period: 'number',
    scoreA: 'number',
    scoreB: 'number',
    teamFoulsA: 'number',
    teamFoulsB: 'number',
    matched: 'boolean',
    note: 'string',
    confirmedAt: 'number',
  },
} as const satisfies Record<string, Record<string, ColType>>;

type TableKey = keyof typeof COLUMNS;
const TABLE_KEYS = Object.keys(COLUMNS) as TableKey[];

function envelope(scope: 'game' | 'all'): Pick<BackupData, 'format' | 'version' | 'exportedAt' | 'scope'> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    scope,
  };
}

/** 試合1件を書き出す（出場登録はスナップショットなので、チームマスタは含めない） */
export function exportGame(db: Db, gameId: string): BackupData {
  const game = db.select().from(games).where(eq(games.id, gameId)).all();
  if (game.length === 0) throw new RepoError('試合が見つかりません');
  return {
    ...envelope('game'),
    teams: [],
    players: [],
    games: game,
    gameRoster: db.select().from(gameRoster).where(eq(gameRoster.gameId, gameId)).all(),
    gameStaff: db.select().from(gameStaff).where(eq(gameStaff.gameId, gameId)).all(),
    gameEvents: db.select().from(gameEvents).where(eq(gameEvents.gameId, gameId)).all(),
    periodChecks: db.select().from(periodChecks).where(eq(periodChecks.gameId, gameId)).all(),
  };
}

export function exportAll(db: Db): BackupData {
  return {
    ...envelope('all'),
    teams: db.select().from(teams).all(),
    players: db.select().from(players).all(),
    games: db.select().from(games).all(),
    gameRoster: db.select().from(gameRoster).all(),
    gameStaff: db.select().from(gameStaff).all(),
    gameEvents: db.select().from(gameEvents).all(),
    periodChecks: db.select().from(periodChecks).all(),
  };
}

function checkValue(value: unknown, type: ColType): boolean {
  if (value === null || value === undefined) return type.endsWith('?');
  const base = type.replace('?', '');
  return typeof value === base && (base !== 'number' || Number.isFinite(value));
}

/** JSON文字列を検証して BackupData にする。形式が違えば RepoError */
export function parseBackup(text: string): BackupData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RepoError('JSONとして読み込めませんでした');
  }
  if (typeof raw !== 'object' || raw === null) throw new RepoError('Benchbookのバックアップではありません');
  const obj = raw as Record<string, unknown>;
  if (obj.format !== BACKUP_FORMAT) throw new RepoError('Benchbookのバックアップではありません');
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    throw new RepoError('このバックアップは新しいバージョンのアプリで作られています。アプリを更新してください');
  }
  const result = {
    format: BACKUP_FORMAT,
    version: obj.version,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    scope: obj.scope === 'game' ? 'game' : 'all',
  } as BackupData;
  for (const key of TABLE_KEYS) {
    const rows = obj[key];
    if (!Array.isArray(rows)) throw new RepoError(`バックアップが壊れています（${key}）`);
    const columns = COLUMNS[key] as Record<string, ColType>;
    result[key] = rows.map((row: unknown) => {
      if (typeof row !== 'object' || row === null) {
        throw new RepoError(`バックアップが壊れています（${key}）`);
      }
      const source = row as Record<string, unknown>;
      const clean: Row = {};
      for (const [col, type] of Object.entries(columns)) {
        if (!checkValue(source[col], type)) {
          throw new RepoError(`バックアップが壊れています（${key}.${col}）`);
        }
        clean[col] = (source[col] ?? null) as Row[string];
      }
      return clean;
    });
  }
  return result;
}

export interface ImportResult {
  games: number;
  events: number;
  teams: number;
  players: number;
  /** すでに端末にあって読み飛ばした試合数 */
  skippedGames: number;
}

/**
 * バックアップを読み込む。端末にないデータだけを追加し、既存のデータは変更しない。
 * すでにある試合は丸ごと読み飛ばす（端末側の記録を上書きしない）。
 */
export function importBackup(db: Db, data: BackupData): ImportResult {
  return db.transaction((tx) => {
    const result: ImportResult = { games: 0, events: 0, teams: 0, players: 0, skippedGames: 0 };

    const existingTeams = new Set(tx.select({ id: teams.id }).from(teams).all().map((r) => r.id));
    const hasOwn = tx.select().from(teams).where(eq(teams.isOwn, true)).get() !== undefined;
    const teamIdMap = new Map<string, string>();
    for (const row of data.teams as (typeof teams.$inferInsert)[]) {
      if (existingTeams.has(row.id)) continue;
      // 自チームは1つだけ。端末にすでにあれば、取り込む側は通常のチームとして追加する
      tx.insert(teams).values({ ...row, isOwn: row.isOwn && !hasOwn }).run();
      teamIdMap.set(row.id, row.id);
      result.teams++;
    }
    const knownTeams = new Set([...existingTeams, ...teamIdMap.keys()]);
    const existingPlayers = new Set(
      tx.select({ id: players.id }).from(players).all().map((r) => r.id),
    );
    for (const row of data.players as (typeof players.$inferInsert)[]) {
      if (existingPlayers.has(row.id) || !knownTeams.has(row.teamId)) continue;
      tx.insert(players).values(row).run();
      result.players++;
    }

    const incomingIds = (data.games as (typeof games.$inferInsert)[]).map((g) => g.id);
    const existingGames = new Set(
      incomingIds.length
        ? tx
            .select({ id: games.id })
            .from(games)
            .where(inArray(games.id, incomingIds))
            .all()
            .map((r) => r.id)
        : [],
    );
    const hasLive = tx.select().from(games).where(eq(games.status, 'live')).get() !== undefined;
    const added = new Set<string>();
    for (const row of data.games as (typeof games.$inferInsert)[]) {
      if (existingGames.has(row.id)) {
        result.skippedGames++;
        continue;
      }
      // 進行中の試合は端末に1つだけ。重なる場合は準備中として取り込む
      const status = row.status === 'live' && (hasLive || added.size > 0) ? 'prep' : row.status;
      tx.insert(games).values({ ...row, status }).run();
      added.add(row.id);
      result.games++;
    }
    for (const row of data.gameRoster as (typeof gameRoster.$inferInsert)[]) {
      if (added.has(row.gameId)) tx.insert(gameRoster).values(row).run();
    }
    for (const row of data.gameStaff as (typeof gameStaff.$inferInsert)[]) {
      if (added.has(row.gameId)) tx.insert(gameStaff).values(row).run();
    }
    for (const row of data.gameEvents as (typeof gameEvents.$inferInsert)[]) {
      if (!added.has(row.gameId)) continue;
      tx.insert(gameEvents).values(row).run();
      result.events++;
    }
    for (const row of data.periodChecks as (typeof periodChecks.$inferInsert)[]) {
      if (added.has(row.gameId)) tx.insert(periodChecks).values(row).run();
    }
    return result;
  });
}
