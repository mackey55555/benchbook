import { layoutPlayerGrid } from '../playerGrid';

const team = (count: number, court: number[] = []) =>
  Array.from({ length: count }, (_, i) => ({ n: i + 1, onCourt: court.includes(i + 1) }));

const shape = (rows: ReturnType<typeof layoutPlayerGrid<{ n: number; onCourt: boolean }>>) =>
  rows.map((r) => `${r.items.length}/${r.columns}${r.compact ? 's' : ''}x${r.weight}`);

describe('layoutPlayerGrid', () => {
  it('交代を記録していないチームは、12名まで3列4段', () => {
    expect(shape(layoutPlayerGrid(team(12), false))).toEqual(['3/3x1', '3/3x1', '3/3x1', '3/3x1']);
    expect(shape(layoutPlayerGrid(team(5), false))).toEqual(['3/3x1', '2/3x1', '0/3x1', '0/3x1']);
  });

  it('交代を記録していないチームは、13名以上で4列になる', () => {
    expect(shape(layoutPlayerGrid(team(15), false))).toEqual(['4/4x1', '4/4x1', '4/4x1', '3/4x1']);
    expect(shape(layoutPlayerGrid(team(20), false))).toHaveLength(5);
  });

  it('交代を記録しているチームは、コートの選手を上に大きく、ベンチを下に小さく並べる', () => {
    const rows = layoutPlayerGrid(team(12, [1, 4, 6, 9, 12]), true);
    expect(shape(rows)).toEqual(['3/3x2', '2/3x2', '4/4sx1', '3/4sx1']);
    expect(rows.slice(0, 2).flatMap((r) => r.items.map((p) => p.n))).toEqual([1, 4, 6, 9, 12]);
    expect(rows.slice(2).flatMap((r) => r.items.map((p) => p.n))).toEqual([2, 3, 5, 7, 8, 10, 11]);
  });

  it('20名でも、コートの段の数と大きさは変わらない', () => {
    const rows = layoutPlayerGrid(team(20, [1, 2, 3, 4, 5]), true);
    expect(shape(rows)).toEqual(['3/3x2', '2/3x2', '5/5sx1', '5/5sx1', '5/5sx1']);
  });

  it('コートに誰もいないときは、全員を同じ大きさで並べる', () => {
    expect(shape(layoutPlayerGrid(team(12), true))).toEqual(['3/3x1', '3/3x1', '3/3x1', '3/3x1']);
  });
});
