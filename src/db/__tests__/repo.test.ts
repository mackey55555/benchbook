import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeScore, remainingTimeouts } from '@/domain/rules';
import { computeLineupStats, onCourtIds } from '@/domain/lineup';
import { buildRunningScore } from '@/domain/stats';

import {
  RepoError,
  addEvent,
  adjustStat,
  addPlayer,
  addRosterEntry,
  cancelPeriodEnd,
  confirmPeriod,
  createGame,
  createTeam,
  deleteGame,
  endPeriod,
  ensureOwnTeam,
  getGame,
  getGameBundle,
  getLiveGame,
  listEvents,
  listGames,
  listPlayers,
  listRoster,
  loadRosterFromTeam,
  recordMismatch,
  removeRosterEntry,
  replaceEvent,
  saveRosterAsTeam,
  setLastTwoMinutes,
  setOwnSide,
  setStarter,
  startGame,
  substitute,
  toggleCaptain,
  undoLastEvent,
  updateGame,
  voidEvent,
  type Db,
} from '../repo';
import { openTestDb } from './testDb';

function setupGame(db: Db) {
  const own = ensureOwnTeam(db);
  for (const n of ['4', '5', '6', '7', '8']) addPlayer(db, own.id, { number: n, name: `選手${n}` });
  const game = createGame(db);
  updateGame(db, game.id, { teamBName: '相手' });
  for (const n of ['10', '11']) addRosterEntry(db, game.id, 'B', { number: n });
  startGame(db, game.id);
  const roster = listRoster(db, game.id);
  const id = (side: 'A' | 'B', number: string) =>
    roster.find((r) => r.side === side && r.number === number)!.id;
  return { game, id };
}

function addPlayerToRoster(db: Db, gameId: string) {
  addRosterEntry(db, gameId, 'A', { number: '99' });
}

describe('チーム・選手マスタ', () => {
  it('自チームは1つだけ作られる', () => {
    const { db } = openTestDb();
    expect(ensureOwnTeam(db).id).toBe(ensureOwnTeam(db).id);
  });

  it('背番号の重複と不正な値を拒否する', () => {
    const { db } = openTestDb();
    const team = createTeam(db, '相手');
    addPlayer(db, team.id, { number: '4', name: '' });
    expect(() => addPlayer(db, team.id, { number: '4', name: '' })).toThrow(RepoError);
    expect(() => addPlayer(db, team.id, { number: 'x', name: '' })).toThrow(RepoError);
    expect(() => addPlayer(db, team.id, { number: '100', name: '' })).toThrow(RepoError);
    addPlayer(db, team.id, { number: '00', name: '' });
    expect(listPlayers(db, team.id).map((p) => p.number)).toEqual(['00', '4']);
  });
});

describe('試合準備', () => {
  it('自チームの有効な選手が出場登録に入る（最大12名、スナップショット）', () => {
    const { db } = openTestDb();
    const own = ensureOwnTeam(db);
    for (let n = 1; n <= 14; n++) addPlayer(db, own.id, { number: String(n), name: `P${n}` });
    const game = createGame(db);
    const roster = listRoster(db, game.id);
    expect(roster).toHaveLength(12);
    expect(roster.every((r) => r.side === 'A' && r.playerId !== null)).toBe(true);
    expect(getGame(db, game.id)?.status).toBe('prep');
  });

  it('出場登録は12名まで、スターターは5名まで、キャプテンは1名', () => {
    const { db } = openTestDb();
    ensureOwnTeam(db);
    const game = createGame(db);
    for (let n = 1; n <= 12; n++) addRosterEntry(db, game.id, 'B', { number: String(n) });
    expect(() => addRosterEntry(db, game.id, 'B', { number: '13' })).toThrow(/最大12名/);
    const roster = listRoster(db, game.id);
    for (const r of roster.slice(0, 5)) setStarter(db, r.id, true);
    expect(() => setStarter(db, roster[5].id, true)).toThrow(/5名まで/);
    toggleCaptain(db, roster[0].id);
    toggleCaptain(db, roster[1].id);
    expect(listRoster(db, game.id).filter((r) => r.isCaptain).map((r) => r.id)).toEqual([
      roster[1].id,
    ]);
  });

  it('自チームのA/Bを入れ替えると、名前と出場登録が丸ごと入れ替わる', () => {
    const { db } = openTestDb();
    const own = ensureOwnTeam(db);
    addPlayer(db, own.id, { number: '4', name: '' });
    const game = createGame(db);
    updateGame(db, game.id, { teamBName: '相手' });
    addRosterEntry(db, game.id, 'B', { number: '10' });
    setOwnSide(db, game.id, 'B');
    const after = getGame(db, game.id)!;
    expect([after.ownSide, after.teamAName, after.teamBName]).toEqual(['B', '相手', '自チーム']);
    expect(listRoster(db, game.id).map((r) => [r.side, r.number])).toEqual([
      ['A', '10'],
      ['B', '4'],
    ]);
  });

  it('相手チームを保存し、次の試合で呼び出せる', () => {
    const { db } = openTestDb();
    ensureOwnTeam(db);
    const g1 = createGame(db);
    updateGame(db, g1.id, { teamBName: 'ライバルズ' });
    addRosterEntry(db, g1.id, 'B', { number: '10', name: '山田' });
    addRosterEntry(db, g1.id, 'B', { number: '11' });
    const team = saveRosterAsTeam(db, g1.id, 'B');
    expect(saveRosterAsTeam(db, g1.id, 'B').id).toBe(team.id);
    expect(listPlayers(db, team.id)).toHaveLength(2);

    const g2 = createGame(db);
    loadRosterFromTeam(db, g2.id, 'B', team.id);
    expect(getGame(db, g2.id)?.teamBName).toBe('ライバルズ');
    expect(listRoster(db, g2.id).map((r) => [r.number, r.name])).toEqual([
      ['10', '山田'],
      ['11', ''],
    ]);
  });

  it('今日来ている選手だけを選んで読み込める', () => {
    const { db } = openTestDb();
    ensureOwnTeam(db);
    const team = createTeam(db, '大所帯');
    for (let n = 1; n <= 16; n++) addPlayer(db, team.id, { number: String(n), name: '' });
    const here = listPlayers(db, team.id).filter((p) => ['2', '9', '16'].includes(p.number));
    const game = createGame(db);
    loadRosterFromTeam(db, game.id, 'B', team.id, here.map((p) => p.id));
    expect(listRoster(db, game.id).filter((r) => r.side === 'B').map((r) => r.number)).toEqual(['2', '9', '16']);
  });

  it('出場登録が0名のチームがあると開始できない。進行中の試合は1つだけ', () => {
    const { db } = openTestDb();
    const own = ensureOwnTeam(db);
    addPlayer(db, own.id, { number: '4', name: '' });
    const g1 = createGame(db);
    expect(() => startGame(db, g1.id)).toThrow(/0名/);
    addRosterEntry(db, g1.id, 'B', { number: '10' });
    startGame(db, g1.id);
    expect(getLiveGame(db)?.id).toBe(g1.id);
    const g2 = createGame(db);
    addRosterEntry(db, g2.id, 'B', { number: '10' });
    expect(() => startGame(db, g2.id)).toThrow(/進行中/);
  });

  it('記録のある選手は出場登録から外せない', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    expect(() => removeRosterEntry(db, id('A', '4'))).toThrow(/記録のある/);
    removeRosterEntry(db, id('A', '5'));
    expect(listRoster(db, game.id).some((r) => r.number === '5' && r.side === 'A')).toBe(false);
  });
});

describe('イベントの追加・取消・修正', () => {
  it('order_key は追加順に増える', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    const a = addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    const b = addEvent(db, { gameId: game.id, period: 1, side: 'B', rosterId: id('B', '10'), type: 'FG3_MADE' });
    expect(b.orderKey).toBeGreaterThan(a.orderKey);
    expect(computeScore(listEvents(db, game.id))).toEqual({ A: 2, B: 3 });
    expect(listGames(db)[0].score).toEqual({ A: 2, B: 3 });
  });

  it('取消は物理削除せず voided_at を立てる', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    const e = addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    voidEvent(db, e.id);
    const events = listEvents(db, game.id);
    expect(events).toHaveLength(1);
    expect(events[0].voidedAt).not.toBeNull();
    expect(computeScore(events)).toEqual({ A: 0, B: 0 });
  });

  it('修正は元イベントをvoidし、同じ order_key の新イベントで履歴を残す', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    const first = addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    const wrong = addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '5'), type: 'FG2_MADE' });
    const last = addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '6'), type: 'FT_MADE' });
    const fixed = replaceEvent(db, wrong.id, { rosterId: id('A', '7'), type: 'FG3_MADE' });

    expect(fixed.orderKey).toBe(wrong.orderKey);
    expect(fixed.replacesEventId).toBe(wrong.id);
    const events = listEvents(db, game.id);
    expect(events).toHaveLength(4);
    expect(events.find((e) => e.id === wrong.id)?.voidedAt).not.toBeNull();

    const bundle = getGameBundle(db, game.id)!;
    const running = buildRunningScore(bundle.events, bundle.roster).A;
    expect(running.map((r) => [r.total, r.number])).toEqual([
      [2, '4'],
      [5, '7'],
      [6, '6'],
    ]);
    expect([first.id, last.id].every((x) => events.find((e) => e.id === x)?.voidedAt === null)).toBe(true);
  });

  it('修正を重ねても履歴の鎖がつながり、有効なのは最後の1件だけ', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    const e1 = addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    const e2 = replaceEvent(db, e1.id, { type: 'FG3_MADE' });
    const e3 = replaceEvent(db, e2.id, { side: 'B', rosterId: id('B', '10') });
    const events = listEvents(db, game.id);
    expect(events.filter((e) => e.voidedAt === null).map((e) => e.id)).toEqual([e3.id]);
    expect(e3.replacesEventId).toBe(e2.id);
    expect(e2.replacesEventId).toBe(e1.id);
    expect(new Set(events.map((e) => e.orderKey)).size).toBe(1);
    expect(computeScore(events)).toEqual({ A: 0, B: 3 });
    expect(() => replaceEvent(db, e1.id, { type: 'FT_MADE' })).toThrow(/取消済み/);
  });

  it('UNDOはそのピリオドの直前の有効イベントをvoidする', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    const second = addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '5'), type: 'FG3_MADE' });
    expect(undoLastEvent(db, game.id, 1)?.id).toBe(second.id);
    expect(computeScore(listEvents(db, game.id))).toEqual({ A: 2, B: 0 });
    undoLastEvent(db, game.id, 1);
    expect(undoLastEvent(db, game.id, 1)).toBeNull();
    expect(listEvents(db, game.id)).toHaveLength(2);
  });

  it('UNDOは前のQのイベントやQ終了マーカーを取り消さない', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    confirmPeriod(db, game.id, 1);
    expect(undoLastEvent(db, game.id, 2)).toBeNull();
    expect(computeScore(listEvents(db, game.id))).toEqual({ A: 2, B: 0 });
  });

  it('ファウルの属性を検証する（C/Bはベンチのみ、FTは0〜3）', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    const base = { gameId: game.id, period: 1, side: 'A' as const, type: 'FOUL' as const };
    expect(addEvent(db, { ...base, rosterId: id('A', '4') })).toMatchObject({ foulKind: 'P', ftAwarded: 0 });
    expect(addEvent(db, { ...base, rosterId: null, foulKind: 'C', ftAwarded: 1 })).toMatchObject({ foulKind: 'C', ftAwarded: 1 });
    expect(() => addEvent(db, { ...base, rosterId: id('A', '4'), foulKind: 'C' })).toThrow(RepoError);
    expect(() => addEvent(db, { ...base, rosterId: null, foulKind: 'P' })).toThrow(RepoError);
    expect(() => addEvent(db, { ...base, rosterId: id('A', '4'), ftAwarded: 4 })).toThrow(RepoError);
  });

  it('TOは残数があるときだけ記録できる', () => {
    const { db } = openTestDb();
    const { game } = setupGame(db);
    const to = { gameId: game.id, period: 1, side: 'A' as const, rosterId: null, type: 'TIMEOUT' as const };
    addEvent(db, to);
    addEvent(db, to);
    expect(() => addEvent(db, to)).toThrow(/残っていません/);
    expect(remainingTimeouts(listEvents(db, game.id), 'A', 1)).toBe(0);
  });

  it('残り2分トグルはON/OFFでき、TO残数に反映される', () => {
    const { db } = openTestDb();
    const { game } = setupGame(db);
    setLastTwoMinutes(db, game.id, true);
    setLastTwoMinutes(db, game.id, true);
    expect(remainingTimeouts(listEvents(db, game.id), 'A', 4)).toBe(2);
    setLastTwoMinutes(db, game.id, false);
    expect(remainingTimeouts(listEvents(db, game.id), 'A', 4)).toBe(3);
  });
});

describe('交代', () => {
  function setupLineup(db: Db) {
    const ctx = setupGame(db);
    for (const n of ['4', '5', '6', '7']) setStarter(db, ctx.id('A', n), true);
    return ctx;
  }
  const court = (db: Db, gameId: string) => {
    const b = getGameBundle(db, gameId)!;
    return [...onCourtIds(b.events, b.roster, 'A')].map((id) => b.roster.find((r) => r.id === id)!.number).sort();
  };

  it('コート上の選手との差分を IN/OUT として記録する', () => {
    const { db } = openTestDb();
    const { game, id } = setupLineup(db);
    const n = substitute(db, {
      gameId: game.id, period: 1, side: 'A', clockSeconds: 392,
      onCourt: [id('A', '5'), id('A', '6'), id('A', '7'), id('A', '8')],
    });
    expect(n).toBe(2);
    expect(court(db, game.id)).toEqual(['5', '6', '7', '8']);
    const subs = listEvents(db, game.id).filter((e) => e.type.startsWith('SUB'));
    expect(subs.map((e) => [e.type, e.clockSeconds])).toEqual([['SUB_OUT', 392], ['SUB_IN', 392]]);
  });

  it('変更がなければ何も記録しない。6人以上・不正な時刻は拒否する', () => {
    const { db } = openTestDb();
    const { game, id } = setupLineup(db);
    const same = ['4', '5', '6', '7'].map((n) => id('A', n));
    expect(substitute(db, { gameId: game.id, period: 1, side: 'A', clockSeconds: null, onCourt: same })).toBe(0);
    const base = { gameId: game.id, period: 1, side: 'A' as const };
    expect(() => substitute(db, { ...base, clockSeconds: 601, onCourt: same })).toThrow(/残り時間/);
    addPlayerToRoster(db, game.id);
    const six = [...same, id('A', '8'), listRoster(db, game.id).find((r) => r.number === '99')!.id];
    expect(() => substitute(db, { ...base, clockSeconds: null, onCourt: six })).toThrow(/5人まで/);
    expect(() => substitute(db, { ...base, clockSeconds: null, onCourt: [id('B', '10')] })).toThrow(/出場登録にない/);
  });

  it('UNDOは1回の交代（IN/OUT）をまとめて取り消す', () => {
    const { db } = openTestDb();
    const { game, id } = setupLineup(db);
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    substitute(db, {
      gameId: game.id, period: 1, side: 'A', clockSeconds: null,
      onCourt: [id('A', '6'), id('A', '7'), id('A', '8')],
    });
    expect(court(db, game.id)).toEqual(['6', '7', '8']);
    undoLastEvent(db, game.id, 1);
    expect(court(db, game.id)).toEqual(['4', '5', '6', '7']);
    expect(computeScore(listEvents(db, game.id))).toEqual({ A: 2, B: 0 });
  });

  it('出場時間と +/- が試合設定（Q時間）から出る', () => {
    const { db } = openTestDb();
    const { game, id } = setupLineup(db);
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG3_MADE' });
    substitute(db, {
      gameId: game.id, period: 1, side: 'A', clockSeconds: 300,
      onCourt: [id('A', '5'), id('A', '6'), id('A', '7'), id('A', '8')],
    });
    addEvent(db, { gameId: game.id, period: 1, side: 'B', rosterId: id('B', '10'), type: 'FG2_MADE' });
    confirmPeriod(db, game.id, 1);
    const b = getGameBundle(db, game.id)!;
    const stats = computeLineupStats(b.events, b.roster, { ...b.game, finished: b.game.status === 'finished' });
    expect(stats.get(id('A', '4'))).toMatchObject({ seconds: 300, plusMinus: 3, approximate: false });
    expect(stats.get(id('A', '8'))).toMatchObject({ seconds: 300, plusMinus: -2 });
    expect(stats.get(id('A', '5'))).toMatchObject({ seconds: 600, plusMinus: 1 });
    expect(stats.has(id('B', '10'))).toBe(false);
  });
});

describe('Q終了・照合', () => {
  it('一致で period_checks に記録して次のQへ進む', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    addEvent(db, { gameId: game.id, period: 1, side: 'B', rosterId: id('B', '10'), type: 'FOUL' });
    endPeriod(db, game.id, 1);
    expect(confirmPeriod(db, game.id, 1)).toBe('nextPeriod');
    const bundle = getGameBundle(db, game.id)!;
    expect(bundle.game.currentPeriod).toBe(2);
    expect(bundle.checks).toHaveLength(1);
    expect(bundle.checks[0]).toMatchObject({ period: 1, scoreA: 2, scoreB: 0, teamFoulsA: 0, teamFoulsB: 1, matched: true });
  });

  it('不一致を記録し、修正後の一致で上書きする', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    const e = addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    endPeriod(db, game.id, 1);
    recordMismatch(db, game.id, 1);
    expect(getGameBundle(db, game.id)!.checks[0]).toMatchObject({ matched: false, scoreA: 2 });
    replaceEvent(db, e.id, { type: 'FG3_MADE' });
    confirmPeriod(db, game.id, 1);
    const checks = getGameBundle(db, game.id)!.checks;
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ matched: true, scoreA: 3 });
  });

  it('Q終了は取り消して入力に戻れる', () => {
    const { db } = openTestDb();
    const { game } = setupGame(db);
    endPeriod(db, game.id, 1);
    endPeriod(db, game.id, 1);
    expect(listEvents(db, game.id).filter((e) => e.type === 'PERIOD_END' && !e.voidedAt)).toHaveLength(1);
    cancelPeriodEnd(db, game.id, 1);
    expect(listEvents(db, game.id).filter((e) => e.type === 'PERIOD_END' && !e.voidedAt)).toHaveLength(0);
    expect(getGame(db, game.id)?.currentPeriod).toBe(1);
  });

  it('第4Q終了時に同点なら延長、決着したら試合終了', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    for (const p of [1, 2, 3]) confirmPeriod(db, game.id, p);
    expect(confirmPeriod(db, game.id, 4)).toBe('overtime');
    expect(getGame(db, game.id)).toMatchObject({ status: 'live', currentPeriod: 5 });
    addEvent(db, { gameId: game.id, period: 5, side: 'B', rosterId: id('B', '10'), type: 'FT_MADE' });
    expect(confirmPeriod(db, game.id, 5)).toBe('finished');
    const finished = getGame(db, game.id)!;
    expect(finished.status).toBe('finished');
    expect(finished.finishedAt).not.toBeNull();
    expect(getLiveGame(db)).toBeUndefined();
  });
});

describe('同点のまま試合終了', () => {
  it('第4Qが同点でも、endTied を付ければ延長に入らず終了する', () => {
    const { db } = openTestDb();
    const { game } = setupGame(db);
    for (const p of [1, 2, 3]) {
      endPeriod(db, game.id, p);
      confirmPeriod(db, game.id, p);
    }
    endPeriod(db, game.id, 4);
    expect(confirmPeriod(db, game.id, 4, '', { endTied: true })).toBe('finished');
    expect(getGame(db, game.id)).toMatchObject({ status: 'finished', currentPeriod: 4 });
  });

  it('第3Qまでは endTied を付けても次のQへ進む', () => {
    const { db } = openTestDb();
    const { game } = setupGame(db);
    endPeriod(db, game.id, 1);
    expect(confirmPeriod(db, game.id, 1, '', { endTied: true })).toBe('nextPeriod');
  });
});

describe('強制終了後の復帰', () => {
  it('確定済みのイベントは、DBを閉じずにプロセスが落ちても失われない', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchbook-'));
    const file = path.join(dir, 'crash.db');
    try {
      const first = openTestDb(file);
      const { game, id } = setupGame(first.db);
      addEvent(first.db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG3_MADE' });
      const undone = addEvent(first.db, { gameId: game.id, period: 1, side: 'B', rosterId: id('B', '10'), type: 'FG2_MADE' });
      voidEvent(first.db, undone.id);
      addEvent(first.db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '5'), type: 'FOUL' });
      // close() を呼ばない＝強制終了を模擬。WALに残った内容を別の接続から読む
      const second = openTestDb(file);
      const live = getLiveGame(second.db);
      expect(live?.id).toBe(game.id);
      const bundle = getGameBundle(second.db, game.id)!;
      expect(bundle.events).toHaveLength(3);
      expect(computeScore(bundle.events)).toEqual({ A: 3, B: 0 });
      expect(bundle.game.currentPeriod).toBe(1);
      second.raw.close();
      first.raw.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('途中で失敗したトランザクションは何も残さない', () => {
    const { db } = openTestDb();
    const { game } = setupGame(db);
    const before = listEvents(db, game.id).length;
    expect(() =>
      db.transaction((tx) => {
        addEvent(tx, { gameId: game.id, period: 1, side: 'A', rosterId: null, type: 'TIMEOUT' });
        throw new Error('crash');
      }),
    ).toThrow('crash');
    expect(listEvents(db, game.id)).toHaveLength(before);
  });
});

describe('試合の削除', () => {
  it('試合と関連データをまとめて消す', () => {
    const { db } = openTestDb();
    const { game } = setupGame(db);
    endPeriod(db, game.id, 1);
    confirmPeriod(db, game.id, 1);
    deleteGame(db, game.id);
    expect(getGameBundle(db, game.id)).toBeUndefined();
    expect(listGames(db)).toHaveLength(0);
  });
});

describe('選手別の修正表（adjustStat）', () => {
  it('+1 はそのQの最後に入り、ランニングスコアの並びを崩さない', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '4'), type: 'FG2_MADE' });
    endPeriod(db, game.id, 1);
    confirmPeriod(db, game.id, 1);
    addEvent(db, { gameId: game.id, period: 2, side: 'A', rosterId: id('A', '5'), type: 'FG3_MADE' });

    adjustStat(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '6'), type: 'FT_MADE', delta: 1 });

    const bundle = getGameBundle(db, game.id)!;
    const running = buildRunningScore(bundle.events, bundle.roster).A;
    expect(running.map((r) => [r.number, r.period, r.total])).toEqual([
      ['4', 1, 2],
      ['6', 1, 3],
      ['5', 2, 6],
    ]);
    expect(running[1].periodEnd).toBe(true);
  });

  it('記録の無いQにも足せる（Q終了の印より前に入る）', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    endPeriod(db, game.id, 1);
    adjustStat(db, { gameId: game.id, period: 1, side: 'B', rosterId: id('B', '10'), type: 'FG2_MADE', delta: 1 });
    const events = listEvents(db, game.id).filter((e) => e.voidedAt === null);
    expect(events.map((e) => e.type)).toEqual(['FG2_MADE', 'PERIOD_END']);
    expect(computeScore(events)).toEqual({ A: 0, B: 2 });
  });

  it('-1 はその選手・Q・項目の最後の1件だけを取り消す', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    const four = id('A', '4');
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: four, type: 'FG2_MADE' });
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: four, type: 'FG3_MADE' });
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: id('A', '5'), type: 'FG2_MADE' });
    adjustStat(db, { gameId: game.id, period: 1, side: 'A', rosterId: four, type: 'FG2_MADE', delta: -1 });
    expect(computeScore(listEvents(db, game.id))).toEqual({ A: 5, B: 0 });
    expect(() =>
      adjustStat(db, { gameId: game.id, period: 1, side: 'A', rosterId: four, type: 'FG2_MADE', delta: -1 }),
    ).toThrow(RepoError);
    expect(() =>
      adjustStat(db, { gameId: game.id, period: 2, side: 'A', rosterId: four, type: 'FG3_MADE', delta: -1 }),
    ).toThrow(RepoError);
  });

  it('ファウルは P・FT0 で足し、種類を問わず最後の1件を減らす', () => {
    const { db } = openTestDb();
    const { game, id } = setupGame(db);
    const four = id('A', '4');
    adjustStat(db, { gameId: game.id, period: 1, side: 'A', rosterId: four, type: 'FOUL', delta: 1 });
    addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: four, type: 'FOUL', foulKind: 'U', ftAwarded: 2 });
    const active = () => listEvents(db, game.id).filter((e) => e.voidedAt === null && e.type === 'FOUL');
    expect(active().map((e) => [e.foulKind, e.ftAwarded])).toEqual([
      ['P', 0],
      ['U', 2],
    ]);
    adjustStat(db, { gameId: game.id, period: 1, side: 'A', rosterId: four, type: 'FOUL', delta: -1 });
    expect(active().map((e) => e.foulKind)).toEqual(['P']);
  });
});
