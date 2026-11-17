import { formatClock } from '@/domain/lineup';
import { compareNumbers, computeScore, periodLabel, pointsOf } from '@/domain/rules';
import { describeEvent } from '@/domain/stats';
import {
  buildTimeline,
  computeUnitStats,
  longestDroughts,
  longestRuns,
  scoreFlow,
  timeBands,
  type Timeline,
} from '@/domain/timeline';
import type { Side } from '@/domain/types';

import type { RunningScoreInput } from './runningScoreHtml';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 2チームの色。分析の帳票（analysisHtml.ts）の自チーム・相手と同じ組み合わせ（色覚の違いでも見分けられることを確認済み）
const COLOR: Record<Side, string> = { A: '#3f51e0', B: '#e0611b' };
const GRID = '#dde2ea';
const AXIS = '#8e97a8';
const INK = '#16203a';
const SUB = '#5a6478';

const CSS = `
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif; color: #111; font-size: 8pt; }
.sheet { width: 194mm; margin: 0 auto; }
@media screen { .sheet { padding: 3mm 0; } }
.head { border: 0.4mm solid #111; padding: 2mm 3mm; display: flex; justify-content: space-between; align-items: center; }
.head h1 { font-size: 15pt; margin: 0; letter-spacing: 0.5mm; }
.head .sub { font-size: 8pt; }
.head .info { font-size: 8pt; line-height: 1.6; text-align: right; }
.card { display: flex; align-items: center; justify-content: center; gap: 5mm; border: 0.4mm solid #111; border-top: none; padding: 2mm 3mm; }
.card .side { flex: 1; font-size: 13pt; font-weight: 700; min-width: 0; }
.card .side.a { text-align: right; }
.card .final { font-size: 19pt; font-weight: 800; }
h2 { font-size: 10pt; font-weight: 700; margin: 4mm 0 1mm; }
.note { font-size: 7pt; color: #555; font-weight: 400; margin-left: 2mm; }
.box { border: 0.2mm solid #111; padding: 2mm 3mm; }
.box svg { display: block; width: 100%; height: auto; }
.sw { display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: 0.6mm; margin: 0 1mm 0 3mm; vertical-align: -0.3mm; }
.legend { font-size: 8pt; color: #5a6478; font-weight: 400; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 0.2mm solid #111; height: 5.2mm; padding: 0 1mm; font-size: 7.5pt; text-align: center; white-space: nowrap; }
th { background: #eee; font-weight: 600; font-size: 6.5pt; height: 3.8mm; }
td.l, th.l { text-align: left; }
td.b { font-weight: 700; }
td.wrap { white-space: normal; text-align: left; line-height: 1.4; padding: 0.8mm 1mm; }
tr { page-break-inside: avoid; }
thead { display: table-header-group; }
.cols { display: flex; gap: 5mm; }
.cols > div { flex: 1; min-width: 0; }
.foot { margin-top: 4mm; font-size: 6.5pt; color: #555; line-height: 1.6; border-top: 0.2mm solid #999; padding-top: 1.5mm; }
tr.period td { background: #111; color: #fff; font-weight: 700; text-align: left; }
tr.mark td { background: #ffe8d9; font-weight: 700; }
td.time { width: 13mm; }
td.score { width: 18mm; font-weight: 700; }
td.play { width: 40%; text-align: left; }
td.play.b { text-align: left; }
`;

function teamName(input: RunningScoreInput, side: Side): string {
  return (side === 'A' ? input.game.teamAName : input.game.teamBName) || `チーム${side}`;
}

function timelineOf(input: RunningScoreInput): Timeline {
  return buildTimeline(input.events, input.game);
}

/** 経過秒を「Q2 6:10」の形にする。時計を使っていないピリオドは時刻が目安なので、ピリオドだけを出す */
function at(tl: Timeline, t: number): string {
  const p = [...tl.periods].reverse().find((x) => t > x.start || (t === x.start && x.period === 1)) ?? tl.periods[0];
  const label = periodLabel(p.period);
  return p.timed ? `${label} ${formatClock(p.start + p.length - t)}` : label;
}

/**
 * 得点の流れ（SVG）。横軸は試合の経過時間、縦軸は得点。得点が入るたびに段が上がる階段状の線を、チームごとに引く。
 * 軸は1本で0から始め、ピリオドの境目に縦線を入れる。線の右端に最終スコアを書く。
 */
function flowChart(input: RunningScoreInput, tl: Timeline): string {
  const W = 720;
  const H = 250;
  const m = { top: 12, right: 44, bottom: 24, left: 30 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const points = scoreFlow(tl);
  const last = points[points.length - 1];
  // 目盛りが 5 の倍数になるよう、上限を 20 の倍数にそろえる
  const max = Math.max(20, Math.ceil(Math.max(last.A, last.B) / 20) * 20);
  const x = (t: number) => m.left + (tl.total > 0 ? (t / tl.total) * plotW : 0);
  const y = (v: number) => m.top + plotH - (v / max) * plotH;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const v = max * f;
      return `<line x1="${m.left}" x2="${m.left + plotW}" y1="${y(v)}" y2="${y(v)}" stroke="${f === 0 ? AXIS : GRID}" stroke-width="1"/><text x="${m.left - 5}" y="${y(v) + 3.5}" font-size="10" fill="${SUB}" text-anchor="end">${v}</text>`;
    })
    .join('');
  const periods = tl.periods
    .map((p) => {
      const line =
        p.start > 0
          ? `<line x1="${x(p.start)}" x2="${x(p.start)}" y1="${m.top}" y2="${m.top + plotH}" stroke="${AXIS}" stroke-width="1" stroke-dasharray="3 3"/>`
          : '';
      return `${line}<text x="${x(p.start + p.length / 2)}" y="${H - 7}" font-size="11" font-weight="700" fill="${INK}" text-anchor="middle">${periodLabel(p.period)}${p.timed ? '' : '＊'}</text>`;
    })
    .join('');
  const path = (side: Side) => {
    let d = `M${x(0).toFixed(1)},${y(0).toFixed(1)}`;
    for (const p of points.slice(1)) d += `H${x(p.t).toFixed(1)}V${y(p[side]).toFixed(1)}`;
    return `<path d="${d}" fill="none" stroke="${COLOR[side]}" stroke-width="2" stroke-linejoin="round"/>`;
  };
  // 右端の最終スコア。近いときは重ならないよう上下にずらす
  const close = Math.abs(y(last.A) - y(last.B)) < 13;
  const endLabel = (side: Side) => {
    const other = side === 'A' ? 'B' : 'A';
    const shift = close ? (last[side] >= last[other] && !(last.A === last.B && side === 'B') ? -5 : 9) : 4;
    return `<text x="${m.left + plotW + 6}" y="${y(last[side]) + shift}" font-size="13" font-weight="800" fill="${INK}">${last[side]}</text><circle cx="${m.left + plotW}" cy="${y(last[side])}" r="3.5" fill="${COLOR[side]}" stroke="#fff" stroke-width="1.5"/>`;
  };
  const label = `得点の流れ。最終スコアは ${teamName(input, 'A')} ${last.A}、${teamName(input, 'B')} ${last.B}`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${periods}${path('A')}${path('B')}${endLabel('A')}${endLabel('B')}</svg>`;
}

function legend(input: RunningScoreInput): string {
  return `<span class="legend">${(['A', 'B'] as const)
    .map((s) => `<span class="sw" style="background:${COLOR[s]}"></span>${esc(teamName(input, s))}`)
    .join('')}</span>`;
}

function bandsTable(input: RunningScoreInput, tl: Timeline): string {
  const rows = timeBands(tl)
    .map((b) => {
      if (!b.score) return `<tr><td class="l">${esc(b.label)}</td><td>－</td><td>－</td><td>－</td></tr>`;
      const diff = b.score.A - b.score.B;
      return `<tr><td class="l">${esc(b.label)}</td><td class="b">${b.score.A}</td><td class="b">${b.score.B}</td><td>${diff > 0 ? '+' : ''}${diff}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th class="l">時間帯</th><th>${esc(teamName(input, 'A'))}</th><th>${esc(teamName(input, 'B'))}</th><th>差</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** 「Q2 6:10〜Q2 3:02」。始まりと終わりが同じ表記（時計を使っていない同じQ）なら1つにまとめる */
function span(tl: Timeline, from: number, to: number): string {
  const a = at(tl, from);
  const b = at(tl, to);
  return a === b ? a : `${a}〜${b}`;
}

function runsTable(input: RunningScoreInput, tl: Timeline): string {
  const runs = longestRuns(tl);
  const droughts = longestDroughts(tl);
  const rows = (['A', 'B'] as const)
    .map((side) => {
      const run = runs[side];
      const other = side === 'A' ? 'B' : 'A';
      const runText = run
        ? `<b>${run.points}-0</b>（${esc(span(tl, run.fromT, run.toT))}、${run.before[side]}-${run.before[other]} → ${run.after[side]}-${run.after[other]}）`
        : '－';
      const d = droughts[side];
      const droughtText = d
        ? `<b>${formatClock(d.seconds)}</b>（${esc(span(tl, d.fromT, d.toT))}）`
        : '－';
      return `<tr><td class="l b">${esc(teamName(input, side))}</td><td class="wrap">${runText}</td><td class="wrap">${droughtText}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th class="l">チーム</th><th>いちばん大きい連続得点</th><th>いちばん長い無得点</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** 5人の組み合わせ。交代を記録しているチームの分だけ出す */
function unitsTables(input: RunningScoreInput): string {
  const cfg = { ...input.game, finished: input.game.status === 'finished' };
  const numberOf = new Map(input.roster.map((r) => [r.id, r.number]));
  const tables = (['A', 'B'] as const)
    .map((side) => {
      const stats = computeUnitStats(input.events, input.roster, cfg, side);
      if (!stats || stats.units.length === 0) return '';
      const rows = stats.units
        .slice(0, 8)
        .map((u) => {
          const numbers = u.rosterIds.map((id) => numberOf.get(id) ?? '?').sort(compareNumbers);
          const pm = u.pointsFor - u.pointsAgainst;
          return `<tr><td class="l b">${numbers.map((n) => `#${esc(n)}`).join(' ')}</td><td>${stats.approximate ? '約' : ''}${formatClock(u.seconds)}</td><td>${u.pointsFor}</td><td>${u.pointsAgainst}</td><td class="b">${pm > 0 ? '+' : ''}${pm}</td></tr>`;
        })
        .join('');
      return `<div><table><thead><tr><th class="l">${esc(teamName(input, side))}</th><th>MIN</th><th>得点</th><th>失点</th><th>+/-</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    })
    .filter(Boolean);
  if (tables.length === 0) return '';
  return `<h2>コート上の組み合わせ（出場時間の長い順）</h2><div class="cols">${tables.join('')}</div>`;
}

function head(input: RunningScoreInput, heading: string, label: string): string {
  const { game } = input;
  const total = computeScore(input.events);
  return `<div class="head">
<div><h1>${heading}</h1><div class="sub">【${label}】ベンチ控え</div></div>
<div class="info">${esc(game.leagueName)}<br>開催日：${esc(game.date)}　会場：${esc(game.venue)}</div>
</div>
<div class="card"><div class="side a">${esc(teamName(input, 'A'))}</div><div class="final">${total.A} - ${total.B}</div><div class="side">${esc(teamName(input, 'B'))}</div></div>`;
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=794, user-scalable=yes">
<title>${esc(title)}</title>
<style>${CSS}</style></head>
<body><div class="sheet">${body}</div></body></html>`;
}

/**
 * 試合の流れのシート（A4縦）。得点の流れのグラフ、時間帯別の得点、連続得点・無得点、コート上の組み合わせ。
 * 時刻が要る項目は、時計を使ったピリオドの分だけ出す。
 */
export function buildGameFlowHtml(input: RunningScoreInput): string {
  const tl = timelineOf(input);
  const allTimed = tl.periods.every((p) => p.timed);
  const chartNote = allTimed ? '' : '<span class="note">＊のQは時計を使っていないため、記録の順に等間隔で並べています</span>';
  const bandNote = tl.hasTime
    ? allTimed
      ? ''
      : '<span class="note">「－」は時計を使っていないQ</span>'
    : '<span class="note">時計を使った試合で表示されます</span>';
  const body = `${head(input, 'GAME FLOW', '試合の流れ')}
<h2>得点の流れ${legend(input)}${chartNote}</h2>
<div class="box">${flowChart(input, tl)}</div>
<div class="cols"><div>
<h2>時間帯別の得点${bandNote}</h2>
${bandsTable(input, tl)}
</div><div>
<h2>連続得点と無得点</h2>
${runsTable(input, tl)}
</div></div>
${unitsTables(input)}
<div class="foot">時間は手元の時計によるものです（公式の時間ではありません）。連続得点は、相手に得点を許さずに取った点です。無得点の時間は、すべてのQで時計を使った試合で表示します。コート上の組み合わせは、先発と交代を記録したチームだけ表示します（「約」は時刻なしの交代を含む概算）。これは控えの記録であり、公式記録ではありません</div>`;
  return page(`${input.game.teamAName} vs ${input.game.teamBName} GAME FLOW`, body);
}

/**
 * プレー一覧のシート（A4縦、複数ページ）。記録を順に並べ、時計を使っていれば残り時間を付ける。
 * 得点の行にはその時点のスコアを出す。
 */
export function buildPlayByPlayHtml(input: RunningScoreInput): string {
  const tl = timelineOf(input);
  const score = { A: 0, B: 0 };
  let period = 0;
  const rows: string[] = [];
  for (const { event: e } of tl.events) {
    if (e.period !== period) {
      period = e.period;
      rows.push(`<tr class="period"><td colspan="4">${periodLabel(period)}</td></tr>`);
    }
    const time = e.clockSeconds !== null ? formatClock(e.clockSeconds) : '';
    if (e.type === 'PERIOD_END') {
      rows.push(`<tr><td class="time"></td><td colspan="3" class="b">${periodLabel(e.period)} 終了　${score.A} - ${score.B}</td></tr>`);
      continue;
    }
    if (e.type === 'MARK') {
      rows.push(`<tr class="mark"><td class="time">${time}</td><td colspan="3">要確認の印</td></tr>`);
      continue;
    }
    const pts = pointsOf(e.type);
    if (pts && e.side) score[e.side] += pts;
    // 「A #7 3P○ 6:32」から、チームと時刻を除いた部分（時刻とチームは列で示す）
    const text = esc(describeEvent({ ...e, clockSeconds: null }, input.roster).replace(/^[AB] /, ''));
    const cell = (side: Side) => `<td class="play${pts ? ' b' : ''}">${e.side === side ? text : ''}</td>`;
    rows.push(`<tr><td class="time">${time}</td>${cell('A')}<td class="score">${pts ? `${score.A} - ${score.B}` : ''}</td>${cell('B')}</tr>`);
  }
  const body = `${head(input, 'PLAY BY PLAY', 'プレー一覧')}
<h2>プレー一覧${tl.hasTime ? '' : '<span class="note">時計を使っていないため、時間は空欄です</span>'}</h2>
<table><thead><tr><th>残り時間</th><th>${esc(teamName(input, 'A'))}</th><th>スコア</th><th>${esc(teamName(input, 'B'))}</th></tr></thead><tbody>${rows.join('') || `<tr><td colspan="4">記録がありません</td></tr>`}</tbody></table>
<div class="foot">時間は手元の時計によるものです（公式の時間ではありません）。2P・3P・FT の ○ は成功、× は失敗。F( ) はファウルの種類とフリースロー数。OR／DR：リバウンド、AST：アシスト、STL：スティール、BLK：ブロック、TOV：ターンオーバー、TO：タイムアウト、IN／OUT：交代。これは控えの記録であり、公式記録ではありません</div>`;
  return page(`${input.game.teamAName} vs ${input.game.teamBName} PLAY BY PLAY`, body);
}
