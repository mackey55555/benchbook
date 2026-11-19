import { periodSeconds, type LineupConfig } from './lineup';

/**
 * 試合の時計。会場の時計に合わせて、手元で動かす・止める・直すためのもの（公式の計時ではない）。
 * 動いている間は端末の時刻との差で残り時間を出すので、アプリを閉じていても進む。
 */
export interface ClockState {
  /** 時計を使っているピリオド */
  clockPeriod: number | null;
  /** 最後に止めた（または動かし始めた）時点の残り時間（ミリ秒） */
  clockRemainingMs: number | null;
  /** 動いているときの開始時刻（ミリ秒）。止まっていれば null */
  clockStartedAt: number | null;
}

type PeriodConfig = Pick<LineupConfig, 'periodMinutes' | 'otMinutes'>;

/** そのピリオドで時計を使っているか（一度でも動かした、または時間を直した） */
export function isClockUsed(state: ClockState, period: number): boolean {
  return state.clockPeriod === period && state.clockRemainingMs !== null;
}

export function isClockRunning(state: ClockState, period: number): boolean {
  return isClockUsed(state, period) && state.clockStartedAt !== null;
}

/** 残り時間（ミリ秒）。そのピリオドで未使用なら、ピリオドの長さを返す */
export function clockRemainingMs(state: ClockState, period: number, cfg: PeriodConfig, now: number): number {
  const full = periodSeconds(period, cfg) * 1000;
  if (!isClockUsed(state, period)) return full;
  const base = Math.min(full, Math.max(0, state.clockRemainingMs ?? full));
  if (state.clockStartedAt === null) return base;
  return Math.max(0, base - Math.max(0, now - state.clockStartedAt));
}

/** 表示と記録に使う残り秒。端数は切り上げる（10:00 から始まり、0:00 は終了時だけ） */
export function clockSeconds(state: ClockState, period: number, cfg: PeriodConfig, now: number): number {
  return Math.ceil(clockRemainingMs(state, period, cfg, now) / 1000);
}

/** 記録に付ける残り秒。そのピリオドで時計を使っていなければ null（時刻なし） */
export function clockStamp(state: ClockState, period: number, cfg: PeriodConfig, now: number): number | null {
  return isClockUsed(state, period) ? clockSeconds(state, period, cfg, now) : null;
}

/** 残り秒を、時間を直すテンキーの初期値にする（392 → "632"） */
export function clockToDigits(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}${String(s % 60).padStart(2, '0')}`.replace(/^0+(?=\d)/, '');
}
