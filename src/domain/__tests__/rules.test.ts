import {
  activeEvents,
  afterPeriod,
  checkDisqualification,
  compareNumbers,
  computeCoachFouls,
  computePeriodScores,
  computePlayerFouls,
  computeScore,
  computeScoreThrough,
  computeTeamFouls,
  foulNotation,
  isInBonus,
  isLastTwoMinutes,
  periodLabel,
  remainingTimeouts,
} from '../rules';
import { ev, foul, resetSeq } from './helpers';

beforeEach(resetSeq);

describe('computeScore', () => {
  it('2P=2点、3P=3点、FT=1点。失敗とその他は0点', () => {
    const events = [
      ev('FG2_MADE', 'A', 'A4'),
      ev('FG3_MADE', 'A', 'A5'),
      ev('FT_MADE', 'A', 'A4'),
      ev('FG2_MISS', 'A', 'A4'),
      ev('FG3_MISS', 'A', 'A4'),
      ev('FT_MISS', 'A', 'A4'),
      ev('OREB', 'A', 'A4'),
      ev('FG3_MADE', 'B', 'B7'),
    ];
    expect(computeScore(events)).toEqual({ A: 6, B: 3 });
  });

  it('取消済み（voided_at）のイベントは数えない', () => {
    const events = [ev('FG2_MADE', 'A', 'A4'), ev('FG3_MADE', 'A', 'A4', 1, { voidedAt: 99 })];
    expect(computeScore(events)).toEqual({ A: 2, B: 0 });
  });

  it('ピリオド別・累計を出せる', () => {
    const events = [
      ev('FG2_MADE', 'A', 'A4', 1),
      ev('FG3_MADE', 'B', 'B4', 2),
      ev('FT_MADE', 'A', 'A4', 3),
    ];
    expect(computeScore(events, 2)).toEqual({ A: 0, B: 3 });
    expect(computeScoreThrough(events, 2)).toEqual({ A: 2, B: 3 });
    expect(computePeriodScores(events, 3).map((p) => p.score)).toEqual([
      { A: 2, B: 0 },
      { A: 0, B: 3 },
      { A: 1, B: 0 },
    ]);
  });
});

describe('activeEvents', () => {
  it('order_key順に並べ、修正（同じorder_key）は元の位置に入る', () => {
    const first = ev('FG2_MADE', 'A', 'A4');
    const wrong = ev('FG2_MADE', 'A', 'A5', 1, { voidedAt: 10 });
    const third = ev('FG2_MADE', 'B', 'B4');
    const fixed = ev('FG3_MADE', 'A', 'A5', 1, {
      orderKey: wrong.orderKey,
      replacesEventId: wrong.id,
    });
    const ordered = activeEvents([third, fixed, wrong, first]);
    expect(ordered.map((e) => e.id)).toEqual([first.id, fixed.id, third.id]);
  });
});

describe('computeTeamFouls', () => {
  it('Qごとに集計する', () => {
    const events = [
      foul('A', 'A4', 'P', 1),
      foul('A', 'A5', 'P', 1),
      foul('A', 'A4', 'P', 2),
      foul('B', 'B4', 'P', 1),
    ];
    expect(computeTeamFouls(events, 'A', 1)).toBe(2);
    expect(computeTeamFouls(events, 'A', 2)).toBe(1);
    expect(computeTeamFouls(events, 'A', 3)).toBe(0);
    expect(computeTeamFouls(events, 'B', 1)).toBe(1);
  });

  it('選手のP/T/U/Dを数え、HC・ベンチのC/Bは数えない', () => {
    const events = [
      foul('A', 'A4', 'P'),
      foul('A', 'A5', 'T'),
      foul('A', 'A6', 'U'),
      foul('A', 'A7', 'D'),
      foul('A', null, 'C'),
      foul('A', null, 'B'),
    ];
    expect(computeTeamFouls(events, 'A', 1)).toBe(4);
  });

  it('延長は第4Qの累計を継続する', () => {
    const events = [
      foul('A', 'A4', 'P', 3),
      foul('A', 'A4', 'P', 4),
      foul('A', 'A5', 'P', 4),
      foul('A', 'A6', 'P', 5),
      foul('A', 'A7', 'P', 6),
    ];
    expect(computeTeamFouls(events, 'A', 4)).toBe(2);
    expect(computeTeamFouls(events, 'A', 5)).toBe(3);
    expect(computeTeamFouls(events, 'A', 6)).toBe(4);
  });

  it('取消済みは数えない', () => {
    const events = [foul('A', 'A4', 'P'), { ...foul('A', 'A5', 'P'), voidedAt: 1 }];
    expect(computeTeamFouls(events, 'A', 1)).toBe(1);
  });

  it('4つに達したら次からFT（5つ目以降がペナルティ）', () => {
    expect(isInBonus(3)).toBe(false);
    expect(isInBonus(4)).toBe(true);
    expect(isInBonus(5)).toBe(true);
  });
});

describe('computePlayerFouls / checkDisqualification', () => {
  it('種類ごとの数と合計、記録順のリストを返す', () => {
    const events = [
      foul('A', 'A4', 'P', 1, 2),
      foul('A', 'A4', 'U', 2, 2),
      foul('A', 'A5', 'P', 2),
      foul('A', null, 'C', 2),
    ];
    const fouls = computePlayerFouls(events, 'A4');
    expect(fouls).toMatchObject({ P: 1, T: 0, U: 1, D: 0, total: 2 });
    expect(fouls.list).toEqual([
      { kind: 'P', ftAwarded: 2, period: 1 },
      { kind: 'U', ftAwarded: 2, period: 2 },
    ]);
  });

  const status = (f: Partial<{ P: number; T: number; U: number; D: number }>) =>
    checkDisqualification({ P: 0, T: 0, U: 0, D: 0, ...f });

  it('3ファウルまでは通常', () => {
    expect(status({})).toBe('ok');
    expect(status({ P: 3 })).toBe('ok');
  });

  it('4ファウルで警告', () => {
    expect(status({ P: 4 })).toBe('warning');
    expect(status({ P: 3, T: 1 })).toBe('warning');
    expect(status({ P: 3, U: 1 })).toBe('warning');
  });

  it('合計5（P+T+U+D）で退場', () => {
    expect(status({ P: 5 })).toBe('fouledOut');
    expect(status({ P: 4, T: 1 })).toBe('fouledOut');
    expect(status({ P: 4, U: 1 })).toBe('fouledOut');
  });

  it('T×2、U×2、T×1＋U×1 で失格', () => {
    expect(status({ T: 2 })).toBe('disqualified');
    expect(status({ U: 2 })).toBe('disqualified');
    expect(status({ T: 1, U: 1 })).toBe('disqualified');
    expect(status({ T: 1 })).toBe('ok');
    expect(status({ U: 1 })).toBe('ok');
  });

  it('D は即失格', () => {
    expect(status({ D: 1 })).toBe('disqualified');
  });

  it('失格は退場より優先する', () => {
    expect(status({ P: 3, T: 2 })).toBe('disqualified');
  });
});

describe('computeCoachFouls（HCの失格）', () => {
  it('C×2 で失格', () => {
    expect(computeCoachFouls([foul('A', null, 'C')], 'A').disqualified).toBe(false);
    expect(computeCoachFouls([foul('A', null, 'C'), foul('A', null, 'C')], 'A').disqualified).toBe(
      true,
    );
  });

  it('C・Bの合計が3で失格', () => {
    const two = [foul('A', null, 'B'), foul('A', null, 'B')];
    expect(computeCoachFouls(two, 'A').disqualified).toBe(false);
    expect(computeCoachFouls([...two, foul('A', null, 'B')], 'A').disqualified).toBe(true);
    expect(computeCoachFouls([...two, foul('A', null, 'C')], 'A').disqualified).toBe(true);
  });

  it('相手チーム・選手のファウルは含めない', () => {
    const events = [foul('B', null, 'C'), foul('B', null, 'C'), foul('A', 'A4', 'T')];
    expect(computeCoachFouls(events, 'A')).toMatchObject({ C: 0, B: 0, disqualified: false });
  });
});

describe('remainingTimeouts', () => {
  const to = (side: 'A' | 'B', period: number) => ev('TIMEOUT', side, null, period);

  it('前半2回', () => {
    expect(remainingTimeouts([], 'A', 1)).toBe(2);
    expect(remainingTimeouts([to('A', 1)], 'A', 2)).toBe(1);
    expect(remainingTimeouts([to('A', 1), to('A', 2)], 'A', 2)).toBe(0);
  });

  it('後半3回。前半の未使用分は繰り越さない', () => {
    expect(remainingTimeouts([], 'A', 3)).toBe(3);
    expect(remainingTimeouts([to('A', 1), to('A', 2)], 'A', 3)).toBe(3);
    expect(remainingTimeouts([to('A', 3), to('A', 4)], 'A', 4)).toBe(1);
  });

  it('延長は各1回。繰り越さない', () => {
    expect(remainingTimeouts([], 'A', 5)).toBe(1);
    expect(remainingTimeouts([to('A', 5)], 'A', 5)).toBe(0);
    expect(remainingTimeouts([to('A', 5)], 'A', 6)).toBe(1);
    expect(remainingTimeouts([to('A', 3)], 'A', 5)).toBe(1);
  });

  it('チームごとに数える', () => {
    expect(remainingTimeouts([to('B', 1)], 'A', 1)).toBe(2);
    expect(remainingTimeouts([to('B', 1)], 'B', 1)).toBe(1);
  });

  it('残り0より下にはならない', () => {
    expect(remainingTimeouts([to('A', 1), to('A', 1), to('A', 2)], 'A', 2)).toBe(0);
  });

  describe('第4Q残り2分', () => {
    const l2m = () => ev('L2M', null, null, 4);

    it('未使用のまま残り2分に入ると最大2回になる', () => {
      const events = [l2m()];
      expect(isLastTwoMinutes(events)).toBe(true);
      expect(remainingTimeouts(events, 'A', 4)).toBe(2);
    });

    it('残り2分より前に1回使っていれば2回のまま', () => {
      expect(remainingTimeouts([to('A', 3), l2m()], 'A', 4)).toBe(2);
    });

    it('残り2分より前に2回使っていれば1回', () => {
      expect(remainingTimeouts([to('A', 3), to('A', 4), l2m()], 'A', 4)).toBe(1);
    });

    it('残り2分以降に使った分は上限2回から引く', () => {
      expect(remainingTimeouts([l2m(), to('A', 4)], 'A', 4)).toBe(1);
      expect(remainingTimeouts([l2m(), to('A', 4), to('A', 4)], 'A', 4)).toBe(0);
      expect(remainingTimeouts([to('A', 3), l2m(), to('A', 4)], 'A', 4)).toBe(1);
    });

    it('トグルをOFF（マーカーを取消）にすると通常の計算に戻る', () => {
      const events = [{ ...l2m(), voidedAt: 5 }];
      expect(isLastTwoMinutes(events)).toBe(false);
      expect(remainingTimeouts(events, 'A', 4)).toBe(3);
    });

    it('延長には影響しない', () => {
      expect(remainingTimeouts([l2m()], 'A', 5)).toBe(1);
    });
  });
});

describe('afterPeriod', () => {
  it('第1〜3Qは次のQへ', () => {
    expect(afterPeriod(1, { A: 10, B: 10 })).toBe('nextPeriod');
    expect(afterPeriod(3, { A: 10, B: 12 })).toBe('nextPeriod');
  });

  it('第4Q終了時に同点なら延長、それ以外は終了', () => {
    expect(afterPeriod(4, { A: 60, B: 60 })).toBe('overtime');
    expect(afterPeriod(4, { A: 61, B: 60 })).toBe('finished');
  });

  it('延長は決着まで繰り返す', () => {
    expect(afterPeriod(5, { A: 70, B: 70 })).toBe('overtime');
    expect(afterPeriod(6, { A: 80, B: 78 })).toBe('finished');
  });
});

describe('表記', () => {
  it('ピリオド名', () => {
    expect(periodLabel(1)).toBe('Q1');
    expect(periodLabel(4)).toBe('Q4');
    expect(periodLabel(5)).toBe('OT1');
    expect(periodLabel(6)).toBe('OT2');
  });

  it('ファウルは種類＋FT数（0は省略）', () => {
    expect(foulNotation('P', 0)).toBe('P');
    expect(foulNotation('P', 2)).toBe('P2');
    expect(foulNotation('U', 2)).toBe('U2');
    expect(foulNotation('T', 1)).toBe('T1');
    expect(foulNotation('D', null)).toBe('D');
  });

  it('背番号は数値順、00は0の前', () => {
    expect(['10', '4', '0', '00', '23'].sort(compareNumbers)).toEqual(['00', '0', '4', '10', '23']);
  });
});
