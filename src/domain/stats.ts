import { formatClock, isLineupTracked, onCourtIds } from './lineup';
import {
  activeEvents,
  checkDisqualification,
  compareNumbers,
  computeCoachFouls,
  computePlayerFouls,
  computeScore,
  computeTeamFouls,
  foulNotation,
  isInBonus,
  isLastTwoMinutes,
  periodLabel,
  pointsOf,
  remainingTimeouts,
} from './rules';
import type {
  CoachFouls,
  EventType,
  GameEvent,
  PlayerFouls,
  PlayerStatus,
  RosterEntry,
  Score,
  Side,
} from './types';

/** ランニングスコアの上限（公式様式は160点まで） */
export const RUNNING_SCORE_MAX = 160;

export type ScoreKind = 'FG2' | 'FG3' | 'FT';

export interface RunningScoreEntry {
  /** この得点後の累計点 */
  total: number;
  points: 1 | 2 | 3;
  kind: ScoreKind;
  /** 得点者の背番号（不明なら空文字） */
  number: string;
  period: number;
  /** このピリオドの最後の得点（丸で囲み、下に横線を引く） */
  periodEnd: boolean;
}

export interface RunningScore {
  A: RunningScoreEntry[];
  B: RunningScoreEntry[];
}

const SCORE_KIND: Partial<Record<EventType, ScoreKind>> = {
  FG2_MADE: 'FG2',
  FG3_MADE: 'FG3',
  FT_MADE: 'FT',
};

/**
 * チームごとに、累計点とその点を取った背番号・得点種別・Qの対応表を返す。
 * 描画はこの結果だけを使う（SPEC 6章）。
 */
export function buildRunningScore(
  events: readonly GameEvent[],
  roster: readonly RosterEntry[],
): RunningScore {
  const numberOf = new Map(roster.map((r) => [r.id, r.number]));
  const result: RunningScore = { A: [], B: [] };
  const totals: Score = { A: 0, B: 0 };
  const endedPeriods = new Set<number>();

  for (const e of activeEvents(events)) {
    if (e.type === 'PERIOD_END') {
      endedPeriods.add(e.period);
      continue;
    }
    const kind = SCORE_KIND[e.type];
    if (!kind || e.side === null) continue;
    totals[e.side] += pointsOf(e.type);
    result[e.side].push({
      total: totals[e.side],
      points: pointsOf(e.type) as 1 | 2 | 3,
      kind,
      number: e.rosterId ? (numberOf.get(e.rosterId) ?? '') : '',
      period: e.period,
      periodEnd: false,
    });
  }

  for (const side of ['A', 'B'] as const) {
    const entries = result[side];
    for (let i = 0; i < entries.length; i++) {
      const next = entries[i + 1];
      const isLastOfPeriod = !next || next.period !== entries[i].period;
      if (isLastOfPeriod && endedPeriods.has(entries[i].period)) entries[i].periodEnd = true;
    }
  }
  return result;
}

export interface BoxScoreLine {
  rosterId: string | null;
  number: string;
  name: string;
  pts: number;
  fg2m: number;
  fg2a: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
}

export interface TeamBoxScore {
  players: BoxScoreLine[];
  total: BoxScoreLine;
}

export interface BoxScore {
  A: TeamBoxScore;
  B: TeamBoxScore;
}

function emptyLine(rosterId: string | null, number: string, name: string): BoxScoreLine {
  return {
    rosterId,
    number,
    name,
    pts: 0,
    fg2m: 0,
    fg2a: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
  };
}

function applyEvent(line: BoxScoreLine, e: GameEvent): void {
  switch (e.type) {
    case 'FG2_MADE':
      line.fg2m++;
      line.fg2a++;
      line.pts += 2;
      break;
    case 'FG2_MISS':
      line.fg2a++;
      break;
    case 'FG3_MADE':
      line.fg3m++;
      line.fg3a++;
      line.pts += 3;
      break;
    case 'FG3_MISS':
      line.fg3a++;
      break;
    case 'FT_MADE':
      line.ftm++;
      line.fta++;
      line.pts += 1;
      break;
    case 'FT_MISS':
      line.fta++;
      break;
    case 'OREB':
      line.oreb++;
      line.reb++;
      break;
    case 'DREB':
      line.dreb++;
      line.reb++;
      break;
    case 'AST':
      line.ast++;
      break;
    case 'STL':
      line.stl++;
      break;
    case 'BLK':
      line.blk++;
      break;
    case 'TOV':
      line.tov++;
      break;
    case 'FOUL':
      // PFは選手のファウル（P/T/U/D）のみ
      if (e.rosterId !== null) line.pf++;
      break;
    default:
      break;
  }
}

/** ボックススコア。period を指定するとそのQだけを集計する */
export function buildBoxScore(
  events: readonly GameEvent[],
  roster: readonly RosterEntry[],
  period?: number,
): BoxScore {
  const build = (side: Side): TeamBoxScore => {
    const lines = new Map<string, BoxScoreLine>();
    const sorted = roster
      .filter((r) => r.side === side)
      .sort((a, b) => compareNumbers(a.number, b.number));
    for (const r of sorted) lines.set(r.id, emptyLine(r.id, r.number, r.name));
    const total = emptyLine(null, '', 'TEAM');

    for (const e of events) {
      if (e.voidedAt !== null || e.side !== side) continue;
      if (period !== undefined && e.period !== period) continue;
      const line = e.rosterId ? lines.get(e.rosterId) : undefined;
      if (line) applyEvent(line, e);
      applyEvent(total, e);
    }
    return { players: [...lines.values()], total };
  };
  return { A: build('A'), B: build('B') };
}

export interface PlayerState {
  roster: RosterEntry;
  /** コート上にいるか（交代を管理していないチームは常に false） */
  onCourt: boolean;
  fouls: PlayerFouls;
  status: PlayerStatus;
  points: number;
}

export interface TeamState {
  score: number;
  teamFouls: number;
  inBonus: boolean;
  timeoutsRemaining: number;
  coach: CoachFouls;
  /** 交代を管理しているか（先発が選ばれている、または交代の記録がある） */
  lineupTracked: boolean;
  players: PlayerState[];
}

export interface GameState {
  period: number;
  lastTwoMinutes: boolean;
  A: TeamState;
  B: TeamState;
}

/** 入力画面が必要とする状態を、イベントから一括で導出する（UIでは判定しない） */
export function deriveGameState(
  events: readonly GameEvent[],
  roster: readonly RosterEntry[],
  period: number,
): GameState {
  const score = computeScore(events);
  const pointsByRoster = new Map<string, number>();
  for (const e of events) {
    if (e.voidedAt !== null || e.rosterId === null) continue;
    const pts = pointsOf(e.type);
    if (pts) pointsByRoster.set(e.rosterId, (pointsByRoster.get(e.rosterId) ?? 0) + pts);
  }
  const team = (side: Side): TeamState => {
    const teamFouls = computeTeamFouls(events, side, period);
    const lineupTracked = isLineupTracked(events, roster, side);
    const court = lineupTracked ? onCourtIds(events, roster, side) : new Set<string>();
    return {
      lineupTracked,
      score: score[side],
      teamFouls,
      inBonus: isInBonus(teamFouls),
      timeoutsRemaining: remainingTimeouts(events, side, period),
      coach: computeCoachFouls(events, side),
      players: roster
        .filter((r) => r.side === side)
        .sort((a, b) => compareNumbers(a.number, b.number))
        .map((r) => {
          const fouls = computePlayerFouls(events, r.id);
          return {
            roster: r,
            onCourt: court.has(r.id),
            fouls,
            status: checkDisqualification(fouls),
            points: pointsByRoster.get(r.id) ?? 0,
          };
        }),
    };
  };
  return { period, lastTwoMinutes: isLastTwoMinutes(events), A: team('A'), B: team('B') };
}

export const EVENT_LABELS: Record<EventType, string> = {
  FG2_MADE: '2P○',
  FG2_MISS: '2P×',
  FG3_MADE: '3P○',
  FG3_MISS: '3P×',
  FT_MADE: 'FT○',
  FT_MISS: 'FT×',
  OREB: 'OR',
  DREB: 'DR',
  AST: 'AST',
  STL: 'STL',
  BLK: 'BLK',
  TOV: 'TOV',
  FOUL: 'FOUL',
  TIMEOUT: 'TO',
  PERIOD_END: '終了',
  L2M: '残り2分',
  SUB_IN: 'IN',
  SUB_OUT: 'OUT',
  MARK: '要確認',
};

/** ログ表示用の1行（例：「A #7 3P○」「B ベンチ F(C)」「A チーム TOV」「Q1終了」）。残り時間があれば末尾に付ける */
export function describeEvent(e: GameEvent, roster: readonly RosterEntry[]): string {
  if (e.type === 'PERIOD_END') return `${periodLabel(e.period)}終了`;
  if (e.type === 'L2M') return '残り2分';
  const clock = e.clockSeconds !== null ? ` ${formatClock(e.clockSeconds)}` : '';
  if (e.type === 'MARK') return `要確認の印${clock}`;
  const side = e.side ?? '';
  if (e.type === 'TIMEOUT') return `${side} TO${clock}`;
  // 選手なしの記録は、ファウルならベンチ（C・B）、それ以外はチーム（TOV・リバウンド）
  const who = e.rosterId
    ? `#${roster.find((r) => r.id === e.rosterId)?.number ?? '?'}`
    : e.type === 'FOUL'
      ? 'ベンチ'
      : 'チーム';
  const what =
    e.type === 'FOUL' && e.foulKind
      ? `F(${foulNotation(e.foulKind, e.ftAwarded)})`
      : EVENT_LABELS[e.type];
  return `${side} ${who} ${what}${clock}`;
}

/** 選手を選ばずに記録した「チーム」の行（チームのTO・リバウンド）。合計から選手の分を引いて出す */
export function teamOnlyLine(team: TeamBoxScore): BoxScoreLine {
  const line = emptyLine(null, '', 'チーム');
  const sum = (key: 'oreb' | 'dreb' | 'reb' | 'tov') =>
    team.total[key] - team.players.reduce((n, p) => n + p[key], 0);
  line.oreb = sum('oreb');
  line.dreb = sum('dreb');
  line.reb = sum('reb');
  line.tov = sum('tov');
  return line;
}
