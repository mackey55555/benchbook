import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { EventType, FoulKind, GameStatus, Side } from '@/domain/types';

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isOwn: integer('is_own', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  /** 置き場所。null は個人（端末内だけ）、それ以外はサーバーのチームID */
  spaceId: text('space_id'),
  /** 同期の印。1=未送信、2=送信中、0=送信済み。更新時はトリガーが1に戻す */
  dirty: integer('dirty').notNull().default(1),
});

export const players = sqliteTable(
  'players',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    number: text('number').notNull(),
    name: text('name').notNull().default(''),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    dirty: integer('dirty').notNull().default(1),
  },
  (t) => [index('players_team_idx').on(t.teamId)],
);

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  /** YYYY-MM-DD */
  date: text('date').notNull(),
  leagueName: text('league_name').notNull().default(''),
  venue: text('venue').notNull().default(''),
  ownSide: text('own_side').$type<Side>().notNull().default('A'),
  teamAName: text('team_a_name').notNull().default(''),
  teamBName: text('team_b_name').notNull().default(''),
  periodMinutes: integer('period_minutes').notNull().default(10),
  otMinutes: integer('ot_minutes').notNull().default(5),
  status: text('status').$type<GameStatus>().notNull().default('prep'),
  currentPeriod: integer('current_period').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  finishedAt: integer('finished_at'),
  /** 時計を使っているピリオド。null、または現在のピリオドと違えば、そのピリオドでは未使用 */
  clockPeriod: integer('clock_period'),
  /** 最後に止めた（または動かし始めた）時点の残り時間（ミリ秒） */
  clockRemainingMs: integer('clock_remaining_ms'),
  /** 動いているときの開始時刻（端末の時刻、ミリ秒）。止まっていれば null */
  clockStartedAt: integer('clock_started_at'),
  /** 置き場所。null は個人（端末内だけ）、それ以外はサーバーのチームID */
  spaceId: text('space_id'),
  /** 記録した人（サーバーの利用者ID）。個人の試合と、まだ送っていない試合は null */
  createdBy: text('created_by'),
  /** 同期の印。1=未送信、2=送信中、0=送信済み。更新時はトリガーが1に戻す */
  dirty: integer('dirty').notNull().default(1),
});

/** 背番号と氏名は試合時点のスナップショット。選手マスタを後から変えても過去の記録は変わらない */
export const gameRoster = sqliteTable(
  'game_roster',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    side: text('side').$type<Side>().notNull(),
    playerId: text('player_id'),
    number: text('number').notNull(),
    name: text('name').notNull().default(''),
    isStarter: integer('is_starter', { mode: 'boolean' }).notNull().default(false),
    isCaptain: integer('is_captain', { mode: 'boolean' }).notNull().default(false),
    dirty: integer('dirty').notNull().default(1),
  },
  (t) => [index('game_roster_game_idx').on(t.gameId)],
);

export const gameStaff = sqliteTable(
  'game_staff',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    side: text('side').$type<Side>().notNull(),
    role: text('role').$type<'HC' | 'AC'>().notNull(),
    name: text('name').notNull().default(''),
    dirty: integer('dirty').notNull().default(1),
  },
  (t) => [index('game_staff_game_idx').on(t.gameId)],
);

/** イベントソーシングの本体。物理削除せず voided_at で取り消す */
export const gameEvents = sqliteTable(
  'game_events',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    orderKey: real('order_key').notNull(),
    period: integer('period').notNull(),
    side: text('side').$type<Side>(),
    rosterId: text('roster_id'),
    type: text('type').$type<EventType>().notNull(),
    foulKind: text('foul_kind').$type<FoulKind>(),
    ftAwarded: integer('ft_awarded'),
    clockSeconds: integer('clock_seconds'),
    createdAt: integer('created_at').notNull(),
    voidedAt: integer('voided_at'),
    replacesEventId: text('replaces_event_id'),
    dirty: integer('dirty').notNull().default(1),
  },
  (t) => [index('game_events_game_idx').on(t.gameId, t.orderKey)],
);

export const periodChecks = sqliteTable(
  'period_checks',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    period: integer('period').notNull(),
    scoreA: integer('score_a').notNull(),
    scoreB: integer('score_b').notNull(),
    teamFoulsA: integer('team_fouls_a').notNull(),
    teamFoulsB: integer('team_fouls_b').notNull(),
    matched: integer('matched', { mode: 'boolean' }).notNull(),
    note: text('note').notNull().default(''),
    confirmedAt: integer('confirmed_at').notNull(),
    dirty: integer('dirty').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.period] })],
);

/** サーバーへ送る削除の控え。チームの行を端末で消したときにトリガーが足す */
export const syncTombstones = sqliteTable(
  'sync_tombstones',
  {
    tbl: text('tbl').notNull(),
    id: text('id').notNull(),
    spaceId: text('space_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tbl, t.id] })],
);

/** どこまで受け取ったか（チームとテーブルごと） */
export const syncState = sqliteTable(
  'sync_state',
  {
    spaceId: text('space_id').notNull(),
    tbl: text('tbl').notNull(),
    /** 最後に受け取った行の updated_at（サーバーの時刻、ISO文字列） */
    cursor: text('cursor').notNull(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.tbl] })],
);

/** 受け取った内容を書き込んでいる間は 1。トリガーが印や控えを付けないようにする */
export const syncCtl = sqliteTable('sync_ctl', {
  id: integer('id').primaryKey(),
  applying: integer('applying').notNull().default(0),
});

/** 所属しているチームの写し（電波がなくても切り替えられるように持つ） */
export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').$type<'owner' | 'member'>().notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  complimentary: integer('complimentary', { mode: 'boolean' }).notNull().default(false),
  slotAssigned: integer('slot_assigned', { mode: 'boolean' }).notNull().default(false),
  memberCount: integer('member_count').notNull().default(1),
});

/** 端末ごとの設定（いま開いている置き場所など） */
export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type Team = typeof teams.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GameStaff = typeof gameStaff.$inferSelect;
export type PeriodCheck = typeof periodChecks.$inferSelect;
