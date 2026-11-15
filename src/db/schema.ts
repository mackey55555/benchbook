import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { EventType, FoulKind, GameStatus, Side } from '@/domain/types';

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isOwn: integer('is_own', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
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
  },
  (t) => [primaryKey({ columns: [t.gameId, t.period] })],
);

export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GameStaff = typeof gameStaff.$inferSelect;
export type PeriodCheck = typeof periodChecks.$inferSelect;
