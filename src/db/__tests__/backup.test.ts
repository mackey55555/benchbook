import { computeScore } from '@/domain/rules';

import { exportAll, exportGame, importBackup, parseBackup } from '../backup';
import {
  RepoError,
  addEvent,
  addPlayer,
  addRosterEntry,
  confirmPeriod,
  createGame,
  ensureOwnTeam,
  getGameBundle,
  listGames,
  listRoster,
  listTeams,
  startGame,
  voidEvent,
  type Db,
} from '../repo';
import { openTestDb } from './testDb';

function seed(db: Db) {
  const own = ensureOwnTeam(db);
  addPlayer(db, own.id, { number: '4', name: '佐藤' });
  const game = createGame(db);
  addRosterEntry(db, game.id, 'B', { number: '10' });
  startGame(db, game.id);
  const roster = listRoster(db, game.id);
  const a4 = roster.find((r) => r.side === 'A')!.id;
  addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: a4, type: 'FG3_MADE' });
  const undone = addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: a4, type: 'FG2_MADE' });
  voidEvent(db, undone.id);
  confirmPeriod(db, game.id, 1);
  return game;
}

describe('バックアップ', () => {
  it('全データを書き出し、空の端末に読み込むと同じ内容になる（取消履歴も残る）', () => {
    const source = openTestDb().db;
    const game = seed(source);
    const json = JSON.stringify(exportAll(source));

    const target = openTestDb().db;
    const result = importBackup(target, parseBackup(json));
    expect(result).toMatchObject({ games: 1, events: 3, teams: 1, players: 1, skippedGames: 0 });
    expect(getGameBundle(target, game.id)).toEqual(getGameBundle(source, game.id));
    expect(listTeams(target).filter((t) => t.isOwn)).toHaveLength(1);
  });

  it('試合単位で書き出し・読み込みできる', () => {
    const source = openTestDb().db;
    const game = seed(source);
    const data = parseBackup(JSON.stringify(exportGame(source, game.id)));
    expect(data.scope).toBe('game');
    expect(data.teams).toHaveLength(0);

    const target = openTestDb().db;
    importBackup(target, data);
    const bundle = getGameBundle(target, game.id)!;
    expect(computeScore(bundle.events)).toEqual({ A: 3, B: 0 });
    expect(bundle.checks).toHaveLength(1);
  });

  it('同じバックアップを2回読み込んでも重複しない。端末側の記録は上書きしない', () => {
    const db = openTestDb().db;
    const game = seed(db);
    const data = parseBackup(JSON.stringify(exportAll(db)));
    const a4 = listRoster(db, game.id).find((r) => r.side === 'A')!.id;
    addEvent(db, { gameId: game.id, period: 2, side: 'A', rosterId: a4, type: 'FT_MADE' });

    const result = importBackup(db, data);
    expect(result).toMatchObject({ games: 0, events: 0, teams: 0, players: 0, skippedGames: 1 });
    expect(listGames(db)).toHaveLength(1);
    expect(computeScore(getGameBundle(db, game.id)!.events)).toEqual({ A: 4, B: 0 });
  });

  it('自チームがすでにある端末では、取り込む自チームを通常のチームとして追加する', () => {
    const source = openTestDb().db;
    seed(source);
    const target = openTestDb().db;
    ensureOwnTeam(target);
    importBackup(target, parseBackup(JSON.stringify(exportAll(source))));
    const teams = listTeams(target);
    expect(teams).toHaveLength(2);
    expect(teams.filter((t) => t.isOwn)).toHaveLength(1);
  });

  it('進行中の試合が重なる場合は準備中として取り込む', () => {
    const source = openTestDb().db;
    const own = ensureOwnTeam(source);
    addPlayer(source, own.id, { number: '4', name: '' });
    const live = createGame(source);
    addRosterEntry(source, live.id, 'B', { number: '10' });
    startGame(source, live.id);

    const target = openTestDb().db;
    const o2 = ensureOwnTeam(target);
    addPlayer(target, o2.id, { number: '5', name: '' });
    const g = createGame(target);
    addRosterEntry(target, g.id, 'B', { number: '9' });
    startGame(target, g.id);

    importBackup(target, parseBackup(JSON.stringify(exportGame(source, live.id))));
    expect(listGames(target).filter((s) => s.game.status === 'live')).toHaveLength(1);
    expect(getGameBundle(target, live.id)?.game.status).toBe('prep');
  });

  it('形式の違うファイルを拒否する', () => {
    expect(() => parseBackup('not json')).toThrow(RepoError);
    expect(() => parseBackup('{"format":"other"}')).toThrow(/Benchbookのバックアップではありません/);
    const db = openTestDb().db;
    seed(db);
    const data = exportAll(db);
    expect(() => parseBackup(JSON.stringify({ ...data, version: 99 }))).toThrow(/新しいバージョン/);
    expect(() => parseBackup(JSON.stringify({ ...data, gameEvents: 'x' }))).toThrow(/壊れています/);
    const broken = { ...data, gameEvents: [{ ...data.gameEvents[0], orderKey: 'abc' }] };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/gameEvents\.orderKey/);
  });

  it('未知の列は読み飛ばす', () => {
    const db = openTestDb().db;
    const game = seed(db);
    const data = exportGame(db, game.id);
    const withExtra = { ...data, games: [{ ...data.games[0], futureColumn: 1 }] };
    expect(parseBackup(JSON.stringify(withExtra)).games[0]).not.toHaveProperty('futureColumn');
  });
});
