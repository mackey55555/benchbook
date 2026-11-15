import { RULES, activeEvents, pointsOf } from './rules';
import type { GameEvent, RosterEntry, Side } from './types';

/** コート上の人数の上限 */
export const ON_COURT_MAX = 5;

/** 交代を管理しているチームか（先発が選ばれている、または交代の記録がある） */
export function isLineupTracked(
  events: readonly GameEvent[],
  roster: readonly RosterEntry[],
  side: Side,
): boolean {
  return (
    roster.some((r) => r.side === side && r.isStarter) ||
    events.some(
      (e) =>
        e.voidedAt === null && e.side === side && (e.type === 'SUB_IN' || e.type === 'SUB_OUT'),
    )
  );
}

/** 現在コート上にいる選手。先発から始めて、交代を記録順に適用する */
export function onCourtIds(
  events: readonly GameEvent[],
  roster: readonly RosterEntry[],
  side: Side,
): Set<string> {
  const court = new Set(roster.filter((r) => r.side === side && r.isStarter).map((r) => r.id));
  for (const e of activeEvents(events)) {
    if (e.side !== side || e.rosterId === null) continue;
    if (e.type === 'SUB_IN') court.add(e.rosterId);
    else if (e.type === 'SUB_OUT') court.delete(e.rosterId);
  }
  return court;
}

export interface LineupConfig {
  periodMinutes: number;
  otMinutes: number;
  currentPeriod: number;
  finished: boolean;
}

export interface LineupStat {
  /** 出場時間（秒） */
  seconds: number;
  /** 時刻なしの交代を含むため、出場時間が概算になっている */
  approximate: boolean;
  /** 出場中のチーム得失点差 */
  plusMinus: number;
}

export function periodSeconds(period: number, cfg: Pick<LineupConfig, 'periodMinutes' | 'otMinutes'>): number {
  return (period <= RULES.regulationPeriods ? cfg.periodMinutes : cfg.otMinutes) * 60;
}

/**
 * 選手ごとの出場時間と +/-。交代を管理しているチームの選手だけを返す。
 *
 * 時刻は「試合開始からの経過秒」に直して計算する。
 * - 時刻（残り時間）付きの交代：その時刻を使う
 * - 時刻なしの交代：直前に分かっている時刻（ピリオド開始・終了、前の時刻付き交代）を使う。
 *   ピリオドの切れ目での交代は正確、プレー中の交代は概算（approximate）になる
 * 進行中の試合は、最後に時刻が分かっている時点までを数える。
 */
export function computeLineupStats(
  events: readonly GameEvent[],
  roster: readonly RosterEntry[],
  cfg: LineupConfig,
): Map<string, LineupStat> {
  const stats = new Map<string, LineupStat>();
  const sideOf = new Map(roster.map((r) => [r.id, r.side]));
  const tracked: Record<Side, boolean> = {
    A: isLineupTracked(events, roster, 'A'),
    B: isLineupTracked(events, roster, 'B'),
  };
  for (const r of roster) {
    if (tracked[r.side]) stats.set(r.id, { seconds: 0, approximate: false, plusMinus: 0 });
  }

  const periodStart = (period: number) => {
    let t = 0;
    for (let p = 1; p < period; p++) t += periodSeconds(p, cfg);
    return t;
  };

  /** コート上の選手 → 入った時刻（経過秒） */
  const since = new Map<string, number>();
  for (const r of roster) {
    if (tracked[r.side] && r.isStarter) since.set(r.id, 0);
  }

  let now = 0;
  for (const e of activeEvents(events)) {
    const start = periodStart(e.period);
    if (now < start) now = start;
    if (e.type === 'PERIOD_END') {
      now = Math.max(now, start + periodSeconds(e.period, cfg));
      continue;
    }
    if ((e.type === 'SUB_IN' || e.type === 'SUB_OUT') && e.rosterId !== null) {
      const stat = stats.get(e.rosterId);
      if (!stat) continue;
      if (e.clockSeconds !== null) {
        now = Math.max(now, start + periodSeconds(e.period, cfg) - e.clockSeconds);
      } else if (now !== start) {
        stat.approximate = true;
      }
      if (e.type === 'SUB_IN') {
        if (!since.has(e.rosterId)) since.set(e.rosterId, now);
      } else {
        const entered = since.get(e.rosterId);
        if (entered !== undefined) {
          stat.seconds += now - entered;
          since.delete(e.rosterId);
        }
      }
      continue;
    }
    const pts = pointsOf(e.type);
    if (pts && e.side) {
      for (const id of since.keys()) {
        const stat = stats.get(id);
        if (stat) stat.plusMinus += sideOf.get(id) === e.side ? pts : -pts;
      }
    }
  }

  const end = cfg.finished
    ? periodStart(cfg.currentPeriod) + periodSeconds(cfg.currentPeriod, cfg)
    : now;
  for (const [id, entered] of since) {
    const stat = stats.get(id);
    if (stat) stat.seconds += Math.max(0, end - entered);
  }
  return stats;
}

/** 残り時間の表記（秒 → "6:32"） */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * テンキー入力（"632" → 6分32秒）を秒にする。空文字は null（時刻なし）。
 * 秒が60以上、またはピリオドの長さを超える値は undefined（入力エラー）。
 */
export function parseClockDigits(digits: string, maxSeconds: number): number | null | undefined {
  if (digits === '') return null;
  if (!/^\d{1,4}$/.test(digits)) return undefined;
  const sec = Number(digits.slice(-2));
  const min = Number(digits.slice(0, -2) || '0');
  if (sec >= 60) return undefined;
  const total = min * 60 + sec;
  return total <= maxSeconds ? total : undefined;
}

/** テンキー入力の表示用（"632" → "6:32"、"" → "--:--"） */
export function clockDigitsLabel(digits: string): string {
  if (digits === '') return '--:--';
  const padded = digits.padStart(3, '0');
  return `${Number(padded.slice(0, -2))}:${padded.slice(-2)}`;
}
