import { practiceStep, type PracticeFlags } from '../practice';
import { ev, foul, resetSeq } from './helpers';

beforeEach(resetSeq);

const none: PracticeFlags = { foulSheetUsed: false, foulsViewed: false };

describe('practiceStep', () => {
  it('選手を選ぶ → 2P○ の順に案内する', () => {
    expect(practiceStep([], null, none).target).toBe('playerA');
    // 相手を選んでいるあいだは、まだ自チームを選ぶ案内のまま
    expect(practiceStep([], 'B', none).target).toBe('playerA');
    expect(practiceStep([], 'A', none)).toMatchObject({ index: 2, target: 'made2' });
  });

  it('得点のあとはファウル、そのあとは取り消しを案内する', () => {
    const scored = [ev('FG2_MADE', 'A', 'A4')];
    expect(practiceStep(scored, null, none).target).toBe('anyPlayer');
    expect(practiceStep(scored, 'B', none)).toMatchObject({ index: 4, target: 'foul' });
    const fouled = [...scored, foul('B', 'B4', 'P')];
    expect(practiceStep(fouled, null, none)).toMatchObject({ index: 5, target: 'undo' });
  });

  it('取り消しのあとは、種類つきのファウル、タイムアウト、ファウル状況、Q終了の順に案内する', () => {
    const undone = [ev('FG2_MADE', 'A', 'A4'), { ...foul('B', 'B4', 'P'), voidedAt: 5 }];
    expect(practiceStep(undone, null, none)).toMatchObject({ index: 6, target: 'anyPlayer' });
    expect(practiceStep(undone, 'A', none)).toMatchObject({ index: 7, target: 'foul' });
    // タップで普通のファウルを足しても、長押しのシートを使うまでは先に進まない
    const tapped = [...undone, foul('A', 'A4', 'P')];
    expect(practiceStep(tapped, null, none).index).toBe(6);

    const sheet: PracticeFlags = { foulSheetUsed: true, foulsViewed: false };
    expect(practiceStep(tapped, null, sheet)).toMatchObject({ index: 8, target: 'timeout' });
    const timeout = [...tapped, ev('TIMEOUT', 'A', null)];
    expect(practiceStep(timeout, null, sheet)).toMatchObject({ index: 9, target: 'fouls' });
    expect(practiceStep(timeout, null, { foulSheetUsed: true, foulsViewed: true })).toMatchObject({
      index: 10,
      total: 10,
      target: 'endPeriod',
    });
  });

  it('得点を取り消しても、手順は戻らない', () => {
    const events = [{ ...ev('FG2_MADE', 'A', 'A4'), voidedAt: 3 }];
    expect(practiceStep(events, null, none).target).toBe('anyPlayer');
  });
});
