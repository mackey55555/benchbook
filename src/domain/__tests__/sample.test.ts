// テスト基盤の動作確認用。CP1でドメインのテストを追加したら削除する。
describe('test harness', () => {
  it('runs TypeScript tests under src/domain', () => {
    const points: number[] = [2, 3, 1];
    expect(points.reduce((sum, p) => sum + p, 0)).toBe(6);
  });
});
