import { ON_COURT_MAX, isLineupTracked, periodSeconds } from './lineup';
import { RULES, activeEvents, periodLabel, pointsOf } from './rules';
import type { GameEvent, RosterEntry, Score, Side } from './types';

/**
 * 時間を使う集計（得点の流れ、時間帯別、連続得点・無得点、5人の組み合わせ）。
 *
 * 時刻は「試合開始からの経過秒」で持つ。時計を使ったピリオド（timed）では記録に付いた残り時間を使い、
 * 使っていないピリオドでは、記録をピリオドの中に等間隔で並べる（順番は正しいが、時刻は目安）。
 * 時刻が要る集計（時間帯別・無得点の時間）は、時計を使ったピリオドだけを対象にする。
 */

export interface TimelineConfig {
  periodMinutes: number;
  otMinutes: number;
  /** 最後のピリオド（試合がどこまで進んだか） */
  currentPeriod: number;
}

export interface TimedEvent {
  event: GameEvent;
  /** 試合開始からの経過秒 */
  t: number;
}

export interface TimelinePeriod {
  period: number;
  /** ピリオド開始時点の経過秒 */
  start: number;
  length: number;
  /** 時計を使ったピリオドか（プレーの記録の大半に残り時間が付いている） */
  timed: boolean;
}

export interface Timeline {
  events: TimedEvent[];
  periods: TimelinePeriod[];
  /** 試合全体の長さ（秒） */
  total: number;
  /** 時計を使ったピリオドが1つでもある */
  hasTime: boolean;
  /** 規定の4ピリオドすべてで時計を使った（時間帯別の集計に使える） */
  regulationTimed: boolean;
  /** 記録のあるピリオドすべてで時計を使った（無得点の時間を出せる） */
  fullyTimed: boolean;
}

const MARKERS: readonly GameEvent['type'][] = ['PERIOD_END', 'L2M', 'MARK'];
const SUBS: readonly GameEvent['type'][] = ['SUB_IN', 'SUB_OUT'];
/** 時計を使ったピリオドとみなす、時刻つきの記録の割合 */
const TIMED_RATIO = 0.7;

function isPlay(e: GameEvent): boolean {
  return !MARKERS.includes(e.type) && !SUBS.includes(e.type);
}

export function buildTimeline(events: readonly GameEvent[], cfg: TimelineConfig): Timeline {
  const active = activeEvents(events).filter((e) => e.type !== 'L2M');
  const maxPeriod = Math.max(RULES.regulationPeriods, cfg.currentPeriod, ...active.map((e) => e.period));
  const periods: TimelinePeriod[] = [];
  let start = 0;
  for (let p = 1; p <= maxPeriod; p++) {
    const length = periodSeconds(p, cfg);
    const plays = active.filter((e) => e.period === p && isPlay(e));
    const stamped = plays.filter((e) => e.clockSeconds !== null).length;
    periods.push({ period: p, start, length, timed: plays.length > 0 && stamped / plays.length >= TIMED_RATIO });
    start += length;
  }

  const timed: TimedEvent[] = [];
  for (const period of periods) {
    const inPeriod = active.filter((e) => e.period === period.period);
    const playCount = inPeriod.filter(isPlay).length;
    let now = period.start;
    let playIndex = 0;
    for (const e of inPeriod) {
      if (e.type === 'PERIOD_END') {
        now = period.start + period.length;
      } else if (e.clockSeconds !== null && (period.timed || !isPlay(e))) {
        // 記録に付いた残り時間。時計を直して時刻が前後しても、並びは記録順を守る
        now = Math.max(now, period.start + period.length - Math.min(period.length, Math.max(0, e.clockSeconds)));
      } else if (!period.timed && isPlay(e)) {
        playIndex++;
        now = Math.max(now, period.start + (period.length * playIndex) / (playCount + 1));
      }
      timed.push({ event: e, t: now });
    }
  }

  const played = periods.filter((p) => active.some((e) => e.period === p.period && isPlay(e)));
  return {
    events: timed,
    periods,
    total: start,
    hasTime: periods.some((p) => p.timed),
    regulationTimed: periods.filter((p) => p.period <= RULES.regulationPeriods).every((p) => p.timed),
    fullyTimed: played.length > 0 && played.every((p) => p.timed),
  };
}

// ------------------------------------------------------------ 得点の流れ

export interface FlowPoint {
  t: number;
  A: number;
  B: number;
}

/** 得点が入るたびの累計。先頭は 0-0、末尾は試合の長さの位置に最終スコアを置く */
export function scoreFlow(tl: Timeline): FlowPoint[] {
  const points: FlowPoint[] = [{ t: 0, A: 0, B: 0 }];
  const score: Score = { A: 0, B: 0 };
  for (const { event: e, t } of tl.events) {
    const pts = pointsOf(e.type);
    if (!pts || e.side === null) continue;
    score[e.side] += pts;
    points.push({ t, A: score.A, B: score.B });
  }
  points.push({ t: tl.total, A: score.A, B: score.B });
  return points;
}

// ------------------------------------------------------------ 時間帯別

export interface TimeBand {
  key: string;
  label: string;
  /** 時計を使っていないピリオドでは、前半・後半に分けられないので null */
  score: Score | null;
}

/** 第4Qの終盤として別に数える時間（秒） */
export const CLUTCH_SECONDS = 120;

/**
 * 時間帯別の得点。各ピリオドを前半・後半に分け、第4Qは残り2分も別に出す（後半の内数）。延長は1本ずつ。
 * 時計を使っていないピリオドの行は score が null になる。
 */
export function timeBands(tl: Timeline): TimeBand[] {
  const bands: TimeBand[] = [];
  for (const p of tl.periods) {
    const scoring = tl.events.filter((x) => x.event.period === p.period && x.event.side !== null && pointsOf(x.event.type) > 0);
    const sum = (from: number, to: number, includeEnd: boolean): Score | null => {
      if (!p.timed) return null;
      const s: Score = { A: 0, B: 0 };
      for (const { event, t } of scoring) {
        const at = t - p.start;
        if (at >= from && (at < to || (includeEnd && at <= to))) s[event.side as Side] += pointsOf(event.type);
      }
      return s;
    };
    const label = periodLabel(p.period);
    if (p.period > RULES.regulationPeriods) {
      bands.push({ key: `p${p.period}`, label, score: sum(0, p.length, true) });
      continue;
    }
    const half = p.length / 2;
    bands.push({ key: `p${p.period}a`, label: `${label} 前半`, score: sum(0, half, false) });
    bands.push({ key: `p${p.period}b`, label: `${label} 後半`, score: sum(half, p.length, true) });
    if (p.period === RULES.regulationPeriods) {
      bands.push({ key: 'clutch', label: `${label} 残り2分`, score: sum(p.length - CLUTCH_SECONDS, p.length, true) });
    }
  }
  return bands;
}

// ------------------------------------------------------------ 連続得点・無得点

export interface ScoringRun {
  side: Side;
  /** 相手に得点を許さずに取った点 */
  points: number;
  fromT: number;
  toT: number;
  fromPeriod: number;
  toPeriod: number;
  /** この連続得点が始まる前のスコア */
  before: Score;
  after: Score;
}

/** チームごとの、いちばん大きい連続得点（同じ点数なら先に起きたもの）。得点が無ければ null */
export function longestRuns(tl: Timeline): Record<Side, ScoringRun | null> {
  const best: Record<Side, ScoringRun | null> = { A: null, B: null };
  const score: Score = { A: 0, B: 0 };
  let run: ScoringRun | null = null;
  for (const { event: e, t } of tl.events) {
    const pts = pointsOf(e.type);
    if (!pts || e.side === null) continue;
    if (!run || run.side !== e.side) {
      run = { side: e.side, points: 0, fromT: t, toT: t, fromPeriod: e.period, toPeriod: e.period, before: { ...score }, after: { ...score } };
    }
    score[e.side] += pts;
    run.points += pts;
    run.toT = t;
    run.toPeriod = e.period;
    run.after = { ...score };
    const cur = best[e.side];
    if (!cur || run.points > cur.points) best[e.side] = { ...run };
  }
  return best;
}

export interface Drought {
  side: Side;
  /** 得点が無かった長さ（秒） */
  seconds: number;
  fromT: number;
  toT: number;
}

/**
 * チームごとの、いちばん長い無得点の時間。試合開始から最初の得点まで、最後の得点から試合終了までも含む。
 * 時刻が要るので、記録のあるピリオドすべてで時計を使った試合だけで出す（それ以外は null）。
 */
export function longestDroughts(tl: Timeline): Record<Side, Drought | null> {
  const result: Record<Side, Drought | null> = { A: null, B: null };
  if (!tl.fullyTimed) return result;
  // 記録のある最後のピリオドの終わりまでを試合の長さとする
  const lastPeriod = Math.max(...tl.events.map((x) => x.event.period));
  const end = tl.periods.find((p) => p.period === lastPeriod);
  const total = end ? end.start + end.length : tl.total;
  for (const side of ['A', 'B'] as const) {
    let last = 0;
    const consider = (to: number) => {
      const cur = result[side];
      if (!cur || to - last > cur.seconds) result[side] = { side, seconds: to - last, fromT: last, toT: to };
    };
    for (const { event: e, t } of tl.events) {
      if (e.side !== side || !pointsOf(e.type)) continue;
      consider(t);
      last = t;
    }
    consider(total);
  }
  return result;
}

// ------------------------------------------------------------ 5人の組み合わせ

export interface UnitStat {
  /** コート上の選手（出場登録のID）を並べたもの */
  rosterIds: string[];
  seconds: number;
  /** 出ている間の得点・失点 */
  pointsFor: number;
  pointsAgainst: number;
}

export interface UnitStats {
  units: UnitStat[];
  /** 時刻なしの交代があり、時間が概算になっている */
  approximate: boolean;
}

/**
 * コート上の組み合わせごとの、出場時間と得失点。先発と交代を記録しているチームだけ（それ以外は null）。
 * 時刻の扱いは出場時間（computeLineupStats）と同じ：交代に付いた残り時間を使い、無ければ直前に分かっている時刻を使う。
 * 5人そろっていない時間（退場で4人など）も、その人数の組み合わせとして数える。
 */
export function computeUnitStats(
  events: readonly GameEvent[],
  roster: readonly RosterEntry[],
  cfg: TimelineConfig & { finished: boolean },
  side: Side,
): UnitStats | null {
  if (!isLineupTracked(events, roster, side)) return null;
  const order = new Map(roster.map((r, i) => [r.id, i]));
  const units = new Map<string, UnitStat>();
  const court = new Set(roster.filter((r) => r.side === side && r.isStarter).map((r) => r.id));
  let approximate = false;

  const periodStart = (period: number) => {
    let t = 0;
    for (let p = 1; p < period; p++) t += periodSeconds(p, cfg);
    return t;
  };
  const current = (): UnitStat => {
    const ids = [...court].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const key = ids.join('|');
    let unit = units.get(key);
    if (!unit) {
      unit = { rosterIds: ids, seconds: 0, pointsFor: 0, pointsAgainst: 0 };
      units.set(key, unit);
    }
    return unit;
  };

  let now = 0;
  let since = 0;
  for (const e of activeEvents(events)) {
    const start = periodStart(e.period);
    if (now < start) now = start;
    if (e.type === 'PERIOD_END') {
      now = Math.max(now, start + periodSeconds(e.period, cfg));
      continue;
    }
    if ((e.type === 'SUB_IN' || e.type === 'SUB_OUT') && e.side === side && e.rosterId !== null) {
      if (e.clockSeconds !== null) now = Math.max(now, start + periodSeconds(e.period, cfg) - e.clockSeconds);
      else if (now !== start) approximate = true;
      // 入れ替わる前の組み合わせに、ここまでの時間を足す
      if (court.size > 0) current().seconds += now - since;
      since = now;
      if (e.type === 'SUB_IN') court.add(e.rosterId);
      else court.delete(e.rosterId);
      continue;
    }
    const pts = pointsOf(e.type);
    if (pts && e.side && court.size > 0) {
      const unit = current();
      if (e.side === side) unit.pointsFor += pts;
      else unit.pointsAgainst += pts;
    }
  }
  const end = cfg.finished ? periodStart(cfg.currentPeriod) + periodSeconds(cfg.currentPeriod, cfg) : now;
  if (court.size > 0) current().seconds += Math.max(0, end - since);

  return {
    // 交代の途中にできる、時間も得点も無い組み合わせは捨てる
    units: [...units.values()]
      .filter((u) => u.rosterIds.length <= ON_COURT_MAX && (u.seconds > 0 || u.pointsFor > 0 || u.pointsAgainst > 0))
      .sort((a, b) => b.seconds - a.seconds || b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst)),
    approximate,
  };
}
