import fs from 'node:fs';

import { computeTeamFouls, remainingTimeouts } from '@/domain/rules';
import { buildBoxScore, buildRunningScore, deriveGameState } from '@/domain/stats';
import type { EventType, FoulKind, Side } from '@/domain/types';
import { buildBoxScoreHtml } from '@/output/boxScoreHtml';
import { buildRunningScoreHtml } from '@/output/runningScoreHtml';

import {
  addEvent,
  addPlayer,
  addRosterEntry,
  confirmPeriod,
  createGame,
  endPeriod,
  ensureOwnTeam,
  getGameBundle,
  listRoster,
  replaceEvent,
  setLastTwoMinutes,
  startGame,
  undoLastEvent,
  updateGame,
} from '../repo';
import { openTestDb } from './testDb';

/**
 * 1試合分の通し入力。手で数えた期待値（下のコメント）と集計値が一致することを確認する。
 * 延長1回、UNDO、修正、退場、失格、TO、残り2分を含む。
 */
describe('通し入力シナリオ', () => {
  const { db } = openTestDb();
  const own = ensureOwnTeam(db);
  for (const n of ['4', '5', '6', '7', '8']) addPlayer(db, own.id, { number: n, name: `選手${n}` });
  const game = createGame(db);
  updateGame(db, game.id, { teamBName: '相手' });
  for (const n of ['10', '11', '12', '13', '14']) addRosterEntry(db, game.id, 'B', { number: n });
  startGame(db, game.id);
  const roster = listRoster(db, game.id);
  const id = (side: Side, number: string) => roster.find((r) => r.side === side && r.number === number)!.id;

  let period = 1;
  const add = (side: Side, number: string | null, type: EventType, foulKind?: FoulKind, ftAwarded?: number) =>
    addEvent(db, { gameId: game.id, period, side, rosterId: number ? id(side, number) : null, type, foulKind, ftAwarded });
  const close = () => {
    endPeriod(db, game.id, period);
    const outcome = confirmPeriod(db, game.id, period);
    period += 1;
    return outcome;
  };

  // --- Q1: A 7点（2+3+2）、B 5点（3+2）
  add('A', '4', 'FG2_MADE');
  add('A', '5', 'AST');
  add('B', '10', 'FG3_MADE');
  add('A', '5', 'FG3_MADE');
  add('B', '11', 'FG2_MISS');
  add('A', '6', 'DREB');
  add('A', '4', 'FG2_MADE');
  add('B', '10', 'FG2_MADE');
  add('B', '11', 'FG3_MADE'); // 誤入力 → UNDO
  undoLastEvent(db, game.id, period);
  add('A', '4', 'FOUL'); // P
  add('B', null, 'TIMEOUT');
  const q1 = close();

  // --- Q2: A 4点（FT2 + 2P）、B 6点（3+3）。A#4がファウル3つ追加で計4（警告）
  add('B', '12', 'FOUL', 'P', 2);
  add('A', '6', 'FT_MADE');
  add('A', '6', 'FT_MADE');
  add('B', '10', 'FG3_MADE');
  const wrong = add('A', '7', 'FG3_MADE'); // 実際は #8 の2P → 修正
  replaceEvent(db, wrong.id, { rosterId: id('A', '8'), type: 'FG2_MADE' });
  add('B', '13', 'FG3_MADE');
  add('A', '4', 'FOUL');
  add('A', '4', 'FOUL');
  add('A', '4', 'FOUL');
  add('A', null, 'TIMEOUT');
  add('A', null, 'TIMEOUT');
  const q2 = close();

  // --- Q3: A 6点（3+3）、B 4点（2+2）。B#14 が U×2 で失格。A#4 が5つ目で退場
  add('A', '5', 'FG3_MADE');
  add('B', '14', 'FOUL', 'U', 2);
  add('A', '5', 'FT_MISS');
  add('A', '5', 'FT_MISS');
  add('B', '10', 'FG2_MADE');
  add('B', '14', 'FOUL', 'U', 2);
  add('A', '7', 'FG3_MADE');
  add('B', '11', 'FG2_MADE');
  add('A', '4', 'FOUL');
  add('B', null, 'FOUL', 'C', 1);
  const q3 = close();

  // --- Q4: A 3点（3）、B 5点（2+3）。合計 20-20 で延長へ。残り2分ON後にB TO
  add('A', '8', 'FG3_MADE');
  add('B', '12', 'FG2_MADE');
  add('B', null, 'TIMEOUT');
  setLastTwoMinutes(db, game.id, true);
  const toInL2M = remainingTimeouts(getGameBundle(db, game.id)!.events, 'B', 4);
  add('B', null, 'TIMEOUT');
  add('B', '13', 'FG3_MADE');
  add('A', '6', 'FOUL');
  add('A', '6', 'FOUL');
  const q4 = close();

  // --- OT1: A 2点、B 1点。22-21 で終了
  add('A', '7', 'FOUL');
  add('B', '10', 'FT_MADE');
  add('B', '10', 'FT_MISS');
  add('A', '8', 'FG2_MADE');
  add('A', '8', 'OREB');
  add('A', '5', 'STL');
  add('B', '12', 'TOV');
  add('B', '13', 'BLK');
  const teamFoulsOt = computeTeamFouls(getGameBundle(db, game.id)!.events, 'A', 5);
  const ot = close();

  const bundle = getGameBundle(db, game.id)!;

  it('ピリオドの進行：Q1〜Q3は次へ、Q4同点で延長、OT1で終了', () => {
    expect([q1, q2, q3, q4, ot]).toEqual(['nextPeriod', 'nextPeriod', 'nextPeriod', 'overtime', 'finished']);
    expect(bundle.game).toMatchObject({ status: 'finished', currentPeriod: 5 });
  });

  it('照合記録（累計得点・チームファウル）が一致する', () => {
    expect(bundle.checks.map((c) => [c.period, c.scoreA, c.scoreB, c.teamFoulsA, c.teamFoulsB, c.matched])).toEqual([
      [1, 7, 5, 1, 0, true],
      [2, 11, 11, 3, 1, true],
      [3, 17, 15, 1, 2, true],
      [4, 20, 20, 2, 0, true],
      [5, 22, 21, 3, 0, true],
    ]);
  });

  it('延長のチームファウルは第4Qから継続する', () => {
    expect(teamFoulsOt).toBe(3);
  });

  it('TO残数：残り2分ON時点で2回、試合を通して前半/後半/延長の枠で数える', () => {
    expect(toInL2M).toBe(2);
    expect(remainingTimeouts(bundle.events, 'A', 2)).toBe(0);
    expect(remainingTimeouts(bundle.events, 'B', 2)).toBe(1);
    expect(remainingTimeouts(bundle.events, 'B', 4)).toBe(1);
    expect(remainingTimeouts(bundle.events, 'B', 5)).toBe(1);
  });

  it('選手の状態：A#4は退場、B#14は失格、A#6は3ファウルで通常', () => {
    const state = deriveGameState(bundle.events, bundle.roster, 5);
    const status = (side: Side, n: string) => state[side].players.find((p) => p.roster.number === n)?.status;
    expect(status('A', '4')).toBe('fouledOut');
    expect(status('B', '14')).toBe('disqualified');
    expect(status('A', '6')).toBe('ok');
    expect(state.B.coach).toMatchObject({ C: 1, B: 0, disqualified: false });
  });

  it('ボックススコアが一致する', () => {
    const box = buildBoxScore(bundle.events, bundle.roster);
    expect(box.A.total).toMatchObject({
      pts: 22, fg2m: 4, fg2a: 4, fg3m: 4, fg3a: 4, ftm: 2, fta: 4,
      oreb: 1, dreb: 1, reb: 2, ast: 1, stl: 1, blk: 0, tov: 0, pf: 8,
    });
    expect(box.B.total).toMatchObject({
      pts: 21, fg2m: 4, fg2a: 5, fg3m: 4, fg3a: 4, ftm: 1, fta: 2, blk: 1, tov: 1, pf: 3,
    });
    const line = (side: Side, n: string) => box[side].players.find((p) => p.number === n);
    expect(line('A', '4')).toMatchObject({ pts: 4, pf: 5 });
    expect(line('A', '8')).toMatchObject({ pts: 7, fg2m: 2, fg3m: 1, oreb: 1 });
    expect(line('A', '7')).toMatchObject({ pts: 3, fg3m: 1, pf: 1 });
    expect(line('B', '10')).toMatchObject({ pts: 11, fg3m: 2, fg2m: 2, ftm: 1, fta: 2 });
    expect(buildBoxScore(bundle.events, bundle.roster, 2).A.total.pts).toBe(4);
  });

  it('ランニングスコアの累計と各Q最後の得点が一致する', () => {
    const rs = buildRunningScore(bundle.events, bundle.roster);
    expect(rs.A.map((e) => e.total)).toEqual([2, 5, 7, 8, 9, 11, 14, 17, 20, 22]);
    expect(rs.B.map((e) => e.total)).toEqual([3, 5, 8, 11, 13, 15, 17, 20, 21]);
    expect(rs.A.filter((e) => e.periodEnd).map((e) => [e.period, e.total])).toEqual([
      [1, 7], [2, 11], [3, 17], [4, 20], [5, 22],
    ]);
    expect(rs.B.filter((e) => e.periodEnd).map((e) => [e.period, e.total])).toEqual([
      [1, 5], [2, 11], [3, 15], [4, 20], [5, 21],
    ]);
    // 修正したイベントは #8 の2Pとして元の位置（9点目）に入る
    expect(rs.A.find((e) => e.total === 11)).toMatchObject({ number: '8', kind: 'FG2', period: 2 });
  });

  it('出力HTMLに最終スコアと延長の列が出る', () => {
    const html = buildRunningScoreHtml(bundle);
    expect(html).toContain('自チーム 22 - 21 相手');
    expect(html).toContain('<th>OT1</th>');
    if (process.env.SAMPLE_HTML) fs.writeFileSync(process.env.SAMPLE_HTML, html);
  });

  it('ボックススコアのHTMLに勝敗・Q別得点・合計と成功率が出る', () => {
    const html = buildBoxScoreHtml(bundle);
    expect(html).toContain('<span class="mark">○</span><span class="final">22</span>');
    expect(html).toContain('<span class="mark">●</span><span class="final">21</span>');
    expect(html).toContain('<div><span>7</span><span class="q">Q1</span><span>5</span></div>');
    expect(html).toContain('<div><span>2</span><span class="q">OT1</span><span>1</span></div>');
    // A合計：PTS 22、3P 4/4、2P 4/4、FT 2/4、F 8、OR1 DR1 TR2、TO0 AS1 ST1 BS0
    expect(html).toContain(
      '<td class="total-label" colspan="3">合計</td><td class="pts">22</td><td>4</td><td>4</td><td class="pct">100.0%</td><td>4</td><td>4</td><td class="pct">100.0%</td><td>2</td><td>4</td><td class="pct">50.0%</td><td>8</td><td>1</td><td>1</td><td>2</td><td>0</td><td>1</td><td>1</td><td>0</td><td></td><td></td>',
    );
    expect(html).toContain('FG（2P＋3P）　8/8　100.0%');
    expect(html).toContain('FG（2P＋3P）　8/9　88.9%');
    if (process.env.SAMPLE_BOX_HTML) fs.writeFileSync(process.env.SAMPLE_BOX_HTML, html);
  });
});
