import { and, asc, desc, eq, inArray, isNull, max, ne, notInArray, type SQL } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import {
  RULES,
  afterPeriod,
  compareNumbers,
  computeScoreThrough,
  computeTeamFouls,
  pointsOf,
  remainingTimeouts,
  type AfterPeriod,
} from '@/domain/rules';
import type { FixStat } from '@/domain/analysis';
import { PRACTICE_GAME_ID } from '@/domain/practice';
import type { EventType, FoulKind, GameEvent, RosterEntry, Score, Side } from '@/domain/types';
import { clockRemainingMs, isClockRunning } from '@/domain/clock';
import { ON_COURT_MAX, onCourtIds, periodSeconds } from '@/domain/lineup';
import { ulid } from '@/lib/ulid';

import * as schema from './schema';
import type { Game, GameStaff, PeriodCheck, Player, Team } from './schema';

const { teams, players, games, gameRoster, gameStaff, gameEvents, periodChecks, appState, spaces } = schema;

/** expo-sqlite（アプリ）と better-sqlite3（テスト）の両方で動く同期DB */
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** 入力内容に問題があるときのエラー。message はそのまま画面に出せる日本語 */
export class RepoError extends Error {}

const other = (side: Side): Side => (side === 'A' ? 'B' : 'A');

// ---------------------------------------------------------------- 置き場所（個人／チーム）

const SPACE_KEY = 'space';

/** いま開いている置き場所。null は個人（端末内だけ）、それ以外はサーバーのチームID */
export function currentSpaceId(db: Db): string | null {
  const row = db.select().from(appState).where(eq(appState.key, SPACE_KEY)).get();
  return row?.value || null;
}

export function setCurrentSpace(db: Db, spaceId: string | null): void {
  db.insert(appState)
    .values({ key: SPACE_KEY, value: spaceId ?? '' })
    .onConflictDoUpdate({ target: appState.key, set: { value: spaceId ?? '' } })
    .run();
}

const inSpace = (column: typeof teams.spaceId | typeof games.spaceId, spaceId: string | null): SQL =>
  spaceId === null ? isNull(column) : eq(column, spaceId);

/** チームの自チーム名簿のID。どの端末で作っても同じになるようにして、二重にできないようにする */
export function ownSquadId(spaceId: string): string {
  return `own-${spaceId}`;
}

// ---------------------------------------------------------------- teams

/** いまの置き場所の自チーム名簿。なければ作る */
export function ensureOwnTeam(db: Db): Team {
  const spaceId = currentSpaceId(db);
  const existing = db
    .select()
    .from(teams)
    .where(and(eq(teams.isOwn, true), inSpace(teams.spaceId, spaceId)))
    .get();
  if (existing) return existing;
  const space = spaceId ? db.select().from(spaces).where(eq(spaces.id, spaceId)).get() : undefined;
  const team: Team = {
    id: spaceId ? ownSquadId(spaceId) : ulid(),
    name: space?.name ?? '自チーム',
    isOwn: true,
    createdAt: Date.now(),
    spaceId,
    dirty: 1,
  };
  db.insert(teams).values(team).run();
  return team;
}

export function listTeams(db: Db): Team[] {
  return db
    .select()
    .from(teams)
    .where(inSpace(teams.spaceId, currentSpaceId(db)))
    .orderBy(desc(teams.isOwn), asc(teams.name))
    .all();
}

export function getTeam(db: Db, id: string): Team | undefined {
  return db.select().from(teams).where(eq(teams.id, id)).get();
}

export function createTeam(db: Db, name: string): Team {
  const trimmed = name.trim();
  if (!trimmed) throw new RepoError('チーム名を入力してください');
  const team: Team = {
    id: ulid(),
    name: trimmed,
    isOwn: false,
    createdAt: Date.now(),
    spaceId: currentSpaceId(db),
    dirty: 1,
  };
  db.insert(teams).values(team).run();
  return team;
}

export function renameTeam(db: Db, id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new RepoError('チーム名を入力してください');
  db.update(teams).set({ name: trimmed }).where(eq(teams.id, id)).run();
}

/** 相手チームのマスタを削除する（過去の試合記録はスナップショットなので影響しない） */
export function deleteTeam(db: Db, id: string): void {
  const team = getTeam(db, id);
  if (!team) return;
  if (team.isOwn) throw new RepoError('自チームは削除できません');
  db.transaction((tx) => {
    tx.delete(players).where(eq(players.teamId, id)).run();
    tx.delete(teams).where(eq(teams.id, id)).run();
  });
}

export function listPlayers(db: Db, teamId: string): Player[] {
  return db
    .select()
    .from(players)
    .where(eq(players.teamId, teamId))
    .all()
    .sort((a, b) => compareNumbers(a.number, b.number));
}

function normalizeNumber(number: string): string {
  const trimmed = number.trim();
  if (!/^\d{1,2}$/.test(trimmed)) throw new RepoError('背番号は0〜99の数字で入力してください');
  return trimmed;
}

export function addPlayer(db: Db, teamId: string, input: { number: string; name: string }): Player {
  const number = normalizeNumber(input.number);
  const dup = db
    .select()
    .from(players)
    .where(and(eq(players.teamId, teamId), eq(players.number, number)))
    .get();
  if (dup) throw new RepoError(`背番号 ${number} は登録済みです`);
  const player: Player = { id: ulid(), teamId, number, name: input.name.trim(), isActive: true, dirty: 1 };
  db.insert(players).values(player).run();
  return player;
}

export function updatePlayer(
  db: Db,
  id: string,
  patch: Partial<Pick<Player, 'number' | 'name' | 'isActive'>>,
): void {
  const current = db.select().from(players).where(eq(players.id, id)).get();
  if (!current) return;
  const next = { ...patch };
  if (next.number !== undefined) {
    next.number = normalizeNumber(next.number);
    const dup = db
      .select()
      .from(players)
      .where(and(eq(players.teamId, current.teamId), eq(players.number, next.number)))
      .get();
    if (dup && dup.id !== id) throw new RepoError(`背番号 ${next.number} は登録済みです`);
  }
  if (next.name !== undefined) next.name = next.name.trim();
  db.update(players).set(next).where(eq(players.id, id)).run();
}

export function deletePlayer(db: Db, id: string): void {
  db.delete(players).where(eq(players.id, id)).run();
}

// ---------------------------------------------------------------- games

export interface GameBundle {
  game: Game;
  roster: RosterEntry[];
  staff: GameStaff[];
  events: GameEvent[];
  checks: PeriodCheck[];
}

export interface GameSummary {
  game: Game;
  score: Score;
}

/** 端末の日付（YYYY-MM-DD） */
export function todayString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 試合を準備中（prep）で作る。自チームの有効な選手を最大12名、出場登録に入れておく */
export function createGame(db: Db): Game {
  const own = ensureOwnTeam(db);
  const game: Game = {
    id: ulid(),
    date: todayString(),
    leagueName: '',
    venue: '',
    ownSide: 'A',
    teamAName: own.name,
    teamBName: '',
    periodMinutes: RULES.defaultPeriodMinutes,
    otMinutes: RULES.defaultOvertimeMinutes,
    status: 'prep',
    currentPeriod: 1,
    createdAt: Date.now(),
    finishedAt: null,
    clockPeriod: null,
    clockRemainingMs: null,
    clockStartedAt: null,
    spaceId: own.spaceId,
    createdBy: null,
    dirty: 1,
  };
  const ownPlayers = listPlayers(db, own.id)
    .filter((p) => p.isActive)
    .slice(0, RULES.maxRosterSize);
  db.transaction((tx) => {
    tx.insert(games).values(game).run();
    for (const p of ownPlayers) {
      tx.insert(gameRoster)
        .values({
          id: ulid(),
          gameId: game.id,
          side: 'A',
          playerId: p.id,
          number: p.number,
          name: p.name,
          isStarter: false,
          isCaptain: false,
        })
        .run();
    }
  });
  return game;
}

/**
 * 練習用の試合を作り直して、入力できる状態（第1Q）で返す。
 * 架空の2チームに5人ずつ登録する。選手マスタや実際の試合には触れない。
 */
export function createPracticeGame(db: Db): Game {
  deleteGame(db, PRACTICE_GAME_ID);
  const game: Game = {
    id: PRACTICE_GAME_ID,
    date: todayString(),
    leagueName: '練習',
    venue: '',
    ownSide: 'A',
    teamAName: '自チーム（練習）',
    teamBName: '相手（練習）',
    periodMinutes: RULES.defaultPeriodMinutes,
    otMinutes: RULES.defaultOvertimeMinutes,
    status: 'live',
    currentPeriod: 1,
    createdAt: Date.now(),
    finishedAt: null,
    clockPeriod: null,
    clockRemainingMs: null,
    clockStartedAt: null,
    spaceId: null,
    createdBy: null,
    dirty: 1,
  };
  db.transaction((tx) => {
    tx.insert(games).values(game).run();
    for (const side of ['A', 'B'] as const) {
      for (const number of ['4', '5', '6', '7', '8']) {
        tx.insert(gameRoster)
          .values({
            id: `${PRACTICE_GAME_ID}-${side}${number}`,
            gameId: game.id,
            side,
            playerId: null,
            number,
            name: '',
            isStarter: false,
            isCaptain: false,
          })
          .run();
      }
    }
  });
  return game;
}

/** 練習用の試合を消す（無ければ何もしない） */
export function deletePracticeGame(db: Db): void {
  deleteGame(db, PRACTICE_GAME_ID);
}

export function getGame(db: Db, id: string): Game | undefined {
  return db.select().from(games).where(eq(games.id, id)).get();
}

export function getLiveGame(db: Db): Game | undefined {
  return db
    .select()
    .from(games)
    .where(and(eq(games.status, 'live'), ne(games.id, PRACTICE_GAME_ID)))
    .orderBy(desc(games.createdAt))
    .get();
}

export function listGames(db: Db): GameSummary[] {
  // 練習用の試合は一覧・分析に出さない
  const rows = db
    .select()
    .from(games)
    .where(and(ne(games.id, PRACTICE_GAME_ID), inSpace(games.spaceId, currentSpaceId(db))))
    .orderBy(desc(games.date), desc(games.createdAt))
    .all();
  const scoring = db
    .select({ gameId: gameEvents.gameId, side: gameEvents.side, type: gameEvents.type })
    .from(gameEvents)
    .where(
      and(isNull(gameEvents.voidedAt), inArray(gameEvents.type, ['FG2_MADE', 'FG3_MADE', 'FT_MADE'])),
    )
    .all();
  const scores = new Map<string, Score>();
  for (const e of scoring) {
    if (!e.side) continue;
    const score = scores.get(e.gameId) ?? { A: 0, B: 0 };
    score[e.side] += pointsOf(e.type);
    scores.set(e.gameId, score);
  }
  return rows.map((game) => ({ game, score: scores.get(game.id) ?? { A: 0, B: 0 } }));
}

export function listEvents(db: Db, gameId: string): GameEvent[] {
  return db
    .select()
    .from(gameEvents)
    .where(eq(gameEvents.gameId, gameId))
    .orderBy(asc(gameEvents.orderKey), asc(gameEvents.createdAt), asc(gameEvents.id))
    .all();
}

export function listRoster(db: Db, gameId: string): RosterEntry[] {
  return db
    .select()
    .from(gameRoster)
    .where(eq(gameRoster.gameId, gameId))
    .all()
    .sort((a, b) => a.side.localeCompare(b.side) || compareNumbers(a.number, b.number));
}

export function getGameBundle(db: Db, gameId: string): GameBundle | undefined {
  const game = getGame(db, gameId);
  if (!game) return undefined;
  return {
    game,
    roster: listRoster(db, gameId),
    staff: db.select().from(gameStaff).where(eq(gameStaff.gameId, gameId)).all(),
    events: listEvents(db, gameId),
    checks: db
      .select()
      .from(periodChecks)
      .where(eq(periodChecks.gameId, gameId))
      .orderBy(asc(periodChecks.period))
      .all(),
  };
}

export function updateGame(
  db: Db,
  id: string,
  patch: Partial<
    Pick<
      Game,
      'date' | 'leagueName' | 'venue' | 'teamAName' | 'teamBName' | 'periodMinutes' | 'otMinutes'
    >
  >,
): void {
  db.update(games).set(patch).where(eq(games.id, id)).run();
}

/** 自チームがスコアシート上のA/Bどちらかを切り替える（準備中のみ）。両チームを丸ごと入れ替える */
export function setOwnSide(db: Db, gameId: string, side: Side): void {
  const game = getGame(db, gameId);
  if (!game || game.ownSide === side) return;
  if (game.status !== 'prep') throw new RepoError('試合開始後はA/Bを入れ替えられません');
  db.transaction((tx) => {
    for (const table of [gameRoster, gameStaff] as const) {
      tx.update(table)
        .set({ side: 'X' as Side })
        .where(and(eq(table.gameId, gameId), eq(table.side, 'A')))
        .run();
      tx.update(table)
        .set({ side: 'A' })
        .where(and(eq(table.gameId, gameId), eq(table.side, 'B')))
        .run();
      tx.update(table)
        .set({ side: 'B' })
        .where(and(eq(table.gameId, gameId), eq(table.side, 'X' as Side)))
        .run();
    }
    tx.update(games)
      .set({ ownSide: side, teamAName: game.teamBName, teamBName: game.teamAName })
      .where(eq(games.id, gameId))
      .run();
  });
}

export function deleteGame(db: Db, gameId: string): void {
  db.transaction((tx) => {
    tx.delete(periodChecks).where(eq(periodChecks.gameId, gameId)).run();
    tx.delete(gameEvents).where(eq(gameEvents.gameId, gameId)).run();
    tx.delete(gameStaff).where(eq(gameStaff.gameId, gameId)).run();
    tx.delete(gameRoster).where(eq(gameRoster.gameId, gameId)).run();
    tx.delete(games).where(eq(games.id, gameId)).run();
  });
}

// ---------------------------------------------------------------- roster / staff

function sideRoster(db: Db, gameId: string, side: Side): RosterEntry[] {
  return db
    .select()
    .from(gameRoster)
    .where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.side, side)))
    .all();
}

export function addRosterEntry(
  db: Db,
  gameId: string,
  side: Side,
  input: { number: string; name?: string; playerId?: string | null },
): RosterEntry {
  const number = normalizeNumber(input.number);
  const current = sideRoster(db, gameId, side);
  if (current.length >= RULES.maxRosterSize) {
    throw new RepoError(`出場登録は最大${RULES.maxRosterSize}名です`);
  }
  if (current.some((r) => r.number === number)) {
    throw new RepoError(`背番号 ${number} は登録済みです`);
  }
  const entry: RosterEntry = {
    id: ulid(),
    gameId,
    side,
    playerId: input.playerId ?? null,
    number,
    name: (input.name ?? '').trim(),
    isStarter: false,
    isCaptain: false,
  };
  db.insert(gameRoster).values(entry).run();
  return entry;
}

export function updateRosterEntry(
  db: Db,
  id: string,
  patch: Partial<Pick<RosterEntry, 'number' | 'name'>>,
): void {
  const current = db.select().from(gameRoster).where(eq(gameRoster.id, id)).get();
  if (!current) return;
  const next = { ...patch };
  if (next.number !== undefined) {
    next.number = normalizeNumber(next.number);
    const dup = sideRoster(db, current.gameId, current.side).find(
      (r) => r.number === next.number && r.id !== id,
    );
    if (dup) throw new RepoError(`背番号 ${next.number} は登録済みです`);
  }
  if (next.name !== undefined) next.name = next.name.trim();
  db.update(gameRoster).set(next).where(eq(gameRoster.id, id)).run();
}

export function removeRosterEntry(db: Db, id: string): void {
  const used = db.select().from(gameEvents).where(eq(gameEvents.rosterId, id)).get();
  if (used) throw new RepoError('記録のある選手は出場登録から外せません');
  db.delete(gameRoster).where(eq(gameRoster.id, id)).run();
}

export function setStarter(db: Db, id: string, isStarter: boolean): void {
  const current = db.select().from(gameRoster).where(eq(gameRoster.id, id)).get();
  if (!current) return;
  if (isStarter) {
    const starters = sideRoster(db, current.gameId, current.side).filter((r) => r.isStarter);
    if (starters.length >= RULES.startersCount && !current.isStarter) {
      throw new RepoError(`スターターは${RULES.startersCount}名までです`);
    }
  }
  db.update(gameRoster).set({ isStarter }).where(eq(gameRoster.id, id)).run();
}

/** キャプテンはチームに1人。同じ選手をもう一度指定すると解除する */
export function toggleCaptain(db: Db, id: string): void {
  const current = db.select().from(gameRoster).where(eq(gameRoster.id, id)).get();
  if (!current) return;
  db.transaction((tx) => {
    tx.update(gameRoster)
      .set({ isCaptain: false })
      .where(and(eq(gameRoster.gameId, current.gameId), eq(gameRoster.side, current.side)))
      .run();
    if (!current.isCaptain) {
      tx.update(gameRoster).set({ isCaptain: true }).where(eq(gameRoster.id, id)).run();
    }
  });
}

/** 保存済みチームの有効な選手を、その側の出場登録に読み込む（記録のない登録は置き換える） */
/**
 * 保存済みチームから出場登録を読み込む。
 * playerIds を渡すと、その選手（今日来ている選手）だけを読み込む。
 */
export function loadRosterFromTeam(
  db: Db,
  gameId: string,
  side: Side,
  teamId: string,
  playerIds?: readonly string[],
): void {
  const team = getTeam(db, teamId);
  if (!team) return;
  const source = listPlayers(db, teamId)
    .filter((p) => p.isActive && (!playerIds || playerIds.includes(p.id)))
    .slice(0, RULES.maxRosterSize);
  db.transaction((tx) => {
    const usedIds = tx
      .select({ rosterId: gameEvents.rosterId })
      .from(gameEvents)
      .where(eq(gameEvents.gameId, gameId))
      .all()
      .map((r) => r.rosterId)
      .filter((id): id is string => id !== null);
    const removable = and(
      eq(gameRoster.gameId, gameId),
      eq(gameRoster.side, side),
      usedIds.length ? notInArray(gameRoster.id, usedIds) : undefined,
    );
    tx.delete(gameRoster).where(removable).run();
    const kept = tx
      .select()
      .from(gameRoster)
      .where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.side, side)))
      .all();
    for (const p of source) {
      if (kept.some((r) => r.number === p.number)) continue;
      if (kept.length >= RULES.maxRosterSize) break;
      const entry: RosterEntry = {
        id: ulid(),
        gameId,
        side,
        playerId: p.id,
        number: p.number,
        name: p.name,
        isStarter: false,
        isCaptain: false,
      };
      tx.insert(gameRoster).values(entry).run();
      kept.push({ ...entry, dirty: 1 });
    }
    tx.update(games)
      .set(side === 'A' ? { teamAName: team.name } : { teamBName: team.name })
      .where(eq(games.id, gameId))
      .run();
  });
}

/** その側の出場登録をチームマスタに保存する（同名の相手チームがあれば不足分の選手を追加） */
export function saveRosterAsTeam(db: Db, gameId: string, side: Side): Team {
  const game = getGame(db, gameId);
  if (!game) throw new RepoError('試合が見つかりません');
  const name = (side === 'A' ? game.teamAName : game.teamBName).trim();
  if (!name) throw new RepoError('チーム名を入力してください');
  return db.transaction((tx) => {
    let team = tx
      .select()
      .from(teams)
      .where(and(eq(teams.name, name), eq(teams.isOwn, false), inSpace(teams.spaceId, game.spaceId)))
      .get();
    if (!team) {
      team = { id: ulid(), name, isOwn: false, createdAt: Date.now(), spaceId: game.spaceId, dirty: 1 };
      tx.insert(teams).values(team).run();
    }
    const existing = tx.select().from(players).where(eq(players.teamId, team.id)).all();
    const roster = tx
      .select()
      .from(gameRoster)
      .where(and(eq(gameRoster.gameId, gameId), eq(gameRoster.side, side)))
      .all();
    for (const r of roster) {
      if (existing.some((p) => p.number === r.number)) continue;
      tx.insert(players)
        .values({ id: ulid(), teamId: team.id, number: r.number, name: r.name, isActive: true })
        .run();
    }
    return team;
  });
}

export function setStaffName(
  db: Db,
  gameId: string,
  side: Side,
  role: 'HC' | 'AC',
  name: string,
): void {
  const existing = db
    .select()
    .from(gameStaff)
    .where(and(eq(gameStaff.gameId, gameId), eq(gameStaff.side, side), eq(gameStaff.role, role)))
    .get();
  if (existing) {
    db.update(gameStaff).set({ name: name.trim() }).where(eq(gameStaff.id, existing.id)).run();
  } else {
    db.insert(gameStaff).values({ id: ulid(), gameId, side, role, name: name.trim() }).run();
  }
}

export function startGame(db: Db, gameId: string): void {
  const game = getGame(db, gameId);
  if (!game) throw new RepoError('試合が見つかりません');
  if (game.status !== 'prep') return;
  for (const side of ['A', 'B'] as const) {
    if (sideRoster(db, gameId, side).length === 0) {
      const name = (side === 'A' ? game.teamAName : game.teamBName) || `チーム${side}`;
      throw new RepoError(`${name} の出場登録が0名です。背番号を1名以上登録してください`);
    }
  }
  const live = getLiveGame(db);
  if (live && live.id !== gameId) {
    throw new RepoError('進行中の試合があります。先にその試合を終了してください');
  }
  db.update(games).set({ status: 'live', currentPeriod: 1 }).where(eq(games.id, gameId)).run();
}

// ---------------------------------------------------------------- events

export interface NewEvent {
  gameId: string;
  period: number;
  side: Side | null;
  rosterId: string | null;
  type: EventType;
  foulKind?: FoulKind | null;
  ftAwarded?: number | null;
  /** そのピリオドの残り時間（秒）。時計を使っているときだけ渡す */
  clockSeconds?: number | null;
}

/** 選手を選ばずに「チーム」として記録できる項目（24秒などのチームのTO、チームリバウンド） */
export const TEAM_EVENT_TYPES: readonly EventType[] = ['TOV', 'OREB', 'DREB'];
const PLAYER_ONLY_TYPES: readonly EventType[] = [
  'FG2_MADE',
  'FG2_MISS',
  'FG3_MADE',
  'FG3_MISS',
  'FT_MADE',
  'FT_MISS',
  'AST',
  'STL',
  'BLK',
];

function nextOrderKey(db: Db, gameId: string): number {
  const row = db
    .select({ value: max(gameEvents.orderKey) })
    .from(gameEvents)
    .where(eq(gameEvents.gameId, gameId))
    .get();
  return (row?.value ?? 0) + 1;
}

function normalizeEvent(input: NewEvent): Pick<GameEvent, 'foulKind' | 'ftAwarded'> {
  if (input.rosterId === null && PLAYER_ONLY_TYPES.includes(input.type)) {
    throw new RepoError('この記録は選手を選んでください（チームで記録できるのは TOV・OR・DR です）');
  }
  if (input.type !== 'FOUL') return { foulKind: null, ftAwarded: null };
  const kind = input.foulKind ?? 'P';
  const isBench = kind === 'C' || kind === 'B';
  if (isBench && input.rosterId !== null) {
    throw new RepoError('C/Bはベンチのファウルです。選手には記録できません');
  }
  if (!isBench && input.rosterId === null) {
    throw new RepoError('選手のファウルは選手を選んで記録してください');
  }
  const ft = input.ftAwarded ?? 0;
  if (!Number.isInteger(ft) || ft < 0 || ft > 3) throw new RepoError('FT数は0〜3です');
  return { foulKind: kind, ftAwarded: ft };
}

/**
 * イベントを1件追加する。トランザクション内で order_key を採番して書き込み、
 * 書き込みが完了したイベントを返す（呼び出し側はこの戻り値を受けてからUIを更新する）。
 */
export function addEvent(db: Db, input: NewEvent): GameEvent {
  const attrs = normalizeEvent(input);
  return db.transaction((tx) => {
    if (input.type === 'TIMEOUT') {
      if (!input.side) throw new RepoError('タイムアウトはチームを選んで記録してください');
      const events = listEvents(tx, input.gameId);
      if (remainingTimeouts(events, input.side, input.period) <= 0) {
        throw new RepoError('タイムアウトは残っていません');
      }
    }
    const event: GameEvent = {
      id: ulid(),
      gameId: input.gameId,
      orderKey: nextOrderKey(tx, input.gameId),
      period: input.period,
      side: input.side,
      rosterId: input.rosterId,
      type: input.type,
      ...attrs,
      clockSeconds: input.clockSeconds ?? null,
      createdAt: Date.now(),
      voidedAt: null,
      replacesEventId: null,
    };
    tx.insert(gameEvents).values(event).run();
    return event;
  });
}

/**
 * 印を付ける。「今の何番だった？」というときに押しておき、あとでログから前後を見直す。
 * 集計には影響しない。直前の記録が印なら、その印を外す（押し間違いを同じボタンで戻せる）。
 * 付けたら true、外したら false を返す。
 */
export function toggleMark(db: Db, input: { gameId: string; period: number; clockSeconds?: number | null }): boolean {
  return db.transaction((tx) => {
    const last = tx
      .select()
      .from(gameEvents)
      .where(and(eq(gameEvents.gameId, input.gameId), isNull(gameEvents.voidedAt)))
      .orderBy(desc(gameEvents.orderKey), desc(gameEvents.createdAt))
      .get();
    if (last?.type === 'MARK' && last.period === input.period) {
      tx.update(gameEvents).set({ voidedAt: Date.now() }).where(eq(gameEvents.id, last.id)).run();
      return false;
    }
    tx.insert(gameEvents)
      .values({
        id: ulid(),
        gameId: input.gameId,
        orderKey: nextOrderKey(tx, input.gameId),
        period: input.period,
        side: null,
        rosterId: null,
        type: 'MARK',
        foulKind: null,
        ftAwarded: null,
        clockSeconds: input.clockSeconds ?? null,
        createdAt: Date.now(),
        voidedAt: null,
        replacesEventId: null,
      })
      .run();
    return true;
  });
}

// ----------------------------------------------------------------- clock

/** 時計を動かす。そのピリオドで初めてなら、ピリオドの長さから始める。残り0なら動かさない */
export function startClock(db: Db, gameId: string, now = Date.now()): void {
  const game = getGame(db, gameId);
  if (!game) throw new RepoError('試合が見つかりません');
  const period = game.currentPeriod;
  if (isClockRunning(game, period)) return;
  const remaining = clockRemainingMs(game, period, game, now);
  if (remaining <= 0) return;
  db.update(games)
    .set({ clockPeriod: period, clockRemainingMs: remaining, clockStartedAt: now })
    .where(eq(games.id, gameId))
    .run();
}

/** 時計を止める。動いていなければ何もしない */
export function stopClock(db: Db, gameId: string, now = Date.now()): void {
  const game = getGame(db, gameId);
  if (!game || !isClockRunning(game, game.currentPeriod)) return;
  db.update(games)
    .set({ clockRemainingMs: clockRemainingMs(game, game.currentPeriod, game, now), clockStartedAt: null })
    .where(eq(games.id, gameId))
    .run();
}

/** 残り時間を直す（会場の時計に合わせる）。動いていれば、直した時間からそのまま動き続ける */
export function setClock(db: Db, gameId: string, seconds: number, now = Date.now()): void {
  const game = getGame(db, gameId);
  if (!game) throw new RepoError('試合が見つかりません');
  const period = game.currentPeriod;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > periodSeconds(period, game)) {
    throw new RepoError('残り時間が正しくありません');
  }
  const running = isClockRunning(game, period) && seconds > 0;
  db.update(games)
    .set({ clockPeriod: period, clockRemainingMs: seconds * 1000, clockStartedAt: running ? now : null })
    .where(eq(games.id, gameId))
    .run();
}

/** 時計を使わない状態に戻す（表示はピリオドの長さに戻り、記録に時刻が付かなくなる） */
export function resetClock(db: Db, gameId: string): void {
  db.update(games)
    .set({ clockPeriod: null, clockRemainingMs: null, clockStartedAt: null })
    .where(eq(games.id, gameId))
    .run();
}

/** 取消。物理削除せず voided_at を立てる */
export function voidEvent(db: Db, eventId: string): void {
  db.update(gameEvents)
    .set({ voidedAt: Date.now() })
    .where(and(eq(gameEvents.id, eventId), isNull(gameEvents.voidedAt)))
    .run();
}

/** 修正。元イベントをvoidし、同じ order_key で新イベントを挿入して履歴を残す */
export function replaceEvent(
  db: Db,
  eventId: string,
  patch: Partial<Pick<NewEvent, 'side' | 'rosterId' | 'type' | 'foulKind' | 'ftAwarded' | 'period'>>,
): GameEvent {
  return db.transaction((tx) => {
    const original = tx.select().from(gameEvents).where(eq(gameEvents.id, eventId)).get();
    if (!original) throw new RepoError('イベントが見つかりません');
    if (original.voidedAt !== null) throw new RepoError('取消済みのイベントは修正できません');
    const merged: NewEvent = {
      gameId: original.gameId,
      period: patch.period ?? original.period,
      side: patch.side !== undefined ? patch.side : original.side,
      rosterId: patch.rosterId !== undefined ? patch.rosterId : original.rosterId,
      type: patch.type ?? original.type,
      foulKind: patch.foulKind !== undefined ? patch.foulKind : original.foulKind,
      ftAwarded: patch.ftAwarded !== undefined ? patch.ftAwarded : original.ftAwarded,
    };
    const now = Date.now();
    const event: GameEvent = {
      id: ulid(),
      gameId: original.gameId,
      orderKey: original.orderKey,
      period: merged.period,
      side: merged.side,
      rosterId: merged.rosterId,
      type: merged.type,
      ...normalizeEvent(merged),
      clockSeconds: original.clockSeconds,
      createdAt: now,
      voidedAt: null,
      replacesEventId: original.id,
    };
    tx.update(gameEvents).set({ voidedAt: now }).where(eq(gameEvents.id, original.id)).run();
    tx.insert(gameEvents).values(event).run();
    return event;
  });
}

/**
 * 選手別の修正表からの増減（得点の成功数・ファウル数を1件ずつ直す）。
 * +1 はそのピリオドの最後の記録の直後に入れる（ランニングスコアの並びを崩さないよう、
 * 同じ order_key を使い作成時刻で後ろに並べる）。ファウルは P・FT0 で記録する。
 * -1 はその選手・ピリオド・項目の最後の1件をvoidする。
 */
export function adjustStat(
  db: Db,
  input: { gameId: string; period: number; side: Side; rosterId: string; type: FixStat; delta: 1 | -1 },
): void {
  db.transaction((tx) => {
    const inPeriod = and(
      eq(gameEvents.gameId, input.gameId),
      eq(gameEvents.period, input.period),
      isNull(gameEvents.voidedAt),
    );
    if (input.delta === -1) {
      const target = tx
        .select()
        .from(gameEvents)
        .where(and(inPeriod, eq(gameEvents.rosterId, input.rosterId), eq(gameEvents.type, input.type)))
        .orderBy(desc(gameEvents.orderKey), desc(gameEvents.createdAt), desc(gameEvents.id))
        .get();
      if (!target) throw new RepoError('このQには、減らせる記録がありません');
      tx.update(gameEvents).set({ voidedAt: Date.now() }).where(eq(gameEvents.id, target.id)).run();
      return;
    }
    const last = tx
      .select()
      .from(gameEvents)
      .where(and(inPeriod, notInArray(gameEvents.type, ['PERIOD_END', 'L2M'])))
      .orderBy(desc(gameEvents.orderKey), desc(gameEvents.createdAt), desc(gameEvents.id))
      .get();
    let orderKey: number;
    if (last) {
      orderKey = last.orderKey;
    } else {
      // 記録が1件も無いピリオド。Q終了の印があればその直前、無ければ末尾に置く
      const marker = activeMarkers(tx, input.gameId, 'PERIOD_END', input.period)[0];
      orderKey = marker ? marker.orderKey - 0.5 : nextOrderKey(tx, input.gameId);
    }
    const event: GameEvent = {
      id: ulid(),
      gameId: input.gameId,
      orderKey,
      period: input.period,
      side: input.side,
      rosterId: input.rosterId,
      type: input.type,
      foulKind: input.type === 'FOUL' ? 'P' : null,
      ftAwarded: input.type === 'FOUL' ? 0 : null,
      clockSeconds: null,
      // 同じ order_key の記録より必ず後ろに並ぶようにする
      createdAt: Math.max(Date.now(), (last?.createdAt ?? 0) + 1),
      voidedAt: null,
      replacesEventId: null,
    };
    tx.insert(gameEvents).values(event).run();
  });
}

/** UNDO：そのピリオドの直前の有効イベントをvoidする（Q終了・残り2分マーカー・印は対象外） */
export function undoLastEvent(db: Db, gameId: string, period: number): GameEvent | null {
  return db.transaction((tx) => {
    const last = tx
      .select()
      .from(gameEvents)
      .where(
        and(
          eq(gameEvents.gameId, gameId),
          eq(gameEvents.period, period),
          isNull(gameEvents.voidedAt),
          notInArray(gameEvents.type, ['PERIOD_END', 'L2M', 'MARK']),
        ),
      )
      .orderBy(desc(gameEvents.orderKey), desc(gameEvents.createdAt))
      .get();
    if (!last) return null;
    const voidedAt = Date.now();
    if (last.type === 'SUB_IN' || last.type === 'SUB_OUT') {
      // 1回の交代（同時に記録したIN/OUT）はまとめて取り消す
      tx.update(gameEvents)
        .set({ voidedAt })
        .where(
          and(
            eq(gameEvents.gameId, gameId),
            eq(gameEvents.createdAt, last.createdAt),
            inArray(gameEvents.type, ['SUB_IN', 'SUB_OUT']),
            isNull(gameEvents.voidedAt),
          ),
        )
        .run();
    } else {
      tx.update(gameEvents).set({ voidedAt }).where(eq(gameEvents.id, last.id)).run();
    }
    return { ...last, voidedAt };
  });
}

export interface Substitution {
  gameId: string;
  period: number;
  side: Side;
  /** 交代後にコート上にいる選手（出場登録のID） */
  onCourt: string[];
  /** そのピリオドの残り時間（秒）。分からなければ null */
  clockSeconds: number | null;
}

/**
 * 交代を記録する。現在のコート上の選手との差分を SUB_OUT / SUB_IN として1トランザクションで書く。
 * 変更がなければ何も書かず 0 を返す。
 */
export function substitute(db: Db, input: Substitution): number {
  return db.transaction((tx) => {
    const game = tx.select().from(games).where(eq(games.id, input.gameId)).get();
    if (!game) throw new RepoError('試合が見つかりません');
    const roster = listRoster(tx, input.gameId).filter((r) => r.side === input.side);
    const next = new Set(input.onCourt);
    if (next.size > ON_COURT_MAX) throw new RepoError(`コート上は${ON_COURT_MAX}人までです`);
    for (const id of next) {
      if (!roster.some((r) => r.id === id)) throw new RepoError('出場登録にない選手です');
    }
    if (input.clockSeconds !== null) {
      const max = periodSeconds(input.period, game);
      if (!Number.isInteger(input.clockSeconds) || input.clockSeconds < 0 || input.clockSeconds > max) {
        throw new RepoError('残り時間が正しくありません');
      }
    }
    const current = onCourtIds(listEvents(tx, input.gameId), listRoster(tx, input.gameId), input.side);
    const outs = [...current].filter((id) => !next.has(id));
    const ins = [...next].filter((id) => !current.has(id));
    // 同じ createdAt を持たせて「1回の交代」として扱う（UNDOでまとめて取り消す）
    const now = Date.now();
    let orderKey = nextOrderKey(tx, input.gameId);
    for (const [type, ids] of [
      ['SUB_OUT', outs],
      ['SUB_IN', ins],
    ] as const) {
      for (const rosterId of ids) {
        tx.insert(gameEvents)
          .values({
            id: ulid(),
            gameId: input.gameId,
            orderKey: orderKey++,
            period: input.period,
            side: input.side,
            rosterId,
            type,
            foulKind: null,
            ftAwarded: null,
            clockSeconds: input.clockSeconds,
            createdAt: now,
            voidedAt: null,
            replacesEventId: null,
          })
          .run();
      }
    }
    return outs.length + ins.length;
  });
}

function activeMarkers(db: Db, gameId: string, type: 'PERIOD_END' | 'L2M', period: number) {
  return db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        eq(gameEvents.type, type),
        eq(gameEvents.period, period),
        isNull(gameEvents.voidedAt),
      ),
    )
    .all();
}

function insertMarker(db: Db, gameId: string, type: 'PERIOD_END' | 'L2M', period: number): void {
  db.insert(gameEvents)
    .values({
      id: ulid(),
      gameId,
      orderKey: nextOrderKey(db, gameId),
      period,
      side: null,
      rosterId: null,
      type,
      foulKind: null,
      ftAwarded: null,
      createdAt: Date.now(),
      voidedAt: null,
      replacesEventId: null,
    })
    .run();
}

/** 第4Q「残り2分」トグル。ONでマーカーを挿入、OFFで取り消す */
export function setLastTwoMinutes(db: Db, gameId: string, on: boolean): void {
  db.transaction((tx) => {
    const markers = activeMarkers(tx, gameId, 'L2M', RULES.regulationPeriods);
    if (on && markers.length === 0) insertMarker(tx, gameId, 'L2M', RULES.regulationPeriods);
    if (!on && markers.length > 0) {
      tx.update(gameEvents)
        .set({ voidedAt: Date.now() })
        .where(
          inArray(
            gameEvents.id,
            markers.map((m) => m.id),
          ),
        )
        .run();
    }
  });
}

export function endPeriod(db: Db, gameId: string, period: number): void {
  stopClock(db, gameId);
  db.transaction((tx) => {
    if (activeMarkers(tx, gameId, 'PERIOD_END', period).length === 0) {
      insertMarker(tx, gameId, 'PERIOD_END', period);
    }
  });
}

/** Q終了を取り消して入力に戻る */
export function cancelPeriodEnd(db: Db, gameId: string, period: number): void {
  db.transaction((tx) => {
    const markers = activeMarkers(tx, gameId, 'PERIOD_END', period);
    if (markers.length === 0) return;
    tx.update(gameEvents)
      .set({ voidedAt: Date.now() })
      .where(
        inArray(
          gameEvents.id,
          markers.map((m) => m.id),
        ),
      )
      .run();
  });
}

function writeCheck(db: Db, gameId: string, period: number, matched: boolean, note: string): Score {
  const events = listEvents(db, gameId);
  const score = computeScoreThrough(events, period);
  const row: PeriodCheck = {
    gameId,
    period,
    scoreA: score.A,
    scoreB: score.B,
    teamFoulsA: computeTeamFouls(events, 'A', period),
    teamFoulsB: computeTeamFouls(events, 'B', period),
    matched,
    note,
    confirmedAt: Date.now(),
    dirty: 1,
  };
  db.insert(periodChecks)
    .values(row)
    .onConflictDoUpdate({ target: [periodChecks.gameId, periodChecks.period], set: row })
    .run();
  return score;
}

/** 照合で不一致だったことを記録する（修正後に confirmPeriod で上書きされる） */
export function recordMismatch(db: Db, gameId: string, period: number, note = ''): void {
  db.transaction((tx) => {
    writeCheck(tx, gameId, period, false, note);
  });
}

/**
 * 照合一致。period_checks に記録して次へ進める。
 * 第4Q以降は同点なら延長、それ以外は試合終了（status=finished）。
 */
/**
 * 照合を「一致」で確定し、次へ進む。
 * endTied を付けると、第4Q以降が同点でも延長に入らず試合終了にする（引き分けのある大会・練習試合用）。
 */
export function confirmPeriod(
  db: Db,
  gameId: string,
  period: number,
  note = '',
  options: { endTied?: boolean } = {},
): AfterPeriod {
  return db.transaction((tx) => {
    const game = tx.select().from(games).where(eq(games.id, gameId)).get();
    if (!game) throw new RepoError('試合が見つかりません');
    if (activeMarkers(tx, gameId, 'PERIOD_END', period).length === 0) {
      insertMarker(tx, gameId, 'PERIOD_END', period);
    }
    const score = writeCheck(tx, gameId, period, true, note);
    const next = afterPeriod(period, score);
    const outcome = next === 'overtime' && options.endTied ? 'finished' : next;
    if (game.status === 'live' && game.currentPeriod === period) {
      if (outcome === 'finished') {
        tx.update(games)
          .set({ status: 'finished', finishedAt: Date.now() })
          .where(eq(games.id, gameId))
          .run();
      } else {
        tx.update(games).set({ currentPeriod: period + 1 }).where(eq(games.id, gameId)).run();
      }
    }
    return outcome;
  });
}

/** 入力中のピリオドが終了済み（照合待ち）か */
export function isPeriodEnded(events: readonly GameEvent[], period: number): boolean {
  return events.some(
    (e) => e.voidedAt === null && e.type === 'PERIOD_END' && e.period === period,
  );
}

export function otherSide(side: Side): Side {
  return other(side);
}

/** 誤って終了した試合を再開する。最後のQ終了を取り消し、そのQの入力に戻る */
export function reopenGame(db: Db, gameId: string): void {
  db.transaction((tx) => {
    const game = tx.select().from(games).where(eq(games.id, gameId)).get();
    if (!game || game.status !== 'finished') return;
    const live = tx
      .select()
      .from(games)
      .where(and(eq(games.status, 'live'), ne(games.id, PRACTICE_GAME_ID)))
      .get();
    if (live) throw new RepoError('進行中の試合があります。先にその試合を終了してください');
    const markers = activeMarkers(tx, gameId, 'PERIOD_END', game.currentPeriod);
    if (markers.length > 0) {
      tx.update(gameEvents)
        .set({ voidedAt: Date.now() })
        .where(
          inArray(
            gameEvents.id,
            markers.map((m) => m.id),
          ),
        )
        .run();
    }
    tx.update(games).set({ status: 'live', finishedAt: null }).where(eq(games.id, gameId)).run();
  });
}

// ---------------------------------------------------------------- チームに送る

export interface SendGameResult {
  /** チームの名簿に足した選手の数 */
  addedPlayers: number;
  /** 名簿と結び付けられなかった選手の数（同じ背番号に別の名前の選手がいた） */
  unlinked: number;
}

/** 送り先のチームに、同じ日・同じ対戦の試合がすでにあるか（二重に送るのを防ぐための確認用） */
export function findSimilarGame(db: Db, gameId: string, spaceId: string): Game | undefined {
  const game = getGame(db, gameId);
  if (!game) return undefined;
  return db
    .select()
    .from(games)
    .where(
      and(
        eq(games.spaceId, spaceId),
        eq(games.date, game.date),
        eq(games.teamAName, game.teamAName),
        eq(games.teamBName, game.teamBName),
      ),
    )
    .get();
}

/**
 * 個人の置き場所の試合を、チームへ移す。移した試合は次の同期でサーバーへ送られる。
 * 自チーム側の出場選手は、チームの名簿と背番号・氏名で突き合わせる。
 * 名簿にいない選手は名簿に足し、同じ背番号に別の名前の選手がいるときは結び付けない。
 */
export function sendGameToSpace(db: Db, gameId: string, spaceId: string): SendGameResult {
  const game = getGame(db, gameId);
  if (!game || game.id === PRACTICE_GAME_ID) throw new RepoError('試合が見つかりません');
  if (game.spaceId !== null) throw new RepoError('この試合はすでにチームにあります');
  if (game.status !== 'finished') throw new RepoError('チームに送れるのは、終了した試合です');
  const space = db.select().from(spaces).where(eq(spaces.id, spaceId)).get();
  if (!space || !space.active) throw new RepoError('このチームは、いま使えません');

  return db.transaction((tx) => {
    const result: SendGameResult = { addedPlayers: 0, unlinked: 0 };
    const squadId = ownSquadId(spaceId);
    if (!tx.select().from(teams).where(eq(teams.id, squadId)).get()) {
      tx.insert(teams)
        .values({ id: squadId, name: space.name, isOwn: true, createdAt: Date.now(), spaceId, dirty: 1 })
        .run();
    }
    const squad = tx.select().from(players).where(eq(players.teamId, squadId)).all();
    const roster = tx.select().from(gameRoster).where(eq(gameRoster.gameId, gameId)).all();
    for (const r of roster) {
      let playerId: string | null = null;
      if (r.side === game.ownSide) {
        const sameNumber = squad.find((p) => p.number === r.number);
        if (!sameNumber) {
          const player: Player = { id: ulid(), teamId: squadId, number: r.number, name: r.name, isActive: true, dirty: 1 };
          tx.insert(players).values(player).run();
          squad.push(player);
          playerId = player.id;
          result.addedPlayers++;
        } else if (sameNumber.name === r.name || !sameNumber.name || !r.name) {
          playerId = sameNumber.id;
        } else {
          result.unlinked++;
        }
      }
      // 相手側は、個人の置き場所のチームを指しているので外す
      tx.update(gameRoster).set({ playerId, dirty: 1 }).where(eq(gameRoster.id, r.id)).run();
    }
    tx.update(gameStaff).set({ dirty: 1 }).where(eq(gameStaff.gameId, gameId)).run();
    tx.update(gameEvents).set({ dirty: 1 }).where(eq(gameEvents.gameId, gameId)).run();
    tx.update(periodChecks).set({ dirty: 1 }).where(eq(periodChecks.gameId, gameId)).run();
    tx.update(games).set({ spaceId, dirty: 1 }).where(eq(games.id, gameId)).run();
    return result;
  });
}

/**
 * 個人の置き場所の自チーム名簿を、チームの名簿に写す（チームを作った直後に使う）。
 * すでにチームの名簿に選手がいるときは何もしない。
 */
export function copyOwnRosterToSpace(db: Db, spaceId: string, name: string): number {
  return db.transaction((tx) => {
    const squadId = ownSquadId(spaceId);
    if (!tx.select().from(teams).where(eq(teams.id, squadId)).get()) {
      tx.insert(teams).values({ id: squadId, name, isOwn: true, createdAt: Date.now(), spaceId, dirty: 1 }).run();
    }
    if (tx.select().from(players).where(eq(players.teamId, squadId)).get()) return 0;
    const personal = tx.select().from(teams).where(and(eq(teams.isOwn, true), isNull(teams.spaceId))).get();
    if (!personal) return 0;
    const source = tx.select().from(players).where(eq(players.teamId, personal.id)).all();
    for (const p of source) {
      tx.insert(players)
        .values({ id: ulid(), teamId: squadId, number: p.number, name: p.name, isActive: p.isActive, dirty: 1 })
        .run();
    }
    return source.length;
  });
}

export function listSpaces(db: Db): schema.Space[] {
  return db.select().from(spaces).orderBy(asc(spaces.name)).all();
}
