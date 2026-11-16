import { RULES, computePeriodScores, computeScore, periodLabel } from '@/domain/rules';
import { computeLineupStats, formatClock, type LineupStat } from '@/domain/lineup';
import { buildBoxScore, teamOnlyLine, type BoxScoreLine, type TeamBoxScore } from '@/domain/stats';
import type { Side } from '@/domain/types';

import type { RunningScoreInput } from './runningScoreHtml';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 成功率（試投0は空欄） */
export function percent(made: number, attempted: number): string {
  return attempted > 0 ? `${((made / attempted) * 100).toFixed(1)}%` : '';
}

/** 出場のない選手は0を並べず空欄にして、記録のある行を目立たせる */
function hasRecord(l: BoxScoreLine): boolean {
  return (
    l.fg2a + l.fg3a + l.fta + l.reb + l.ast + l.stl + l.blk + l.tov + l.pf > 0
  );
}

function shooting(made: number, attempted: number, blank: boolean): string {
  if (blank) return '<td></td><td></td><td class="pct"></td>';
  return `<td>${made}</td><td>${attempted}</td><td class="pct">${percent(made, attempted)}</td>`;
}

function lineupCells(stat: LineupStat | undefined): string {
  if (!stat) return '<td></td><td></td>';
  const min = stat.seconds > 0 || stat.plusMinus !== 0 ? `${stat.approximate ? '約' : ''}${formatClock(stat.seconds)}` : '';
  const pm = stat.seconds > 0 || stat.plusMinus !== 0 ? `${stat.plusMinus > 0 ? '+' : ''}${stat.plusMinus}` : '';
  return `<td class="min">${min}</td><td>${pm}</td>`;
}

function line(l: BoxScoreLine, marks: string, stat: LineupStat | undefined, isTotal = false): string {
  const blank = !isTotal && !hasRecord(l);
  const n = (v: number) => (blank ? '' : String(v));
  const head = isTotal
    ? '<td class="total-label" colspan="3">合計</td>'
    : `<td class="no">${esc(l.number)}</td><td class="s">${marks}</td><td class="name">${esc(l.name)}</td>`;
  return `<tr class="${isTotal ? 'total' : ''}">${head}<td class="pts">${n(l.pts)}</td>${shooting(l.fg3m, l.fg3a, blank)}${shooting(l.fg2m, l.fg2a, blank)}${shooting(l.ftm, l.fta, blank)}<td>${n(l.pf)}</td><td>${n(l.oreb)}</td><td>${n(l.dreb)}</td><td>${n(l.reb)}</td><td>${n(l.tov)}</td><td>${n(l.ast)}</td><td>${n(l.stl)}</td><td>${n(l.blk)}</td>${lineupCells(stat)}</tr>`;
}

/** 選手を選ばずに記録した、チームのリバウンドとTO。記録があるときだけ行を出す */
function teamRow(team: TeamBoxScore): string {
  const l = teamOnlyLine(team);
  if (l.reb === 0 && l.tov === 0) return '';
  return `<tr><td class="total-label" colspan="3">チーム</td>${'<td></td>'.repeat(11)}<td>${l.oreb}</td><td>${l.dreb}</td><td>${l.reb}</td><td>${l.tov}</td>${'<td></td>'.repeat(5)}</tr>`;
}

function teamTable(
  input: RunningScoreInput,
  side: Side,
  team: TeamBoxScore,
  lineup: Map<string, LineupStat>,
): string {
  const name = (side === 'A' ? input.game.teamAName : input.game.teamBName) || `チーム${side}`;
  const rosterById = new Map(input.roster.map((r) => [r.id, r]));
  const rows = team.players
    .map((l) => {
      const r = l.rosterId ? rosterById.get(l.rosterId) : undefined;
      return line(
        l,
        `${r?.isStarter ? '●' : ''}${r?.isCaptain ? '<small>C</small>' : ''}`,
        l.rosterId ? lineup.get(l.rosterId) : undefined,
      );
    })
    .join('');
  const empty = Array.from(
    { length: Math.max(0, RULES.maxRosterSize - team.players.length) },
    () => `<tr>${'<td></td>'.repeat(23)}</tr>`,
  ).join('');
  const t = team.total;
  const fgm = t.fg2m + t.fg3m;
  const fga = t.fg2a + t.fg3a;
  const hc = input.staff.find((s) => s.side === side && s.role === 'HC')?.name ?? '';
  return `<section class="team">
<div class="tname">${esc(name)}<span class="hc">${hc ? `HC：${esc(hc)}` : ''}</span></div>
<table class="box">
<colgroup><col class="c-no"><col class="c-s"><col class="c-name"><col class="c-pts">${'<col><col><col class="c-pct">'.repeat(3)}${'<col>'.repeat(8)}<col class="c-min"><col></colgroup>
<thead>
<tr><th rowspan="2" class="no">No.</th><th rowspan="2" class="s">S</th><th rowspan="2" class="name">Player</th><th rowspan="2" class="pts">PTS</th><th colspan="3">3P FG</th><th colspan="3">2P FG</th><th colspan="3">FT</th><th rowspan="2">F</th><th colspan="3">REBOUNDS</th><th rowspan="2">TO</th><th rowspan="2">AS</th><th rowspan="2">ST</th><th rowspan="2">BS</th><th rowspan="2">MIN</th><th rowspan="2">+/-</th></tr>
<tr><th>M</th><th>A</th><th class="pct">%</th><th>M</th><th>A</th><th class="pct">%</th><th>M</th><th>A</th><th class="pct">%</th><th>OR</th><th>DR</th><th>TR</th></tr>
</thead>
<tbody>${rows}${empty}${teamRow(team)}${line(t, '', undefined, true)}</tbody>
</table>
<div class="fg">FG（2P＋3P）　${fgm}/${fga}　${percent(fgm, fga)}</div>
</section>`;
}

const CSS = `
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif; color: #111; font-size: 8pt; }
.sheet { width: 194mm; margin: 0 auto; }
@media screen { .sheet { padding: 3mm 0; } }
.head { border: 0.4mm solid #111; padding: 2mm 3mm; display: flex; justify-content: space-between; align-items: center; }
.head h1 { font-size: 15pt; margin: 0; letter-spacing: 0.5mm; }
.head .sub { font-size: 8pt; }
.head .info { font-size: 8pt; line-height: 1.6; text-align: right; }
.card { display: flex; border: 0.4mm solid #111; border-top: none; margin-bottom: 4mm; }
.card .side { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 15pt; font-weight: 700; padding: 3mm; text-align: center; min-width: 0; }
.card .result { width: 20mm; border-left: 0.3mm solid #111; border-right: 0.3mm solid #111; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2mm 0; }
.card .mark { font-size: 11pt; line-height: 1; }
.card .final { font-size: 20pt; font-weight: 800; line-height: 1.2; }
.card .periods { width: 40mm; padding: 2mm 0; display: flex; flex-direction: column; justify-content: center; }
.card .periods div { display: flex; justify-content: center; font-size: 9pt; line-height: 1.5; }
.card .periods span { width: 10mm; text-align: center; }
.card .periods .q { width: 12mm; font-size: 7pt; color: #555; }
.team { margin-bottom: 4mm; }
.tname { font-size: 10pt; font-weight: 700; margin-bottom: 0.8mm; display: flex; justify-content: space-between; align-items: baseline; }
.hc { font-size: 8pt; font-weight: 400; }
table { border-collapse: collapse; }
.box { width: 100%; table-layout: fixed; }
.box th, .box td { border: 0.2mm solid #111; height: 5.2mm; padding: 0 0.5mm; font-size: 7.5pt; text-align: center; overflow: hidden; white-space: nowrap; }
.box th { background: #eee; font-weight: 600; font-size: 6.5pt; height: 3.8mm; }
.box .c-no { width: 8mm; } .box .c-s { width: 6mm; } .box .c-name { width: 27mm; } .box .c-pts { width: 9mm; } .box .c-pct { width: 11.5mm; } .box .c-min { width: 12mm; }
.box .no { font-weight: 700; }
.box .s { width: 6mm; font-size: 6.5pt; }
.box .name { width: 30mm; text-align: left; padding-left: 1mm; }
.box th.name { text-align: center; }
.box .pts { width: 9mm; font-weight: 700; }
.box .pct { width: 12.5mm; font-size: 6.5pt; padding: 0; }
.box .total td { font-weight: 700; background: #f4f4f4; border-top: 0.4mm solid #111; }
.box .total-label { text-align: center; }
.fg { text-align: right; font-size: 8pt; margin-top: 1mm; }
.legend { font-size: 6.5pt; color: #555; line-height: 1.6; border-top: 0.2mm solid #999; padding-top: 1.5mm; }
`;

/**
 * ボックススコアのHTML（A4縦）。画面（WebView）とPDF（expo-print）で同じものを使う。
 * 集計はドメイン関数の結果だけを使う。
 */
export function buildBoxScoreHtml(input: RunningScoreInput): string {
  const { game, events, roster } = input;
  const box = buildBoxScore(events, roster);
  const lineup = computeLineupStats(events, roster, {
    periodMinutes: game.periodMinutes,
    otMinutes: game.otMinutes,
    currentPeriod: game.currentPeriod,
    finished: game.status === 'finished',
  });
  const total = computeScore(events);
  const periods = computePeriodScores(events, Math.max(game.currentPeriod, RULES.regulationPeriods));
  const mark = (side: Side) => {
    const other = side === 'A' ? 'B' : 'A';
    return total[side] > total[other] ? '○' : total[side] < total[other] ? '●' : '－';
  };
  const periodRows = periods
    .map(
      (p) =>
        `<div><span>${p.score.A}</span><span class="q">${periodLabel(p.period)}</span><span>${p.score.B}</span></div>`,
    )
    .join('');
  const result = (side: Side) =>
    `<div class="result"><span class="mark">${mark(side)}</span><span class="final">${total[side]}</span></div>`;

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=794, user-scalable=yes">
<title>${esc(game.teamAName)} vs ${esc(game.teamBName)} BOXSCORE</title>
<style>${CSS}</style></head>
<body><div class="sheet">
<div class="head">
<div><h1>BOXSCORE</h1><div class="sub">【ボックススコア】ベンチ控え</div></div>
<div class="info">${esc(game.leagueName)}<br>開催日：${esc(game.date)}　会場：${esc(game.venue)}</div>
</div>
<div class="card">
<div class="side">${esc(game.teamAName || 'チームA')}</div>
${result('A')}
<div class="periods">${periodRows}</div>
${result('B')}
<div class="side">${esc(game.teamBName || 'チームB')}</div>
</div>
${teamTable(input, 'A', box.A, lineup)}
${teamTable(input, 'B', box.B, lineup)}
<div class="legend">PTS：得点　3P／2P FG：3点／2点シュート　FT：フリースロー　M：成功　A：試投　%：成功率　F：ファウル　OR／DR／TR：オフェンス／ディフェンス／トータルリバウンド　TO：ターンオーバー　AS：アシスト　ST：スティール　BS：ブロック　S：●＝スターター、C＝キャプテン　MIN：出場時間（「約」は時刻なしの交代を含む概算）　+/-：出場中の得失点差<br>MIN と +/- は交代を記録したチームだけ表示します。これは控えの記録であり、公式記録ではありません</div>
</div></body></html>`;
}
