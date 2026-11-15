import fs from 'node:fs';

import { ev, foul, resetSeq, roster } from '@/domain/__tests__/helpers';

import { buildRunningScoreHtml } from '../runningScoreHtml';

beforeEach(resetSeq);

const game = {
  date: '2026-11-15',
  leagueName: '秋季リーグ <1部>',
  venue: '市民体育館',
  teamAName: 'ベンチブックス',
  teamBName: 'ライバルズ',
  currentPeriod: 2,
};
const players = [...roster('A', ['4', '5']), ...roster('B', ['10'])];

function sample() {
  return [
    ev('FG2_MADE', 'A', 'A4', 1),
    ev('FG3_MADE', 'A', 'A5', 1),
    ev('FT_MADE', 'B', 'B10', 1),
    foul('A', 'A4', 'U', 1, 2),
    ev('TIMEOUT', 'A', null, 1),
    ev('PERIOD_END', null, null, 1),
    ev('FG2_MADE', 'B', 'B10', 2),
  ];
}

describe('buildRunningScoreHtml', () => {
  const html = buildRunningScoreHtml({ game, roster: players, staff: [], events: sample() });

  it('2Pは斜線＋背番号', () => {
    expect(html).toContain('<td class="no q1">4</td><td class="sc hit q1 slash">2</td>');
  });

  it('3Pは斜線＋背番号を丸で囲む。Q最後の得点は丸囲み＋下線', () => {
    expect(html).toContain(
      '<td class="no q1 end"><span class="ring">5</span></td><td class="sc hit q1 slash end"><span class="ring">5</span></td>',
    );
  });

  it('FTは黒丸＋背番号（Bは得点欄が左）', () => {
    expect(html).toContain(
      '<td class="sc hit q1 end"><span class="ring"><span class="dot"></span></span></td><td class="no q1 end">10</td>',
    );
  });

  it('次のQは色（クラス）が変わる', () => {
    expect(html).toContain('<td class="sc hit q2 slash">3</td><td class="no q2">10</td>');
  });

  it('得点のないマスは数字だけ。160点まで並ぶ', () => {
    expect(html).toContain('<td class="no"></td><td class="sc">1</td>');
    expect(html).toContain('<td class="sc">160</td>');
  });

  it('ファウル欄・TO欄・Q別得点・最終スコアを出す', () => {
    expect(html).toContain('<td class="f q1">U2</td>');
    expect(html).toContain('前半 <span class="box">×</span><span class="box"></span>');
    expect(html).toContain('ベンチブックス 5 - 3 ライバルズ');
    expect(html).toContain('<td class="q1">5</td><td class="q2">0</td>');
  });

  it('文字をエスケープする', () => {
    expect(html).toContain('秋季リーグ &lt;1部&gt;');
  });

  it('サンプルを書き出す（目視確認用、SAMPLE_HTML 指定時のみ）', () => {
    if (process.env.SAMPLE_HTML) fs.writeFileSync(process.env.SAMPLE_HTML, html);
  });
});
