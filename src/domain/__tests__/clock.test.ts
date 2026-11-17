import { clockRemainingMs, clockSeconds, clockStamp, clockToDigits, isClockRunning, isClockUsed } from '../clock';

const cfg = { periodMinutes: 10, otMinutes: 5 };
const unused = { clockPeriod: null, clockRemainingMs: null, clockStartedAt: null };

describe('試合の時計', () => {
  it('使っていないピリオドは、ピリオドの長さを表示し、記録に時刻を付けない', () => {
    expect(isClockUsed(unused, 1)).toBe(false);
    expect(clockSeconds(unused, 1, cfg, 1000)).toBe(600);
    expect(clockSeconds(unused, 5, cfg, 1000)).toBe(300);
    expect(clockStamp(unused, 1, cfg, 1000)).toBeNull();
  });

  it('前のピリオドの時計は、次のピリオドでは未使用として扱う', () => {
    const q1 = { clockPeriod: 1, clockRemainingMs: 0, clockStartedAt: null };
    expect(isClockUsed(q1, 2)).toBe(false);
    expect(clockSeconds(q1, 2, cfg, 1000)).toBe(600);
    expect(clockStamp(q1, 2, cfg, 1000)).toBeNull();
  });

  it('動いている間は、開始からの経過分だけ減る', () => {
    const running = { clockPeriod: 1, clockRemainingMs: 600_000, clockStartedAt: 10_000 };
    expect(isClockRunning(running, 1)).toBe(true);
    expect(clockRemainingMs(running, 1, cfg, 10_000)).toBe(600_000);
    expect(clockSeconds(running, 1, cfg, 10_000 + 208_000)).toBe(392);
    expect(clockStamp(running, 1, cfg, 10_000 + 208_000)).toBe(392);
  });

  it('端数は切り上げ、0より下にはならない', () => {
    const running = { clockPeriod: 1, clockRemainingMs: 5_000, clockStartedAt: 0 };
    expect(clockSeconds(running, 1, cfg, 100)).toBe(5);
    expect(clockSeconds(running, 1, cfg, 4_001)).toBe(1);
    expect(clockSeconds(running, 1, cfg, 5_000)).toBe(0);
    expect(clockSeconds(running, 1, cfg, 99_000)).toBe(0);
  });

  it('止まっている間は進まない。端末の時刻が戻っても増えない', () => {
    const stopped = { clockPeriod: 1, clockRemainingMs: 392_000, clockStartedAt: null };
    expect(isClockRunning(stopped, 1)).toBe(false);
    expect(clockSeconds(stopped, 1, cfg, 9_999_999)).toBe(392);
    const running = { clockPeriod: 1, clockRemainingMs: 392_000, clockStartedAt: 50_000 };
    expect(clockSeconds(running, 1, cfg, 40_000)).toBe(392);
  });

  it('残り秒をテンキーの数字に直す', () => {
    expect(clockToDigits(392)).toBe('632');
    expect(clockToDigits(600)).toBe('1000');
    expect(clockToDigits(45)).toBe('45');
    expect(clockToDigits(5)).toBe('5');
    expect(clockToDigits(0)).toBe('0');
  });
});
