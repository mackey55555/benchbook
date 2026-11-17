import { analyzeTeam, statColumn, statValue } from '../analysis';
import {
  buildTimeline,
  computeUnitStats,
  longestDroughts,
  longestRuns,
  scoreFlow,
  timeBands,
} from '../timeline';
import type { RosterEntry } from '../types';
import { ev, resetSeq, roster } from './helpers';

const cfg = { periodMinutes: 10, otMinutes: 5, currentPeriod: 4 };
/** 残り時間つきの記録 */
const at = (clock: number) => ({ clockSeconds: clock });

beforeEach(resetSeq);

describe('時刻の割り当て', () => {
  it('時計を使ったピリオドは、記録の残り時間から経過秒を出す', () => {
    const tl = buildTimeline(
      [ev('FG2_MADE', 'A', 'A4', 1, at(540)), ev('FG3_MADE', 'B', 'B4', 1, at(300)), ev('FT_MADE', 'A', 'A4', 2, at(600))],
      cfg,
    );
    expect(tl.events.map((x) => x.t)).toEqual([60, 300, 600]);
    expect(tl.periods.map((p) => p.timed)).toEqual([true, true, false, false]);
    expect(tl.hasTime).toBe(true);
    expect(tl.regulationTimed).toBe(false);
    expect(tl.fullyTimed).toBe(true);
    expect(tl.total).toBe(2400);
  });

  it('時計を使っていないピリオドは、記録を等間隔に並べる', () => {
    const tl = buildTimeline([ev('FG2_MADE', 'A', 'A4'), ev('FG2_MADE', 'B', 'B4'), ev('FG2_MADE', 'A', 'A4')], cfg);
    expect(tl.events.map((x) => x.t)).toEqual([150, 300, 450]);
    expect(tl.hasTime).toBe(false);
    expect(tl.fullyTimed).toBe(false);
  });

  it('時刻のない記録は直前の時刻を引き継ぎ、時刻が戻っても並びは守る', () => {
    const tl = buildTimeline(
      [
        ev('FG2_MADE', 'A', 'A4', 1, at(500)),
        ev('FG2_MADE', 'A', 'A4', 1, at(400)),
        ev('FG2_MADE', 'A', 'A4'),
        ev('FG2_MADE', 'A', 'A4', 1, at(450)),
        ev('FG2_MADE', 'A', 'A4', 1, at(300)),
      ],
      cfg,
    );
    expect(tl.events.map((x) => x.t)).toEqual([100, 200, 200, 200, 300]);
  });

  it('交代だけに時刻がある試合は、時計を使った試合とみなさない', () => {
    const tl = buildTimeline(
      [ev('FG2_MADE', 'A', 'A4'), ev('SUB_OUT', 'A', 'A4', 1, at(300)), ev('FG2_MADE', 'A', 'A5')],
      cfg,
    );
    expect(tl.periods[0].timed).toBe(false);
  });
});

describe('得点の流れ', () => {
  it('0-0 から始まり、得点のたびに累計が増え、最後は試合の長さの位置で終わる', () => {
    const tl = buildTimeline([ev('FG2_MADE', 'A', 'A4', 1, at(540)), ev('FG3_MADE', 'B', 'B4', 1, at(300)), ev('FOUL', 'A', 'A4', 1, at(200))], cfg);
    expect(scoreFlow(tl)).toEqual([
      { t: 0, A: 0, B: 0 },
      { t: 60, A: 2, B: 0 },
      { t: 300, A: 2, B: 3 },
      { t: 2400, A: 2, B: 3 },
    ]);
  });
});

describe('時間帯別', () => {
  it('各Qを前半・後半に分け、第4Qは残り2分を内数で出す', () => {
    const tl = buildTimeline(
      [
        ev('FG2_MADE', 'A', 'A4', 1, at(590)),
        ev('FG3_MADE', 'B', 'B4', 1, at(300)),
        ev('FG2_MADE', 'A', 'A4', 1, at(0)),
        ev('FG2_MADE', 'A', 'A4', 4, at(400)),
        ev('FG3_MADE', 'A', 'A4', 4, at(120)),
        ev('FT_MADE', 'B', 'B4', 4, at(5)),
      ],
      cfg,
    );
    const bands = Object.fromEntries(timeBands(tl).map((b) => [b.key, b.score]));
    expect(bands.p1a).toEqual({ A: 2, B: 0 });
    // ちょうど半分（残り5:00）は後半に入れる
    expect(bands.p1b).toEqual({ A: 2, B: 3 });
    expect(bands.p2a).toBeNull();
    expect(bands.p4a).toEqual({ A: 2, B: 0 });
    expect(bands.p4b).toEqual({ A: 3, B: 1 });
    expect(bands.clutch).toEqual({ A: 3, B: 1 });
  });
});

describe('連続得点と無得点', () => {
  it('相手に得点を許さずに取った点の最大を、チームごとに出す', () => {
    const tl = buildTimeline(
      [
        ev('FG2_MADE', 'A', 'A4'),
        ev('FG2_MADE', 'B', 'B4'),
        ev('FG3_MADE', 'B', 'B4'),
        ev('FOUL', 'A', 'A4', 1, { foulKind: 'P', ftAwarded: 0 }),
        ev('FT_MADE', 'B', 'B4', 2),
        ev('FG2_MADE', 'A', 'A4', 2),
      ],
      cfg,
    );
    const runs = longestRuns(tl);
    expect(runs.B).toMatchObject({ points: 6, fromPeriod: 1, toPeriod: 2, before: { A: 2, B: 0 }, after: { A: 2, B: 6 } });
    expect(runs.A).toMatchObject({ points: 2 });
  });

  it('無得点の時間は、試合の始めと終わりも含めて数える', () => {
    const tl = buildTimeline(
      [ev('FG2_MADE', 'A', 'A4', 1, at(500)), ev('FG2_MADE', 'B', 'B4', 1, at(450)), ev('FG2_MADE', 'A', 'A4', 1, at(100)), ev('PERIOD_END', null, null)],
      { ...cfg, currentPeriod: 1 },
    );
    const d = longestDroughts(tl);
    expect(d.A).toMatchObject({ seconds: 400, fromT: 100, toT: 500 });
    // B は残り7:30で取ったきり。Q1の終わりまで450秒
    expect(d.B).toMatchObject({ seconds: 450, fromT: 150, toT: 600 });
  });

  it('時計を使っていないピリオドがあると、無得点の時間は出さない', () => {
    const tl = buildTimeline([ev('FG2_MADE', 'A', 'A4', 1, at(500)), ev('FG2_MADE', 'A', 'A4', 2)], cfg);
    expect(longestDroughts(tl)).toEqual({ A: null, B: null });
  });
});

describe('コート上の組み合わせ', () => {
  const starters = (side: 'A' | 'B', numbers: string[], bench: string[]): RosterEntry[] => [
    ...roster(side, numbers).map((r) => ({ ...r, isStarter: true })),
    ...roster(side, bench),
  ];

  it('組み合わせごとに、出場時間と得失点を数える', () => {
    const r = [...starters('A', ['4', '5', '6', '7', '8'], ['9']), ...roster('B', ['4'])];
    const events = [
      ev('FG2_MADE', 'A', 'A4', 1, at(500)),
      ev('FG3_MADE', 'B', 'B4', 1, at(400)),
      ev('SUB_OUT', 'A', 'A8', 1, { clockSeconds: 300, createdAt: 100 }),
      ev('SUB_IN', 'A', 'A9', 1, { clockSeconds: 300, createdAt: 100 }),
      ev('FG3_MADE', 'A', 'A9', 1, at(100)),
      ev('PERIOD_END', null, null),
    ];
    const stats = computeUnitStats(events, r, { ...cfg, currentPeriod: 1, finished: true }, 'A')!;
    expect(stats.approximate).toBe(false);
    // 出場時間が同じなら、得失点差の大きい順
    expect(stats.units).toEqual([
      { rosterIds: ['A4', 'A5', 'A6', 'A7', 'A9'], seconds: 300, pointsFor: 3, pointsAgainst: 0 },
      { rosterIds: ['A4', 'A5', 'A6', 'A7', 'A8'], seconds: 300, pointsFor: 2, pointsAgainst: 3 },
    ]);
    // 出場時間の合計は、5人 × 試合の長さ
    expect(stats.units.reduce((n, u) => n + u.seconds * u.rosterIds.length, 0)).toBe(600 * 5);
  });

  it('交代を記録していないチームは null', () => {
    expect(computeUnitStats([ev('FG2_MADE', 'A', 'A4')], roster('A', ['4']), { ...cfg, finished: true }, 'A')).toBeNull();
  });

  it('時刻のないプレー中の交代は概算になる', () => {
    const r = starters('A', ['4', '5', '6', '7', '8'], ['9']);
    const events = [
      ev('FG2_MADE', 'A', 'A4'),
      ev('SUB_OUT', 'A', 'A8', 1, { clockSeconds: 300, createdAt: 100 }),
      ev('SUB_IN', 'A', 'A9', 1, { clockSeconds: 300, createdAt: 100 }),
      ev('SUB_OUT', 'A', 'A9', 1, { createdAt: 200 }),
      ev('SUB_IN', 'A', 'A8', 1, { createdAt: 200 }),
    ];
    expect(computeUnitStats(events, r, { ...cfg, currentPeriod: 1, finished: true }, 'A')!.approximate).toBe(true);
  });
});

describe('分析への集計', () => {
  const game = (id: string, timedAll: boolean) => {
    resetSeq();
    const r: RosterEntry[] = [
      ...roster('A', ['4', '5', '6', '7', '8']).map((x) => ({ ...x, isStarter: true, playerId: `P${x.number}` })),
      ...roster('A', ['9']).map((x) => ({ ...x, playerId: 'P9' })),
      ...roster('B', ['4']),
    ];
    const events = [1, 2, 3, 4].flatMap((p) => [
      ev('FG2_MADE', 'A', 'A4', p, timedAll || p === 1 ? at(500) : {}),
      ev('FG3_MADE', 'B', 'B4', p, timedAll || p === 1 ? at(100) : {}),
      ev('PERIOD_END', null, null, p),
    ]);
    return { game: { id, date: `2026-11-0${id}`, ownSide: 'A' as const, teamAName: '自', teamBName: '相手' }, roster: r, events };
  };

  it('時間帯別は、4つのQすべてで時計を使った試合だけを足す', () => {
    const a = analyzeTeam([game('1', true), game('2', true), game('3', false)]);
    expect(a.games).toBe(3);
    expect(a.timedGames).toBe(2);
    const bands = Object.fromEntries(a.bands.map((b) => [b.key, b]));
    expect(bands.p1a).toMatchObject({ own: 4, opp: 0 });
    expect(bands.p1b).toMatchObject({ own: 0, opp: 6 });
    expect(bands.clutch).toMatchObject({ own: 0, opp: 6 });
  });

  it('5人の組み合わせは、試合をまたいで同じ5人として束ねる', () => {
    const a = analyzeTeam([game('1', true), game('2', true)]);
    expect(a.units).toHaveLength(1);
    expect(a.units[0]).toMatchObject({
      numbers: ['4', '5', '6', '7', '8'],
      games: 2,
      seconds: 4800,
      pointsFor: 16,
      pointsAgainst: 24,
    });
  });

  it('40分換算は、出場時間のある試合の成績を40分あたりに直す', () => {
    const a = analyzeTeam([game('1', true), game('2', true)]);
    const p4 = a.players.find((p) => p.number === '4')!;
    // 2試合フル出場（80分）で16点 → 40分あたり8点
    expect(statValue(statColumn('pts'), p4.line, p4.games, 'per40')).toBeCloseTo(8);
    expect(statValue(statColumn('pm'), p4.line, p4.games, 'per40')).toBeCloseTo(-4);
    // 出場時間のない選手は出さない
    const p9 = a.players.find((p) => p.number === '9')!;
    expect(statValue(statColumn('pts'), p9.line, p9.games, 'per40')).toBeNull();
  });
});
