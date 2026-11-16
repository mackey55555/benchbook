import { practiceStep } from '../practice';
import { ev, foul, resetSeq } from './helpers';

beforeEach(resetSeq);

describe('practiceStep', () => {
  it('選手を選ぶ → 2P○ の順に案内する', () => {
    expect(practiceStep([], null).target).toBe('playerA');
    // 相手を選んでいるあいだは、まだ自チームを選ぶ案内のまま
    expect(practiceStep([], 'B').target).toBe('playerA');
    expect(practiceStep([], 'A')).toMatchObject({ index: 2, target: 'made2' });
  });

  it('得点のあとはファウル、そのあとは取り消し、最後にQ終了を案内する', () => {
    const scored = [ev('FG2_MADE', 'A', 'A4')];
    expect(practiceStep(scored, null).target).toBe('anyPlayer');
    expect(practiceStep(scored, 'B').target).toBe('foul');
    const fouled = [...scored, foul('B', 'B4', 'P')];
    expect(practiceStep(fouled, null).target).toBe('undo');
    const undone = [...scored, foul('B', 'B4', 'P', 1, 0)].map((e, i) => (i === 1 ? { ...e, voidedAt: 5 } : e));
    expect(practiceStep(undone, null)).toMatchObject({ index: 6, total: 6, target: 'endPeriod' });
  });

  it('得点を取り消しても、手順は戻らない', () => {
    const events = [{ ...ev('FG2_MADE', 'A', 'A4'), voidedAt: 3 }];
    // 得点もファウルも「やったこと」として数えるので、次はファウルの案内
    expect(practiceStep(events, null).target).toBe('anyPlayer');
  });
});
