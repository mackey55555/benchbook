import {
  STAT_COLUMNS,
  TEAM_STAT_COLUMNS,
  formatStat,
  pct,
  perGame,
  statColumn,
  statValue,
  type PlayerAnalysis,
  type StatLine,
  type StatColumn,
  STAT_MODE_LABELS,
  type StatMode,
  type TeamAnalysis,
} from '@/domain/analysis';
import { formatClock } from '@/domain/lineup';
import { periodLabel } from '@/domain/rules';
import type { BoxScoreLine } from '@/domain/stats';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const OWN = '#3f51e0';
const OPP = '#e0611b';
const RESULT = { win: '勝', lose: '負', draw: '分' } as const;
const MODE_LABEL = STAT_MODE_LABELS;

const CSS = `
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif; color: #111; font-size: 8pt; }
.sheet { width: 194mm; margin: 0 auto; }
.sheet + .sheet { page-break-before: always; }
tr, .box, .tile { page-break-inside: avoid; }
@media screen { .sheet { padding: 4mm 0; } }
.head { border: 0.4mm solid #111; padding: 2mm 3mm; display: flex; justify-content: space-between; align-items: center; }
.head h1 { font-size: 15pt; margin: 0; letter-spacing: 0.5mm; }
.head .sub { font-size: 8pt; }
.head .info { font-size: 8pt; line-height: 1.6; text-align: right; }
h2 { font-size: 10pt; font-weight: 700; margin: 4mm 0 1mm; }
.tiles { display: flex; gap: 3mm; margin-top: 4mm; }
.tile { flex: 1; border: 0.3mm solid #111; padding: 2mm 3mm; }
.tile .l { font-size: 8pt; color: #5a6478; }
.tile .v { font-size: 17pt; font-weight: 700; }
.tile .s { font-size: 8pt; color: #5a6478; }
/* 表は、試合ごとのボックススコアのシート（boxScoreHtml.ts）と同じ書式にする */
table { width: 100%; border-collapse: collapse; }
th, td { border: 0.2mm solid #111; height: 5.2mm; padding: 0 1mm; font-size: 7.5pt; text-align: center; white-space: nowrap; }
th { background: #eee; font-weight: 600; font-size: 6.5pt; height: 3.8mm; }
td.l, th.l { text-align: left; }
td.b, td.no, td.pts { font-weight: 700; }
td.pct { font-size: 6.5pt; }
th.sort { background: #111; color: #fff; }
td.sortv { font-weight: 700; background: #ffe8d9; }
tr.total td { font-weight: 700; background: #f4f4f4; border-top: 0.4mm solid #111; }
.cols { display: flex; gap: 5mm; }
.cols > div { flex: 1; min-width: 0; }
.box { border: 0.2mm solid #111; padding: 2mm 3mm; }
.box svg { display: block; width: 100%; height: auto; }
.legend { font-size: 8pt; color: #5a6478; font-weight: 400; }
.sw { display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: 0.6mm; margin: 0 1mm 0 3mm; vertical-align: -0.3mm; }
.hero { display: flex; align-items: center; gap: 5mm; margin-top: 4mm; }
.hero .no { font-size: 34pt; font-weight: 800; line-height: 1; }
.hero .name { font-size: 15pt; font-weight: 700; }
.foot { margin-top: 4mm; font-size: 6.5pt; color: #555; line-height: 1.6; border-top: 0.2mm solid #999; padding-top: 1.5mm; }
`;

/** シート1枚分（見出し・本文・注記）。複数つなげると、PDFではシートごとに改ページする */
interface Sheet {
  /** ファイルやページの題名 */
  title: string;
  /** 見出しの英字（BOXSCORE と同じ書式） */
  heading: string;
  /** 見出しの下の和文（チーム成績など） */
  label: string;
  /** 見出しの右に出す情報（行ごと。エスケープ前） */
  info: string[];
  body: string;
  /** シート下部の凡例（エスケープ済み） */
  legend?: string;
}

function sheetHtml(s: Sheet): string {
  return `<div class="sheet">
<div class="head">
<div><h1>${esc(s.heading)}</h1><div class="sub">【${esc(s.label)}】ベンチ控え</div></div>
<div class="info">${s.info.map(esc).join('<br>')}</div>
</div>
${s.body}
<div class="foot">${s.legend ? `${s.legend}<br>` : ''}成功率は期間全体の成功数÷試投数です。これは控えの記録を集計したものであり、公式記録ではありません</div>
</div>`;
}

function page(title: string, sheets: Sheet[]): string {
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=794, user-scalable=yes">
<title>${esc(title)}</title>
<style>${CSS}</style></head>
<body>${sheets.map(sheetHtml).join('\n')}</body></html>`;
}

const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const one = (v: number) => v.toFixed(1);

const GRID = '#dde2ea';
const AXIS = '#8e97a8';
const INKC = '#16203a';
const SUBC = '#5a6478';

/** 軸の上限を、きりのよい数に切り上げる */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const base = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * base >= value) return step * base;
  return 10 * base;
}

interface BarGroup {
  label: string;
  own: number;
  /** 省くと自チームだけの1系列になる */
  opp?: number;
}

/**
 * 縦棒グラフ（SVG）。印刷では背景色が出ないことがあるため、棒は図形として描く。
 * 軸は0から始め、目盛り線と、棒の上の数値を出す。
 */
function barChart(groups: BarGroup[], o: { width?: number; height?: number; format?: (v: number) => string } = {}): string {
  const { width = 720, height = 220, format = (v: number) => String(v) } = o;
  const left = 34;
  const top = 16;
  const bottom = 22;
  const plotW = width - left - 6;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(1, ...groups.flatMap((g) => [g.own, g.opp ?? 0])));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const slot = plotW / Math.max(1, groups.length);
  const two = groups.some((g) => g.opp !== undefined);
  const barW = Math.min(26, (slot * 0.72) / (two ? 2 : 1));
  const showValues = slot >= (two ? 44 : 24);
  const fontSize = slot >= 60 ? 11 : 9;
  const labelEvery = slot >= 32 ? 1 : slot >= 16 ? 2 : 3;
  const bar = (x: number, v: number, color: string) => {
    const h = Math.max(v > 0 ? 1.5 : 0, (v / max) * plotH);
    const value = showValues
      ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(y(v) - 3).toFixed(1)}" font-size="${fontSize}" font-weight="700" fill="${INKC}" text-anchor="middle">${format(v)}</text>`
      : '';
    return `<rect x="${x.toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}"/>${value}`;
  };
  const grid = ticks
    .map(
      (t) =>
        `<line x1="${left}" x2="${width - 6}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${t === 0 ? AXIS : GRID}" stroke-width="${t === 0 ? 1.2 : 1}"/>` +
        `<text x="${left - 5}" y="${(y(t) + 3.5).toFixed(1)}" font-size="10" fill="${SUBC}" text-anchor="end">${format(t)}</text>`,
    )
    .join('');
  const marks = groups
    .map((g, i) => {
      const cx = left + slot * i + slot / 2;
      const gap = two ? 2 : 0;
      const x0 = two ? cx - barW - gap / 2 : cx - barW / 2;
      return (
        bar(x0, g.own, OWN) +
        (g.opp !== undefined ? bar(x0 + barW + gap, g.opp, OPP) : '') +
        // 幅が足りないときは、ラベルを1つおきに出して重なりを避ける
        (labelEvery === 1 || i % labelEvery === 0
          ? `<text x="${cx.toFixed(1)}" y="${height - 6}" font-size="10" fill="${SUBC}" text-anchor="middle">${esc(g.label)}</text>`
          : '')
      );
    })
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img">${grid}${marks}</svg>`;
}

interface RateRow {
  label: string;
  own: number | null;
  ownText: string;
  opp?: number | null;
  oppText?: string;
}

/** 成功率などの横棒（0〜100%）。自チームと相手を上下に並べる */
function rateChart(rows: RateRow[], width = 720): string {
  const left = 96;
  const right = 150;
  const trackW = width - left - right;
  const rowH = rows.some((r) => r.opp !== undefined) ? 44 : 28;
  const height = rows.length * rowH + 4;
  const line = (yy: number, v: number | null, text: string, color: string) =>
    `<rect x="${left}" y="${yy}" width="${trackW}" height="12" rx="3" fill="#e3e7ee"/>` +
    (v !== null && v > 0 ? `<rect x="${left}" y="${yy}" width="${((Math.min(100, v) / 100) * trackW).toFixed(1)}" height="12" rx="3" fill="${color}"/>` : '') +
    `<text x="${left + trackW + 8}" y="${yy + 10.5}" font-size="11" font-weight="700" fill="${INKC}">${esc(text)}</text>`;
  const body = rows
    .map((r, i) => {
      const y0 = i * rowH + 6;
      return (
        `<text x="0" y="${y0 + 11}" font-size="12" font-weight="700" fill="${INKC}">${esc(r.label)}</text>` +
        line(y0, r.own, r.ownText, OWN) +
        (r.opp !== undefined ? line(y0 + 16, r.opp, r.oppText ?? '', OPP) : '')
      );
    })
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img">${body}</svg>`;
}

/** 項目の多い順の横棒（選手の比較用） */
function rankChart(rows: { label: string; value: number; text: string }[], width = 720): string {
  const left = 150;
  const right = 60;
  const trackW = width - left - right;
  const rowH = 20;
  const max = Math.max(0.0001, ...rows.map((r) => r.value));
  const body = rows
    .map((r, i) => {
      const y0 = i * rowH + 4;
      const w = (Math.max(0, r.value) / max) * trackW;
      return (
        `<text x="${left - 8}" y="${y0 + 11}" font-size="11" fill="${INKC}" text-anchor="end">${esc(r.label)}</text>` +
        `<rect x="${left}" y="${y0}" width="${trackW}" height="13" rx="3" fill="#eef1f5"/>` +
        (w > 0 ? `<rect x="${left}" y="${y0}" width="${w.toFixed(1)}" height="13" rx="3" fill="${OWN}"/>` : '') +
        `<text x="${left + trackW + 8}" y="${y0 + 11}" font-size="11" font-weight="700" fill="${INKC}">${esc(r.text)}</text>`
      );
    })
    .join('');
  return `<svg viewBox="0 0 ${width} ${rows.length * rowH + 6}" xmlns="http://www.w3.org/2000/svg" role="img">${body}</svg>`;
}

const LEGEND = `<span class="legend"><span class="sw" style="background:${OWN}"></span>自チーム<span class="sw" style="background:${OPP}"></span>相手</span>`;

const SHOT_ROWS = [
  { label: '2点', made: 'fg2m', att: 'fg2a' },
  { label: '3点', made: 'fg3m', att: 'fg3a' },
  { label: 'フリースロー', made: 'ftm', att: 'fta' },
] as const;

function rateText(line: BoxScoreLine, made: 'fg2m' | 'fg3m' | 'ftm', att: 'fg2a' | 'fg3a' | 'fta'): string {
  const p = pct(line[made], line[att]);
  return `${p === null ? '-' : `${Math.round(p)}%`}（${line[made]}/${line[att]}本）`;
}

/**
 * 成績の列の見出し。ボックススコアのシートと同じく、3P・2P・FT・リバウンドは2段にまとめる。
 * lead は項目の前に置く見出し（「#」「選手」など）で、2段ぶんの高さにする。
 */
function statHead(lead: string[], cols: readonly StatColumn[], sortKey?: string): string {
  let top = '';
  let bottom = '';
  for (let i = 0; i < cols.length; ) {
    const c = cols[i];
    if (!c.group) {
      top += `<th rowspan="2" class="${c.key === sortKey ? 'sort' : ''}">${c.label}</th>`;
      i++;
      continue;
    }
    let n = 0;
    while (i + n < cols.length && cols[i + n].group === c.group) {
      const g = cols[i + n];
      bottom += `<th class="${g.key === sortKey ? 'sort' : ''}">${g.sub ?? g.label}</th>`;
      n++;
    }
    top += `<th colspan="${n}" class="c">${c.group}</th>`;
    i += n;
  }
  return `<thead><tr>${lead.join('')}${top}</tr><tr>${bottom}</tr></thead>`;
}

/** 表のマスの値。ボックススコアのシートに合わせ、成功率は小数1桁、値が無いときは空欄にする */
function cell(c: StatColumn, line: StatLine, games: number, mode: StatMode): string {
  const v = statValue(c, line, games, mode);
  if (v === null) return '';
  return c.kind === 'pct' ? `${v.toFixed(1)}%` : formatStat(c, v, mode);
}

/** 列の種類に応じたマスの書式（得点は太字、成功率は小さめ、並び順の列は色つき） */
function cellClass(c: StatColumn, sortKey?: string): string {
  return [c.key === 'pts' ? 'pts' : '', c.kind === 'pct' ? 'pct' : '', c.key === sortKey ? 'sortv' : ''].filter(Boolean).join(' ');
}

const STAT_LEGEND =
  'PTS：得点　3P／2P FG：3点／2点シュート　FT：フリースロー　M：成功　A：試投　%：成功率　F：ファウル　OR／DR／TR：オフェンス／ディフェンス／トータルリバウンド　TO：ターンオーバー　AS：アシスト　ST：スティール　BS：ブロック';
const LINEUP_LEGEND =
  '40分換算：出場時間のある試合の成績を、40分あたりに直した値（出場時間が5分未満の選手は出しません）　試合：出場登録された試合の数　MIN：出場時間　+/-：出場中の得失点差（MIN と +/- は、先発と交代を記録した試合の分だけを集計）';

export interface ReportOptions {
  /** 期間の表示名（「今年度」など） */
  rangeLabel: string;
  mode: StatMode;
}

/** チーム分析の1枚。戦績、得点の推移、Q別平均、全項目、試合一覧 */
export function buildTeamReportHtml(a: TeamAnalysis, o: ReportOptions): string {
  const sheet = teamSheet(a, o);
  return page(sheet.title, [sheet]);
}

/** 時間帯別の平均得点と、5人の組み合わせ。どちらも対象の試合があるときだけ出す */
function timeSections(a: TeamAnalysis): string {
  const round = (v: number) => Math.round(v * 10) / 10;
  const bands =
    a.timedGames > 0
      ? `<h2>時間帯別の平均得点（時計を使った${a.timedGames}試合）${LEGEND}</h2>
<div class="box">${barChart(
          a.bands.map((b) => ({
            label: b.label.replace(' 前半', '前').replace(' 後半', '後').replace(' 残り2分', '終盤'),
            own: round(b.own / a.timedGames),
            opp: round(b.opp / a.timedGames),
          })),
          { height: 190, format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) },
        )}</div>
<div class="legend">各Qを前半・後半に分けた、1試合あたりの得点。「Q4終盤」は残り2分（Q4後の内数）。手元の時計による</div>`
      : '';
  const units =
    a.units.length > 0
      ? `<h2>5人の組み合わせ（出場時間の長い順・期間の合計）</h2>
<table><thead><tr><th class="l">コート上の5人</th><th>試合</th><th>MIN</th><th>得点</th><th>失点</th><th>+/-</th></tr></thead><tbody>
${a.units
  .slice(0, 8)
  .map((u) => {
    const pm = u.pointsFor - u.pointsAgainst;
    return `<tr><td class="l b">${u.numbers.map((n) => `#${esc(n)}`).join(' ')}</td><td>${u.games}</td><td>${u.approximate ? '約' : ''}${formatClock(u.seconds)}</td><td>${u.pointsFor}</td><td>${u.pointsAgainst}</td><td class="b">${pm > 0 ? '+' : ''}${pm}</td></tr>`;
  })
  .join('')}
</tbody></table>`
      : '';
  return bands + units;
}

function teamSheet(a: TeamAnalysis, o: ReportOptions): Sheet {
  const n = a.games;
  const avgFor = perGame(a.own.pts, n);
  const avgAgainst = perGame(a.opp.pts, n);
  const diff = avgFor - avgAgainst;
  const trend = a.trend.slice(-20);
  // チームには40分換算が無いので、1試合平均で出す
  const teamMode: StatMode = o.mode === 'per40' ? 'avg' : o.mode;
  const body = `
<div class="tiles">
<div class="tile"><div class="l">戦績</div><div class="v">${a.wins}勝 ${a.losses}敗${a.draws > 0 ? ` ${a.draws}分` : ''}</div><div class="s">${n}試合</div></div>
<div class="tile"><div class="l">平均得点</div><div class="v">${one(avgFor)}</div><div class="s">失点 ${one(avgAgainst)}</div></div>
<div class="tile"><div class="l">得失点差</div><div class="v">${diff > 0 ? '+' : ''}${one(diff)}</div><div class="s">1試合あたり</div></div>
</div>
<h2>得点の推移（${trend.length < n ? `直近${trend.length}試合` : `全${n}試合`}・古い順）${LEGEND}</h2>
<div class="box">${barChart(trend.map((t) => ({ label: shortDate(t.date), own: t.own, opp: t.opp })))}</div>
<div class="cols"><div>
<h2>Q別の平均得点${LEGEND}</h2>
<div class="box">${barChart(
    a.periods.map((p) => ({ label: periodLabel(p.period), own: Math.round(p.own * 10) / 10, opp: Math.round(p.opp * 10) / 10 })),
    { width: 350, height: 200, format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) },
  )}</div>
</div><div>
<h2>シュート成功率${LEGEND}</h2>
<div class="box">${rateChart(
    SHOT_ROWS.map((r) => ({
      label: r.label,
      own: pct(a.own[r.made], a.own[r.att]),
      ownText: rateText(a.own, r.made, r.att),
      opp: pct(a.opp[r.made], a.opp[r.att]),
      oppText: rateText(a.opp, r.made, r.att),
    })),
    350,
  )}</div>
</div></div>
${timeSections(a)}
<h2>チーム成績（${MODE_LABEL[teamMode]}）</h2>
<table>${statHead(['<th rowspan="2"></th>'], TEAM_STAT_COLUMNS)}<tbody>
<tr><td class="b">自チーム</td>${TEAM_STAT_COLUMNS.map((c) => `<td class="${cellClass(c)}">${cell(c, a.own, n, teamMode)}</td>`).join('')}</tr>
<tr><td class="b">相手</td>${TEAM_STAT_COLUMNS.map((c) => `<td class="${cellClass(c)}">${cell(c, a.opp, n, teamMode)}</td>`).join('')}</tr>
</tbody></table>
<h2>試合ごとの成績（新しい順）</h2>
<table>${statHead(['<th rowspan="2">日付</th>', '<th rowspan="2">相手</th>', '<th rowspan="2">結果</th>', '<th rowspan="2">失点</th>'], TEAM_STAT_COLUMNS)}<tbody>
${[...a.trend]
  .reverse()
  .map(
    (t) =>
      `<tr><td class="l">${esc(t.date)}</td><td class="l">${esc(t.opponent)}</td><td>${RESULT[t.result]}</td><td>${t.opp}</td>${TEAM_STAT_COLUMNS.map((c) => `<td class="${cellClass(c)}">${cell(c, t.ownLine, 1, 'total')}</td>`).join('')}</tr>`,
  )
  .join('')}
</tbody></table>`;
  return {
    title: `${a.teamName || '自チーム'} チーム成績`,
    heading: 'TEAM STATS',
    label: 'チーム成績',
    info: [a.teamName || '自チーム', `期間：${o.rangeLabel}　試合数：${n}`],
    body,
    legend: STAT_LEGEND,
  };
}

/** 選手の比較表。sortKey の多い順に並べる */
export function buildPlayersReportHtml(a: TeamAnalysis, o: ReportOptions & { sortKey: string }): string {
  const sheet = playersSheet(a, o);
  return page(sheet.title, [sheet]);
}

function sortedPlayers(a: TeamAnalysis, o: ReportOptions & { sortKey: string }): PlayerAnalysis[] {
  const sortCol = statColumn(o.sortKey);
  const value = (p: PlayerAnalysis) => statValue(sortCol, p.line, p.games, o.mode) ?? -1;
  return [...a.players].sort((x, y) => value(y) - value(x) || y.line.pts - x.line.pts);
}

function playersSheet(a: TeamAnalysis, o: ReportOptions & { sortKey: string }): Sheet {
  const sortCol = statColumn(o.sortKey);
  const players = sortedPlayers(a, o);
  const ranked = players
    .map((p) => ({ p, v: statValue(sortCol, p.line, p.games, o.mode) }))
    .filter((r) => r.v !== null && r.v > 0)
    .slice(0, 12);
  const body = `
<h2>${esc(sortCol.name)}の多い順（${MODE_LABEL[o.mode]}）</h2>
<div class="box">${
    ranked.length > 0
      ? rankChart(ranked.map((r) => ({ label: `#${r.p.number} ${r.p.name}`.trim(), value: r.v ?? 0, text: formatStat(sortCol, r.v, o.mode) })))
      : '<div class="legend">記録がありません</div>'
  }</div>
<h2>選手別（${MODE_LABEL[o.mode]}・${esc(sortCol.name)}の多い順）</h2>
<table class="wide">${statHead(['<th rowspan="2" class="c">No.</th>', '<th rowspan="2">Player</th>', '<th rowspan="2">試合</th>'], STAT_COLUMNS, sortCol.key)}<tbody>
${players
  .map(
    (p) =>
      `<tr><td class="no">${esc(p.number)}</td><td class="l">${esc(p.name)}</td><td>${p.games}</td>${STAT_COLUMNS.map((c) => `<td class="${cellClass(c, sortCol.key)}">${cell(c, p.line, p.games, o.mode)}</td>`).join('')}</tr>`,
  )
  .join('')}
<tr class="total"><td colspan="2">合計</td><td>${a.games}</td>${STAT_COLUMNS.map((c) => `<td class="${c.kind === 'pct' ? 'pct' : ''}">${cell(c, a.own, a.games, o.mode)}</td>`).join('')}</tr>
</tbody></table>`;
  return {
    title: `${a.teamName || '自チーム'} 選手成績`,
    heading: 'PLAYER STATS',
    label: '選手成績',
    info: [a.teamName || '自チーム', `期間：${o.rangeLabel}　試合数：${a.games}`],
    body,
    legend: `${STAT_LEGEND}<br>${LINEUP_LEGEND}`,
  };
}

/** 選手1人のまとめ。合計と平均、得点の推移、試合ごとの成績 */
export function buildPlayerReportHtml(p: PlayerAnalysis, o: { rangeLabel: string; teamName: string }): string {
  const sheet = playerSheet(p, o);
  return page(sheet.title, [sheet]);
}

function playerSheet(p: PlayerAnalysis, o: { rangeLabel: string; teamName: string }): Sheet {
  const counts = STAT_COLUMNS.filter((c) => c.kind !== 'pct');
  const trend = p.log.slice(-20);
  const row = (label: string, mode: StatMode) =>
    `<tr><td class="b">${label}</td>${STAT_COLUMNS.map((c) => `<td class="${cellClass(c)}">${cell(c, p.line, p.games, mode)}</td>`).join('')}</tr>`;
  const body = `
<div class="hero"><div class="no">${esc(p.number)}</div><div><div class="name">${esc(p.name || '名前なし')}</div><div class="legend">${esc(o.teamName || '自チーム')}・${esc(o.rangeLabel)}・${p.games}試合</div></div></div>
<div class="tiles">
${['pts', 'reb', 'ast']
  .map((k) => {
    const c = statColumn(k);
    return `<div class="tile"><div class="l">${esc(c.name)}（1試合平均）</div><div class="v">${one(perGame(c.get(p.line) ?? 0, p.games))}</div><div class="s">合計 ${c.get(p.line)}</div></div>`;
  })
  .join('')}
</div>
<div class="cols"><div>
<h2>得点の推移（${trend.length < p.games ? `直近${trend.length}試合` : `全${p.games}試合`}・古い順）</h2>
<div class="box">${barChart(trend.map((t) => ({ label: shortDate(t.date), own: t.line.pts })), { width: 350, height: 200 })}</div>
</div><div>
<h2>シュート成功率</h2>
<div class="box">${rateChart(
    SHOT_ROWS.map((r) => ({ label: r.label, own: pct(p.line[r.made], p.line[r.att]), ownText: rateText(p.line, r.made, r.att) })),
    350,
  )}</div>
</div></div>
<h2>成績</h2>
<table class="wide">${statHead(['<th rowspan="2" class="l"></th>'], STAT_COLUMNS)}<tbody>
${row('合計', 'total')}${row('平均', 'avg')}${p.line.lineupGames ? row('40分換算', 'per40') : ''}</tbody></table>
<h2>試合ごとの成績（新しい順）</h2>
<table class="wide">${statHead(['<th rowspan="2">日付</th>', '<th rowspan="2">相手</th>', '<th rowspan="2">結果</th>'], counts)}<tbody>
${[...p.log]
  .reverse()
  .map(
    (g) =>
      `<tr><td class="l">${esc(g.date)}</td><td class="l">${esc(g.opponent)}</td><td class="c">${RESULT[g.result]}</td>${counts.map((c) => `<td class="${cellClass(c)}">${cell(c, g.line, 1, 'total')}</td>`).join('')}</tr>`,
  )
  .join('')}
</tbody></table>`;
  return {
    title: `#${p.number} ${p.name} 選手成績`.replace(/\s+/g, ' ').trim(),
    heading: 'PLAYER STATS',
    label: '選手成績',
    info: [o.teamName || '自チーム', `期間：${o.rangeLabel}　試合数：${p.games}`],
    body,
    legend: `${STAT_LEGEND}<br>${LINEUP_LEGEND}`,
  };
}

/**
 * 期間の全内容を1つにまとめる。チーム成績、選手の比較表、選手1人ずつのまとめの順で、
 * PDFではシートごとに改ページする。記録が1つも無い選手のまとめは省く。
 */
export function buildFullReportHtml(a: TeamAnalysis, o: ReportOptions & { sortKey: string }): string {
  const active = sortedPlayers(a, o).filter((p) => STAT_COLUMNS.some((c) => (c.get(p.line) ?? 0) > 0));
  return page(`${a.teamName || '自チーム'} 成績まとめ`, [
    teamSheet(a, o),
    playersSheet(a, o),
    ...active.map((p) => playerSheet(p, { rangeLabel: o.rangeLabel, teamName: a.teamName })),
  ]);
}
