import { computeLineupStats, formatClock } from './lineup';
import { RULES, computeScore } from './rules';
import { buildBoxScore, type BoxScoreLine } from './stats';
import type { GameEvent, GameStatus, RosterEntry, Score, Side } from './types';

export type GameResult = 'win' | 'lose' | 'draw';

/** 自チーム（ownSide）から見た勝敗 */
export function gameResult(ownSide: Side, score: Score): GameResult {
  const own = score[ownSide];
  const opp = score[ownSide === 'A' ? 'B' : 'A'];
  return own > opp ? 'win' : own < opp ? 'lose' : 'draw';
}

export type DateRange = 'all' | 'month' | '3months' | 'fiscal';

export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: 'すべて',
  month: '今月',
  '3months': '3か月',
  fiscal: '今年度',
};

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * 期間の開始日（YYYY-MM-DD、この日を含む）。'all' は null。
 * today も YYYY-MM-DD。年度は4月始まり。
 */
export function rangeStart(range: DateRange, today: string): string | null {
  if (range === 'all') return null;
  const [y, m, d] = today.split('-').map(Number);
  if (range === 'month') return ymd(y, m, 1);
  if (range === 'fiscal') return ymd(m >= 4 ? y : y - 1, 4, 1);
  // 3か月前の同じ日。存在しない日（5/31 → 2/31 など）はその月の末日に寄せる
  const total = y * 12 + (m - 1) - 3;
  const sy = Math.floor(total / 12);
  const sm = (total % 12) + 1;
  const lastDay = new Date(sy, sm, 0).getDate();
  return ymd(sy, sm, Math.min(d, lastDay));
}

export interface GameFilter {
  range: DateRange;
  /** 勝敗で絞ると、終了した試合だけが残る */
  result: 'all' | GameResult;
  /** チーム名・大会名・会場の部分一致（空なら絞らない） */
  query: string;
}

export const NO_FILTER: GameFilter = { range: 'all', result: 'all', query: '' };

interface FilterableGame {
  game: {
    date: string;
    status: GameStatus;
    ownSide: Side;
    teamAName: string;
    teamBName: string;
    leagueName: string;
    venue: string;
  };
  score: Score;
}

export function filterGames<T extends FilterableGame>(rows: readonly T[], filter: GameFilter, today: string): T[] {
  const start = rangeStart(filter.range, today);
  const query = filter.query.trim().toLowerCase();
  return rows.filter(({ game, score }) => {
    if (start !== null && game.date < start) return false;
    if (filter.result !== 'all') {
      if (game.status !== 'finished') return false;
      if (gameResult(game.ownSide, score) !== filter.result) return false;
    }
    if (query) {
      const haystack = [game.teamAName, game.teamBName, game.leagueName, game.venue].join('\n').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- チーム分析

/**
 * 分析で扱う1行。ボックススコアの項目に、出場時間と +/- を足したもの。
 * 出場時間と +/- は、先発と交代を記録した試合の分だけが入る（lineupGames がその試合数）。
 * チーム合計の行には入らない。
 */
export interface StatLine extends BoxScoreLine {
  seconds?: number;
  plusMinus?: number;
  lineupGames?: number;
  /** 時刻なしの交代を含み、出場時間が概算になっている */
  approximate?: boolean;
}

export interface AnalysisGame {
  game: {
    id: string;
    date: string;
    ownSide: Side;
    teamAName: string;
    teamBName: string;
    /** 省いたときは10分・5分・第4Qまでとして出場時間を計算する */
    periodMinutes?: number;
    otMinutes?: number;
    currentPeriod?: number;
  };
  roster: readonly RosterEntry[];
  events: readonly GameEvent[];
}

export interface GameTrendPoint {
  id: string;
  date: string;
  opponent: string;
  own: number;
  opp: number;
  result: GameResult;
  /** その試合のチーム合計 */
  ownLine: BoxScoreLine;
  oppLine: BoxScoreLine;
}

/** 選手の1試合分の成績 */
export interface PlayerGameLog {
  gameId: string;
  date: string;
  opponent: string;
  result: GameResult;
  line: StatLine;
}

export interface PlayerAnalysis {
  key: string;
  number: string;
  name: string;
  /** 出場登録された試合数 */
  games: number;
  /** 期間の合計 */
  line: StatLine;
  /** 古い順 */
  log: PlayerGameLog[];
}

export interface TeamAnalysis {
  /** 自チームの名前（いちばん新しい試合での名前） */
  teamName: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** 古い順 */
  trend: GameTrendPoint[];
  /** 第1〜4Qの1試合平均得点 */
  periods: { period: number; own: number; opp: number }[];
  /** 全試合の合計 */
  own: BoxScoreLine;
  opp: BoxScoreLine;
  players: PlayerAnalysis[];
}

const LINE_KEYS = [
  'pts',
  'fg2m',
  'fg2a',
  'fg3m',
  'fg3a',
  'ftm',
  'fta',
  'oreb',
  'dreb',
  'reb',
  'ast',
  'stl',
  'blk',
  'tov',
  'pf',
] as const satisfies readonly (keyof BoxScoreLine)[];

function zeroLine(number = '', name = ''): StatLine {
  const line = { rosterId: null, number, name } as StatLine;
  for (const k of LINE_KEYS) line[k] = 0;
  return line;
}

function addLine(into: BoxScoreLine, from: BoxScoreLine): void {
  for (const k of LINE_KEYS) into[k] += from[k];
}

/** 成功率（0〜100）。試投が0なら null */
export function pct(made: number, attempts: number): number | null {
  return attempts > 0 ? (made / attempts) * 100 : null;
}

/** 1試合平均。試合が0なら0 */
export function perGame(total: number, games: number): number {
  return games > 0 ? total / games : 0;
}

/**
 * 終了した試合を自チームの視点で集計する。
 * 選手は選手マスタ（playerId）で同一人物とみなし、マスタに無い選手は背番号と氏名で束ねる。
 */
export function analyzeTeam(games: readonly AnalysisGame[]): TeamAnalysis {
  const sorted = [...games].sort((a, b) => (a.game.date < b.game.date ? -1 : a.game.date > b.game.date ? 1 : 0));
  const result: TeamAnalysis = {
    teamName: '',
    games: sorted.length,
    wins: 0,
    losses: 0,
    draws: 0,
    trend: [],
    periods: [],
    own: zeroLine('', 'TEAM'),
    opp: zeroLine('', 'TEAM'),
    players: [],
  };
  const periodTotals = Array.from({ length: RULES.regulationPeriods }, () => ({ own: 0, opp: 0 }));
  const players = new Map<string, PlayerAnalysis>();

  for (const { game, roster, events } of sorted) {
    const ownSide = game.ownSide;
    const oppSide: Side = ownSide === 'A' ? 'B' : 'A';
    const score = computeScore(events);
    const outcome = gameResult(ownSide, score);
    if (outcome === 'win') result.wins++;
    else if (outcome === 'lose') result.losses++;
    else result.draws++;
    result.teamName = (ownSide === 'A' ? game.teamAName : game.teamBName) || result.teamName;
    const opponent = (oppSide === 'A' ? game.teamAName : game.teamBName) || '相手';
    const box = buildBoxScore(events, roster);
    result.trend.push({
      id: game.id,
      date: game.date,
      opponent,
      ownLine: box[ownSide].total,
      oppLine: box[oppSide].total,
      own: score[ownSide],
      opp: score[oppSide],
      result: outcome,
    });
    periodTotals.forEach((t, i) => {
      const s = computeScore(events, i + 1);
      t.own += s[ownSide];
      t.opp += s[oppSide];
    });

    addLine(result.own, box[ownSide].total);
    addLine(result.opp, box[oppSide].total);
    const playerIdOf = new Map(roster.map((r) => [r.id, r.playerId]));
    // 出場時間と +/-。先発と交代を記録していないチームの選手は含まれない
    const lineup = computeLineupStats(events, roster, {
      periodMinutes: game.periodMinutes ?? 10,
      otMinutes: game.otMinutes ?? 5,
      currentPeriod: game.currentPeriod ?? RULES.regulationPeriods,
      finished: true,
    });
    for (const line of box[ownSide].players) {
      const playerId = line.rosterId ? playerIdOf.get(line.rosterId) : null;
      const key = playerId ?? `${line.number}\n${line.name}`;
      let p = players.get(key);
      if (!p) {
        p = { key, number: line.number, name: line.name, games: 0, line: zeroLine(line.number, line.name), log: [] };
        players.set(key, p);
      }
      // 背番号・氏名は新しい試合のものを使う
      p.number = line.number;
      if (line.name) p.name = line.name;
      p.games++;
      addLine(p.line, line);
      const stat = line.rosterId ? lineup.get(line.rosterId) : undefined;
      const gameLine: StatLine = stat
        ? { ...line, seconds: stat.seconds, plusMinus: stat.plusMinus, lineupGames: 1, approximate: stat.approximate }
        : line;
      if (stat) {
        p.line.seconds = (p.line.seconds ?? 0) + stat.seconds;
        p.line.plusMinus = (p.line.plusMinus ?? 0) + stat.plusMinus;
        p.line.lineupGames = (p.line.lineupGames ?? 0) + 1;
        p.line.approximate = p.line.approximate || stat.approximate;
      }
      p.log.push({ gameId: game.id, date: game.date, opponent, result: outcome, line: gameLine });
    }
  }

  result.periods = periodTotals.map((t, i) => ({
    period: i + 1,
    own: perGame(t.own, sorted.length),
    opp: perGame(t.opp, sorted.length),
  }));
  result.players = [...players.values()];
  return result;
}

// ---------------------------------------------------------------- 成績の項目

export type StatMode = 'total' | 'avg';

export interface StatColumn {
  key: string;
  /** 表の見出し（短い表記） */
  label: string;
  /** 日本語の名前 */
  name: string;
  /**
   * count は合計と1試合平均を出せる。pct は成功率（0〜100）で、平均にしない。
   * time（出場時間・秒）と pm（+/-）は、先発と交代を記録した試合の分だけを集計し、平均もその試合数で割る
   */
  kind: 'count' | 'pct' | 'time' | 'pm';
  get: (line: StatLine) => number | null;
}

const count = (key: (typeof LINE_KEYS)[number], label: string, name: string): StatColumn => ({
  key,
  label,
  name,
  kind: 'count',
  get: (l) => l[key],
});
const rate = (
  key: string,
  label: string,
  name: string,
  made: (typeof LINE_KEYS)[number],
  att: (typeof LINE_KEYS)[number],
): StatColumn => ({ key, label, name, kind: 'pct', get: (l) => pct(l[made], l[att]) });

/** チーム合計にも出せる成績の項目（表の列順） */
export const TEAM_STAT_COLUMNS: readonly StatColumn[] = [
  count('pts', 'PTS', '得点'),
  count('fg2m', '2PM', '2P成功'),
  count('fg2a', '2PA', '2P試投'),
  rate('fg2p', '2P%', '2P成功率', 'fg2m', 'fg2a'),
  count('fg3m', '3PM', '3P成功'),
  count('fg3a', '3PA', '3P試投'),
  rate('fg3p', '3P%', '3P成功率', 'fg3m', 'fg3a'),
  count('ftm', 'FTM', 'FT成功'),
  count('fta', 'FTA', 'FT試投'),
  rate('ftp', 'FT%', 'FT成功率', 'ftm', 'fta'),
  count('oreb', 'OR', 'OFリバウンド'),
  count('dreb', 'DR', 'DFリバウンド'),
  count('reb', 'REB', 'リバウンド'),
  count('ast', 'AST', 'アシスト'),
  count('stl', 'STL', 'スティール'),
  count('blk', 'BLK', 'ブロック'),
  count('tov', 'TO', 'ターンオーバー'),
  count('pf', 'PF', 'ファウル'),
];

const lineupValue = (key: 'seconds' | 'plusMinus') => (l: StatLine) => (l.lineupGames ? (l[key] ?? 0) : null);

/** 選手の成績の項目。チームの項目に、出場時間と +/- を足したもの */
export const STAT_COLUMNS: readonly StatColumn[] = [
  TEAM_STAT_COLUMNS[0],
  { key: 'min', label: 'MIN', name: '出場時間', kind: 'time', get: lineupValue('seconds') },
  { key: 'pm', label: '+/-', name: '+/-', kind: 'pm', get: lineupValue('plusMinus') },
  ...TEAM_STAT_COLUMNS.slice(1),
];

export function statColumn(key: string): StatColumn {
  return STAT_COLUMNS.find((c) => c.key === key) ?? STAT_COLUMNS[0];
}

/** 項目の値。count は mode に応じて合計か1試合平均、pct は成功率（試投なしは null）。time と pm は記録のある試合が無ければ null */
export function statValue(col: StatColumn, line: StatLine, games: number, mode: StatMode): number | null {
  const v = col.get(line);
  if (v === null || col.kind === 'pct' || mode === 'total') return v;
  if (col.kind === 'time' || col.kind === 'pm') return perGame(v, line.lineupGames ?? 0);
  return perGame(v, games);
}

export function formatStat(col: StatColumn, value: number | null, mode: StatMode): string {
  if (value === null) return '-';
  if (col.kind === 'pct') return `${Math.round(value)}%`;
  if (col.kind === 'time') return formatClock(value);
  if (col.kind === 'pm') {
    const text = mode === 'total' ? String(value) : value.toFixed(1);
    return value > 0 ? `+${text}` : text;
  }
  return mode === 'total' ? String(value) : value.toFixed(1);
}

// ---------------------------------------------------------------- 選手別の修正表

/** 修正表で増減できる項目（得点とファウル） */
export const FIX_STATS = ['FG2_MADE', 'FG3_MADE', 'FT_MADE', 'FOUL'] as const;
export type FixStat = (typeof FIX_STATS)[number];

export const FIX_STAT_LABELS: Record<FixStat, string> = {
  FG2_MADE: '2P',
  FG3_MADE: '3P',
  FT_MADE: 'FT',
  FOUL: 'F',
};

/** 指定ピリオドの、選手ごとの成功数とファウル数（rosterId → 項目 → 件数） */
export function countFixStats(events: readonly GameEvent[], period: number): Map<string, Record<FixStat, number>> {
  const counts = new Map<string, Record<FixStat, number>>();
  for (const e of events) {
    if (e.voidedAt !== null || e.period !== period || e.rosterId === null) continue;
    if (!(FIX_STATS as readonly string[]).includes(e.type)) continue;
    let row = counts.get(e.rosterId);
    if (!row) {
      row = { FG2_MADE: 0, FG3_MADE: 0, FT_MADE: 0, FOUL: 0 };
      counts.set(e.rosterId, row);
    }
    row[e.type as FixStat]++;
  }
  return counts;
}
