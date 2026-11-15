import {
  clockDigitsLabel,
  computeLineupStats,
  formatClock,
  isLineupTracked,
  onCourtIds,
  parseClockDigits,
} from '../lineup';
import { deriveGameState } from '../stats';
import type { RosterEntry } from '../types';
import { ev, resetSeq, roster } from './helpers';

beforeEach(resetSeq);

const cfg = { periodMinutes: 10, otMinutes: 5, currentPeriod: 1, finished: false };

/** A: 4〜8 が先発、9・10 が控え。B は先発なし（交代を管理しない） */
function players(): RosterEntry[] {
  const a = roster('A', ['4', '5', '6', '7', '8', '9', '10']).map((r, i) => ({ ...r, isStarter: i < 5 }));
  return [...a, ...roster('B', ['20', '21'])];
}
const sub = (type: 'SUB_IN' | 'SUB_OUT', id: string, period: number, clockSeconds: number | null) =>
  ev(type, 'A', id, period, { clockSeconds });

describe('コート上の選手', () => {
  it('先発が選ばれているチームだけ交代を管理する', () => {
    expect(isLineupTracked([], players(), 'A')).toBe(true);
    expect(isLineupTracked([], players(), 'B')).toBe(false);
    expect(isLineupTracked([ev('SUB_IN', 'B', 'B20')], players(), 'B')).toBe(true);
  });

  it('先発から始め、交代を記録順に適用する。取消済みは無視する', () => {
    const events = [
      sub('SUB_OUT', 'A4', 1, 300),
      sub('SUB_IN', 'A9', 1, 300),
      { ...sub('SUB_OUT', 'A5', 1, 200), voidedAt: 1 },
    ];
    expect([...onCourtIds(events, players(), 'A')].sort()).toEqual(['A5', 'A6', 'A7', 'A8', 'A9']);
  });

  it('deriveGameState に onCourt と lineupTracked が入る', () => {
    const state = deriveGameState([sub('SUB_OUT', 'A4', 1, 300), sub('SUB_IN', 'A9', 1, 300)], players(), 1);
    expect(state.A.lineupTracked).toBe(true);
    expect(state.B.lineupTracked).toBe(false);
    const on = (n: string) => state.A.players.find((p) => p.roster.number === n)?.onCourt;
    expect([on('4'), on('5'), on('9'), on('10')]).toEqual([false, true, true, false]);
    expect(state.B.players.every((p) => !p.onCourt)).toBe(true);
  });
});

describe('出場時間', () => {
  it('残り時間付きの交代から正確に出す（Q1残り6:00で交代 → 4分と6分）', () => {
    const events = [
      sub('SUB_OUT', 'A4', 1, 360),
      sub('SUB_IN', 'A9', 1, 360),
      ev('PERIOD_END', null, null, 1),
    ];
    const stats = computeLineupStats(events, players(), cfg);
    expect(stats.get('A4')).toMatchObject({ seconds: 240, approximate: false });
    expect(stats.get('A9')).toMatchObject({ seconds: 360, approximate: false });
    expect(stats.get('A5')).toMatchObject({ seconds: 600, approximate: false });
    expect(stats.get('A10')).toMatchObject({ seconds: 0 });
  });

  it('交代を管理していないチームの選手は返さない', () => {
    expect(computeLineupStats([], players(), cfg).has('B20')).toBe(false);
  });

  it('ピリオドの切れ目での時刻なし交代は正確に数える', () => {
    const events = [
      ev('PERIOD_END', null, null, 1),
      sub('SUB_OUT', 'A4', 2, null),
      sub('SUB_IN', 'A9', 2, null),
      ev('PERIOD_END', null, null, 2),
    ];
    const stats = computeLineupStats(events, players(), { ...cfg, currentPeriod: 2 });
    expect(stats.get('A4')).toMatchObject({ seconds: 600, approximate: false });
    expect(stats.get('A9')).toMatchObject({ seconds: 600, approximate: false });
    expect(stats.get('A5')).toMatchObject({ seconds: 1200, approximate: false });
  });

  it('プレー中の時刻なし交代は直前に分かっている時刻で数え、概算の印を付ける', () => {
    const events = [
      sub('SUB_OUT', 'A4', 1, 360),
      sub('SUB_IN', 'A9', 1, 360),
      sub('SUB_OUT', 'A5', 1, null),
      sub('SUB_IN', 'A10', 1, null),
      ev('PERIOD_END', null, null, 1),
    ];
    const stats = computeLineupStats(events, players(), cfg);
    expect(stats.get('A5')).toMatchObject({ seconds: 240, approximate: true });
    expect(stats.get('A10')).toMatchObject({ seconds: 360, approximate: true });
    expect(stats.get('A4')?.approximate).toBe(false);
  });

  it('終了した試合は最終ピリオドの終わりまで数える（延長5分を含む）', () => {
    const events = [1, 2, 3, 4].map((p) => ev('PERIOD_END', null, null, p));
    events.push(sub('SUB_OUT', 'A4', 5, 120), sub('SUB_IN', 'A9', 5, 120), ev('PERIOD_END', null, null, 5));
    const stats = computeLineupStats(events, players(), { ...cfg, currentPeriod: 5, finished: true });
    expect(stats.get('A5')?.seconds).toBe(40 * 60 + 5 * 60);
    expect(stats.get('A4')?.seconds).toBe(40 * 60 + 180);
    expect(stats.get('A9')?.seconds).toBe(120);
  });

  it('進行中の試合は最後に時刻が分かっている時点までを数える', () => {
    const events = [sub('SUB_OUT', 'A4', 1, 360), sub('SUB_IN', 'A9', 1, 360)];
    const stats = computeLineupStats(events, players(), cfg);
    expect(stats.get('A5')?.seconds).toBe(240);
    expect(stats.get('A9')?.seconds).toBe(0);
  });

  it('Q時間の設定を反映する', () => {
    const stats = computeLineupStats([ev('PERIOD_END', null, null, 1)], players(), { ...cfg, periodMinutes: 8 });
    expect(stats.get('A4')?.seconds).toBe(480);
  });
});

describe('+/-', () => {
  it('出場中の得点・失点を数える', () => {
    const events = [
      ev('FG3_MADE', 'A', 'A4', 1),
      ev('FG2_MADE', 'B', 'B20', 1),
      sub('SUB_OUT', 'A4', 1, 300),
      sub('SUB_IN', 'A9', 1, 300),
      ev('FG2_MADE', 'B', 'B20', 1),
      ev('FT_MADE', 'A', 'A9', 1),
    ];
    const stats = computeLineupStats(events, players(), cfg);
    expect(stats.get('A4')?.plusMinus).toBe(1);
    expect(stats.get('A9')?.plusMinus).toBe(-1);
    expect(stats.get('A5')?.plusMinus).toBe(0);
    expect(stats.get('A10')?.plusMinus).toBe(0);
  });
});

describe('残り時間の入力', () => {
  it('テンキーの数字を秒にする', () => {
    expect(parseClockDigits('', 600)).toBeNull();
    expect(parseClockDigits('632', 600)).toBe(392);
    expect(parseClockDigits('45', 600)).toBe(45);
    expect(parseClockDigits('1000', 600)).toBe(600);
    expect(parseClockDigits('0', 600)).toBe(0);
  });

  it('秒が60以上、ピリオドの長さを超える値はエラー', () => {
    expect(parseClockDigits('675', 600)).toBeUndefined();
    expect(parseClockDigits('1001', 600)).toBeUndefined();
    expect(parseClockDigits('501', 300)).toBeUndefined();
  });

  it('表示', () => {
    expect(formatClock(392)).toBe('6:32');
    expect(formatClock(5)).toBe('0:05');
    expect(clockDigitsLabel('')).toBe('--:--');
    expect(clockDigitsLabel('632')).toBe('6:32');
    expect(clockDigitsLabel('5')).toBe('0:05');
    expect(clockDigitsLabel('1000')).toBe('10:00');
  });
});
