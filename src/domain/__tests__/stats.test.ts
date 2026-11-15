import { buildBoxScore, buildRunningScore, deriveGameState, describeEvent } from '../stats';
import { ev, foul, resetSeq, roster } from './helpers';

beforeEach(resetSeq);

const players = [...roster('A', ['4', '5', '10']), ...roster('B', ['7', '8'])];

describe('buildRunningScore', () => {
  it('累計点・背番号・得点種別・Qの対応表を返す', () => {
    const events = [
      ev('FG2_MADE', 'A', 'A4', 1),
      ev('FG3_MADE', 'B', 'B7', 1),
      ev('FT_MADE', 'A', 'A5', 1),
      ev('FG2_MISS', 'A', 'A5', 1),
      ev('FG3_MADE', 'A', 'A10', 2),
    ];
    const rs = buildRunningScore(events, players);
    expect(rs.A).toEqual([
      { total: 2, points: 2, kind: 'FG2', number: '4', period: 1, periodEnd: false },
      { total: 3, points: 1, kind: 'FT', number: '5', period: 1, periodEnd: false },
      { total: 6, points: 3, kind: 'FG3', number: '10', period: 2, periodEnd: false },
    ]);
    expect(rs.B).toEqual([
      { total: 3, points: 3, kind: 'FG3', number: '7', period: 1, periodEnd: false },
    ]);
  });

  it('終了したQの最後の得点に periodEnd が付く', () => {
    const events = [
      ev('FG2_MADE', 'A', 'A4', 1),
      ev('FG2_MADE', 'A', 'A5', 1),
      ev('FG2_MADE', 'B', 'B7', 1),
      ev('PERIOD_END', null, null, 1),
      ev('FG2_MADE', 'A', 'A4', 2),
    ];
    const rs = buildRunningScore(events, players);
    expect(rs.A.map((e) => e.periodEnd)).toEqual([false, true, false]);
    expect(rs.B.map((e) => e.periodEnd)).toEqual([true]);
  });

  it('取消済みを除き、修正後のイベントは元の位置で数える', () => {
    const wrong = ev('FG2_MADE', 'A', 'A4', 1, { voidedAt: 9 });
    const events = [
      wrong,
      ev('FG2_MADE', 'A', 'A5', 1),
      ev('FG3_MADE', 'A', 'A4', 1, { orderKey: wrong.orderKey, replacesEventId: wrong.id }),
    ];
    const rs = buildRunningScore(events, players);
    expect(rs.A.map((e) => [e.total, e.number])).toEqual([
      [3, '4'],
      [5, '5'],
    ]);
  });
});

describe('buildBoxScore', () => {
  const events = [
    ev('FG2_MADE', 'A', 'A4', 1),
    ev('FG2_MISS', 'A', 'A4', 1),
    ev('FG3_MADE', 'A', 'A4', 2),
    ev('FG3_MISS', 'A', 'A4', 2),
    ev('FT_MADE', 'A', 'A4', 2),
    ev('FT_MISS', 'A', 'A4', 2),
    ev('OREB', 'A', 'A4', 1),
    ev('DREB', 'A', 'A4', 1),
    ev('DREB', 'A', 'A5', 1),
    ev('AST', 'A', 'A5', 1),
    ev('STL', 'A', 'A5', 2),
    ev('BLK', 'A', 'A5', 2),
    ev('TOV', 'A', 'A5', 2),
    foul('A', 'A5', 'P', 2),
    foul('A', null, 'C', 2),
    ev('FG2_MADE', 'B', 'B7', 1),
    ev('FG2_MADE', 'B', 'B7', 1, { voidedAt: 1 }),
  ];

  it('選手ごとの全項目を集計する', () => {
    const box = buildBoxScore(events, players);
    const p4 = box.A.players.find((p) => p.number === '4');
    expect(p4).toMatchObject({
      pts: 6,
      fg2m: 1,
      fg2a: 2,
      fg3m: 1,
      fg3a: 2,
      ftm: 1,
      fta: 2,
      oreb: 1,
      dreb: 1,
      reb: 2,
    });
    const p5 = box.A.players.find((p) => p.number === '5');
    expect(p5).toMatchObject({ dreb: 1, reb: 1, ast: 1, stl: 1, blk: 1, tov: 1, pf: 1 });
  });

  it('チーム合計を出す。ベンチのファウルはPFに含めない', () => {
    const box = buildBoxScore(events, players);
    expect(box.A.total).toMatchObject({ pts: 6, reb: 3, pf: 1 });
    expect(box.B.total.pts).toBe(2);
  });

  it('出場のない選手も0で並び、背番号順になる', () => {
    const box = buildBoxScore(events, players);
    expect(box.A.players.map((p) => p.number)).toEqual(['4', '5', '10']);
    expect(box.A.players[2].pts).toBe(0);
  });

  it('Qで絞り込める', () => {
    const box = buildBoxScore(events, players, 1);
    expect(box.A.total).toMatchObject({ pts: 2, fg2a: 2, fg3a: 0, pf: 0 });
  });
});

describe('deriveGameState', () => {
  it('得点・チームファウル・TO残数・選手状態をまとめて返す', () => {
    const events = [
      ev('FG3_MADE', 'A', 'A4', 1),
      foul('A', 'A4', 'P', 1),
      foul('A', 'A4', 'P', 1),
      foul('A', 'A4', 'P', 1),
      foul('A', 'A4', 'P', 1),
      foul('B', 'B7', 'D', 1),
      ev('TIMEOUT', 'B', null, 1),
    ];
    const state = deriveGameState(events, players, 1);
    expect(state.A.score).toBe(3);
    expect(state.A.teamFouls).toBe(4);
    expect(state.A.inBonus).toBe(true);
    expect(state.A.timeoutsRemaining).toBe(2);
    expect(state.B.timeoutsRemaining).toBe(1);
    expect(state.A.players.find((p) => p.roster.number === '4')).toMatchObject({
      status: 'warning',
      points: 3,
    });
    expect(state.B.players.find((p) => p.roster.number === '7')?.status).toBe('disqualified');
    expect(state.lastTwoMinutes).toBe(false);
  });
});

describe('describeEvent', () => {
  it('ログ用の表記を返す', () => {
    expect(describeEvent(ev('FG3_MADE', 'A', 'A4'), players)).toBe('A #4 3P○');
    expect(describeEvent(foul('B', 'B7', 'U', 1, 2), players)).toBe('B #7 F(U2)');
    expect(describeEvent(foul('A', null, 'C'), players)).toBe('A ベンチ F(C)');
    expect(describeEvent(ev('TIMEOUT', 'B', null), players)).toBe('B TO');
    expect(describeEvent(ev('PERIOD_END', null, null, 5), players)).toBe('OT1終了');
  });
});
