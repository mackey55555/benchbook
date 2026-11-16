import {
  NO_FILTER,
  analyzeTeam,
  countFixStats,
  filterGames,
  gameResult,
  pct,
  rangeStart,
  statColumn,
  statValue,
  formatStat,
  type AnalysisGame,
} from '../analysis';
import type { GameStatus, Side } from '../types';
import { ev, foul, resetSeq, roster } from './helpers';

beforeEach(resetSeq);

describe('gameResult', () => {
  it('自チームの側から見た勝敗を返す', () => {
    expect(gameResult('A', { A: 60, B: 50 })).toBe('win');
    expect(gameResult('B', { A: 60, B: 50 })).toBe('lose');
    expect(gameResult('B', { A: 50, B: 50 })).toBe('draw');
  });
});

describe('rangeStart', () => {
  it('今月・今年度（4月始まり）・3か月前を返す', () => {
    expect(rangeStart('all', '2026-11-16')).toBeNull();
    expect(rangeStart('month', '2026-11-16')).toBe('2026-11-01');
    expect(rangeStart('fiscal', '2026-11-16')).toBe('2026-04-01');
    expect(rangeStart('fiscal', '2027-03-31')).toBe('2026-04-01');
    expect(rangeStart('fiscal', '2027-04-01')).toBe('2027-04-01');
    expect(rangeStart('3months', '2026-11-16')).toBe('2026-08-16');
  });

  it('3か月前は年をまたぎ、存在しない日は月末に寄せる', () => {
    expect(rangeStart('3months', '2027-02-10')).toBe('2026-11-10');
    expect(rangeStart('3months', '2026-05-31')).toBe('2026-02-28');
  });
});

describe('filterGames', () => {
  const row = (
    date: string,
    status: GameStatus,
    a: number,
    b: number,
    extra: { ownSide?: Side; teamBName?: string; leagueName?: string } = {},
  ) => ({
    game: {
      date,
      status,
      ownSide: extra.ownSide ?? ('A' as Side),
      teamAName: '自チーム',
      teamBName: extra.teamBName ?? '相手',
      leagueName: extra.leagueName ?? '',
      venue: '',
    },
    score: { A: a, B: b },
  });
  const rows = [
    row('2026-11-10', 'finished', 60, 50),
    row('2026-11-03', 'finished', 40, 50, { teamBName: 'Tigers' }),
    row('2026-10-20', 'finished', 50, 50, { leagueName: '秋季大会' }),
    row('2026-11-12', 'live', 10, 0),
    row('2026-03-01', 'finished', 30, 70, { ownSide: 'B' }),
  ];
  const today = '2026-11-16';

  it('絞り込みなしは全件', () => {
    expect(filterGames(rows, NO_FILTER, today)).toHaveLength(5);
  });

  it('期間で絞る', () => {
    expect(filterGames(rows, { ...NO_FILTER, range: 'month' }, today)).toHaveLength(3);
    expect(filterGames(rows, { ...NO_FILTER, range: 'fiscal' }, today)).toHaveLength(4);
  });

  it('勝敗で絞ると終了した試合だけが残り、自チームの側で判定する', () => {
    const wins = filterGames(rows, { ...NO_FILTER, result: 'win' }, today);
    expect(wins.map((r) => r.game.date)).toEqual(['2026-11-10', '2026-03-01']);
    expect(filterGames(rows, { ...NO_FILTER, result: 'lose' }, today)).toHaveLength(1);
    expect(filterGames(rows, { ...NO_FILTER, result: 'draw' }, today)).toHaveLength(1);
  });

  it('チーム名・大会名を大文字小文字を問わず部分一致で探す', () => {
    expect(filterGames(rows, { ...NO_FILTER, query: 'tig' }, today)).toHaveLength(1);
    expect(filterGames(rows, { ...NO_FILTER, query: '秋季' }, today)).toHaveLength(1);
    expect(filterGames(rows, { ...NO_FILTER, query: ' ' }, today)).toHaveLength(5);
  });
});

describe('analyzeTeam', () => {
  const game = (id: string, date: string, ownSide: Side, build: () => AnalysisGame['events'], playerIds: Record<string, string> = {}): AnalysisGame => ({
    game: { id, date, ownSide, teamAName: 'A組', teamBName: 'B組' },
    roster: [...roster('A', ['4', '5']), ...roster('B', ['4', '9'])].map((r) => ({
      ...r,
      playerId: r.side === ownSide ? (playerIds[r.number] ?? null) : null,
    })),
    events: build(),
  });

  it('試合が無ければ空の集計になる', () => {
    const a = analyzeTeam([]);
    expect(a.games).toBe(0);
    expect(a.periods.map((p) => p.own)).toEqual([0, 0, 0, 0]);
    expect(a.players).toEqual([]);
  });

  it('勝敗・推移・Q別平均・チーム合計を自チームの視点で集計する', () => {
    const g1 = game('g1', '2026-11-02', 'A', () => [
      ev('FG2_MADE', 'A', 'A4', 1),
      ev('FG3_MADE', 'A', 'A5', 2),
      ev('FG3_MISS', 'A', 'A5', 2),
      ev('FG2_MADE', 'B', 'B9', 1),
      ev('DREB', 'A', 'A4', 3),
    ]);
    // 日付の古い試合。自チームはB側
    const g0 = game('g0', '2026-10-01', 'B', () => [
      ev('FG2_MADE', 'A', 'A4', 1),
      ev('FG2_MADE', 'A', 'A4', 4),
      ev('FT_MADE', 'B', 'B4', 1),
      ev('FT_MISS', 'B', 'B4', 1),
      foul('B', 'B4', 'P', 2),
    ]);
    const a = analyzeTeam([g1, g0]);
    expect([a.games, a.wins, a.losses, a.draws]).toEqual([2, 1, 1, 0]);
    expect(a.trend.map((t) => [t.id, t.opponent, t.own, t.opp, t.result])).toEqual([
      ['g0', 'A組', 1, 4, 'lose'],
      ['g1', 'B組', 5, 2, 'win'],
    ]);
    expect(a.periods).toEqual([
      { period: 1, own: 1.5, opp: 2 },
      { period: 2, own: 1.5, opp: 0 },
      { period: 3, own: 0, opp: 0 },
      { period: 4, own: 0, opp: 1 },
    ]);
    expect(a.own.pts).toBe(6);
    expect(a.opp.pts).toBe(6);
    expect([a.own.fg3m, a.own.fg3a, a.own.ftm, a.own.fta, a.own.reb, a.own.pf]).toEqual([1, 2, 1, 2, 1, 1]);
  });

  it('選手はマスタのIDで束ね、背番号が変わっても同じ選手として合算する', () => {
    const g1 = game('g1', '2026-10-01', 'A', () => [ev('FG2_MADE', 'A', 'A4', 1)], { '4': 'p1', '5': 'p2' });
    const g2 = game('g2', '2026-10-08', 'A', () => [ev('FG3_MADE', 'A', 'A5', 1)], { '5': 'p1' });
    const a = analyzeTeam([g1, g2]);
    const p1 = a.players.find((p) => p.key === 'p1')!;
    expect([p1.number, p1.games, p1.line.pts]).toEqual(['5', 2, 5]);
    // g2 の #4 はマスタに無いので、背番号と氏名で別の選手として数える
    expect(a.players).toHaveLength(3);
    expect(p1.log.map((l) => [l.gameId, l.opponent, l.result, l.line.pts])).toEqual([
      ['g1', 'B組', 'win', 2],
      ['g2', 'B組', 'win', 3],
    ]);
    expect(a.trend.map((t) => [t.ownLine.pts, t.oppLine.pts])).toEqual([
      [2, 0],
      [3, 0],
    ]);
  });
});

describe('pct', () => {
  it('試投が0なら null', () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(1, 4)).toBe(25);
  });
});

describe('countFixStats', () => {
  it('指定Qの成功数とファウル数だけを数える', () => {
    const events = [
      ev('FG2_MADE', 'A', 'A4', 1),
      ev('FG2_MADE', 'A', 'A4', 1),
      ev('FG2_MISS', 'A', 'A4', 1),
      ev('FG3_MADE', 'A', 'A4', 2),
      ev('FT_MADE', 'A', 'A4', 1, { voidedAt: 1 }),
      foul('A', 'A4', 'U', 1, 2),
      foul('A', null, 'B', 1, 1),
    ];
    const counts = countFixStats(events, 1);
    expect(counts.get('A4')).toEqual({ FG2_MADE: 2, FG3_MADE: 0, FT_MADE: 0, FOUL: 1 });
    expect(counts.size).toBe(1);
  });
});

describe('statValue / formatStat', () => {
  const line = analyzeTeam([
    {
      game: { id: 'g', date: '2026-10-01', ownSide: 'A', teamAName: '', teamBName: '' },
      roster: roster('A', ['4']),
      events: [ev('FG3_MADE', 'A', 'A4'), ev('FG3_MISS', 'A', 'A4'), ev('FG3_MISS', 'A', 'A4'), ev('AST', 'A', 'A4')],
    },
  ]).own;

  it('数は合計と1試合平均を出し分け、成功率は平均にしない', () => {
    const pts = statColumn('pts');
    expect(statValue(pts, line, 4, 'total')).toBe(3);
    expect(statValue(pts, line, 4, 'avg')).toBe(0.75);
    expect(formatStat(pts, 3, 'total')).toBe('3');
    expect(formatStat(pts, 0.75, 'avg')).toBe('0.8');
    const fg3p = statColumn('fg3p');
    expect(statValue(fg3p, line, 4, 'avg')).toBeCloseTo(33.33, 1);
    expect(formatStat(fg3p, 33.33, 'avg')).toBe('33%');
  });

  it('試投が無い成功率は null で「-」と表示する', () => {
    const ftp = statColumn('ftp');
    expect(statValue(ftp, line, 1, 'total')).toBeNull();
    expect(formatStat(ftp, null, 'total')).toBe('-');
  });
});
