import {
  STAT_COLUMNS,
  formatStat,
  perGame,
  statColumn,
  statValue,
  type PlayerAnalysis,
  type StatColumn,
  type StatMode,
  type TeamAnalysis,
} from '@/domain/analysis';
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
const MODE_LABEL: Record<StatMode, string> = { avg: '1試合平均', total: '合計' };

const CSS = `
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif; color: #16203a; font-size: 9pt; }
.sheet { width: 194mm; margin: 0 auto; }
.sheet + .sheet { page-break-before: always; }
tr { page-break-inside: avoid; }
@media screen { .sheet { padding: 4mm 0; } }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 0.6mm solid #16203a; padding-bottom: 2mm; }
h1 { font-size: 16pt; margin: 0; }
.sub { font-size: 9pt; color: #5a6478; text-align: right; }
h2 { font-size: 10.5pt; margin: 5mm 0 1.5mm; }
.tiles { display: flex; gap: 3mm; margin-top: 4mm; }
.tile { flex: 1; border: 0.3mm solid #dde2ea; border-radius: 2mm; padding: 2mm 3mm; }
.tile .l { font-size: 8pt; color: #5a6478; }
.tile .v { font-size: 17pt; font-weight: 700; }
.tile .s { font-size: 8pt; color: #5a6478; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 0.2mm solid #dde2ea; padding: 1mm 0.8mm; text-align: right; white-space: nowrap; }
th { font-size: 7.5pt; color: #5a6478; background: #f2f4f8; font-weight: 700; }
td.l, th.l { text-align: left; }
td.b { font-weight: 700; }
th.sort { background: #16203a; color: #fff; }
.cols { display: flex; gap: 6mm; }
.cols > div { flex: 1; }
.chart { display: flex; align-items: flex-end; gap: 1.5mm; height: 34mm; border-bottom: 0.3mm solid #aab2c0; }
.g { flex: 1; display: flex; align-items: flex-end; justify-content: center; gap: 0.5mm; height: 100%; }
.bar { width: 3.2mm; border-radius: 1mm 1mm 0 0; }
.labels { display: flex; gap: 1.5mm; }
.labels div { flex: 1; text-align: center; font-size: 6.5pt; color: #5a6478; }
.legend { font-size: 8pt; color: #5a6478; }
.sw { display: inline-block; width: 2.4mm; height: 2.4mm; border-radius: 0.6mm; margin: 0 1mm 0 3mm; }
.hero { display: flex; align-items: center; gap: 5mm; margin-top: 4mm; }
.hero .no { font-size: 34pt; font-weight: 800; line-height: 1; }
.hero .name { font-size: 15pt; font-weight: 700; }
.foot { margin-top: 4mm; font-size: 7.5pt; color: #5a6478; }
`;

/** シート1枚分（見出し・本文・注記）。複数つなげると、PDFではシートごとに改ページする */
interface Sheet {
  title: string;
  /** 見出しの右に出す補足（エスケープ済み） */
  sub: string;
  body: string;
}

function sheetHtml(s: Sheet): string {
  return `<div class="sheet">
<div class="head"><h1>${esc(s.title)}</h1><div class="sub">${s.sub}</div></div>
${s.body}
<div class="foot">Benchbook で記録した控えの記録を集計したものです。公式記録ではありません。成功率は期間全体の成功数÷試投数です</div>
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

function bars(groups: { label: string; own: number; opp?: number }[]): string {
  const max = Math.max(1, ...groups.flatMap((g) => [g.own, g.opp ?? 0]));
  const bar = (v: number, color: string) =>
    `<div class="bar" style="height:${((v / max) * 100).toFixed(1)}%;background:${color}"></div>`;
  return `<div class="chart">${groups
    .map((g) => `<div class="g">${bar(g.own, OWN)}${g.opp !== undefined ? bar(g.opp, OPP) : ''}</div>`)
    .join('')}</div><div class="labels">${groups.map((g) => `<div>${esc(g.label)}</div>`).join('')}</div>`;
}

const LEGEND = `<span class="legend"><span class="sw" style="background:${OWN}"></span>自チーム<span class="sw" style="background:${OPP}"></span>相手</span>`;

function cell(c: StatColumn, line: BoxScoreLine, games: number, mode: StatMode): string {
  return formatStat(c, statValue(c, line, games, mode), mode);
}

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

function teamSheet(a: TeamAnalysis, o: ReportOptions): Sheet {
  const n = a.games;
  const avgFor = perGame(a.own.pts, n);
  const avgAgainst = perGame(a.opp.pts, n);
  const diff = avgFor - avgAgainst;
  const trend = a.trend.slice(-20);
  const half = Math.ceil(STAT_COLUMNS.length / 2);
  const statTable = (cols: readonly StatColumn[]) =>
    `<table><tr><th class="l">項目</th><th>自チーム</th><th>相手</th></tr>${cols
      .map((c) => `<tr><td class="l">${esc(c.name)}</td><td class="b">${cell(c, a.own, n, o.mode)}</td><td>${cell(c, a.opp, n, o.mode)}</td></tr>`)
      .join('')}</table>`;
  const body = `
<div class="tiles">
<div class="tile"><div class="l">戦績</div><div class="v">${a.wins}勝 ${a.losses}敗${a.draws > 0 ? ` ${a.draws}分` : ''}</div><div class="s">${n}試合</div></div>
<div class="tile"><div class="l">平均得点</div><div class="v">${one(avgFor)}</div><div class="s">失点 ${one(avgAgainst)}</div></div>
<div class="tile"><div class="l">得失点差</div><div class="v">${diff > 0 ? '+' : ''}${one(diff)}</div><div class="s">1試合あたり</div></div>
</div>
<h2>得点の推移（${trend.length < n ? `直近${trend.length}試合` : `全${n}試合`}）${LEGEND}</h2>
${bars(trend.map((t) => ({ label: shortDate(t.date), own: t.own, opp: t.opp })))}
<div class="cols"><div>
<h2>Q別の平均得点</h2>
<table><tr><th class="l"></th>${a.periods.map((p) => `<th>${periodLabel(p.period)}</th>`).join('')}</tr>
<tr><td class="l">自チーム</td>${a.periods.map((p) => `<td class="b">${one(p.own)}</td>`).join('')}</tr>
<tr><td class="l">相手</td>${a.periods.map((p) => `<td>${one(p.opp)}</td>`).join('')}</tr></table>
</div><div></div></div>
<h2>全項目（${MODE_LABEL[o.mode]}）</h2>
<div class="cols"><div>${statTable(STAT_COLUMNS.slice(0, half))}</div><div>${statTable(STAT_COLUMNS.slice(half))}</div></div>
<h2>試合一覧</h2>
<table><tr><th class="l">日付</th><th class="l">相手</th><th>結果</th><th>得点</th><th>失点</th>${['reb', 'ast', 'stl', 'blk', 'tov', 'pf'].map((k) => `<th>${statColumn(k).label}</th>`).join('')}</tr>
${[...a.trend]
  .reverse()
  .map(
    (t) =>
      `<tr><td class="l">${esc(t.date)}</td><td class="l">${esc(t.opponent)}</td><td>${RESULT[t.result]}</td><td class="b">${t.own}</td><td>${t.opp}</td>${['reb', 'ast', 'stl', 'blk', 'tov', 'pf'].map((k) => `<td>${statColumn(k).get(t.ownLine)}</td>`).join('')}</tr>`,
  )
  .join('')}
</table>`;
  return { title: `${a.teamName || '自チーム'} チーム成績`, sub: `${esc(o.rangeLabel)}・${n}試合`, body };
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
  const body = `
<h2>選手別（${MODE_LABEL[o.mode]}・${esc(sortCol.name)}の多い順）</h2>
<table><tr><th>#</th><th class="l">選手</th><th>試合</th>${STAT_COLUMNS.map((c) => `<th class="${c.key === sortCol.key ? 'sort' : ''}">${c.label}</th>`).join('')}</tr>
${players
  .map(
    (p) =>
      `<tr><td class="b">${esc(p.number)}</td><td class="l">${esc(p.name)}</td><td>${p.games}</td>${STAT_COLUMNS.map((c) => `<td class="${c.key === sortCol.key ? 'b' : ''}">${cell(c, p.line, p.games, o.mode)}</td>`).join('')}</tr>`,
  )
  .join('')}
<tr><td></td><td class="l b">チーム</td><td>${a.games}</td>${STAT_COLUMNS.map((c) => `<td class="b">${cell(c, a.own, a.games, o.mode)}</td>`).join('')}</tr>
</table>
<div class="foot">試合数は出場登録された試合の数です。${STAT_COLUMNS.filter((c) => c.kind === 'count')
    .map((c) => `${c.label}：${c.name}`)
    .join('　')}</div>`;
  return { title: `${a.teamName || '自チーム'} 選手成績`, sub: `${esc(o.rangeLabel)}・${a.games}試合`, body };
}

/** 選手1人のまとめ。合計と平均、得点の推移、試合ごとの成績 */
export function buildPlayerReportHtml(p: PlayerAnalysis, o: { rangeLabel: string; teamName: string }): string {
  const sheet = playerSheet(p, o);
  return page(sheet.title, [sheet]);
}

function playerSheet(p: PlayerAnalysis, o: { rangeLabel: string; teamName: string }): Sheet {
  const counts = STAT_COLUMNS.filter((c) => c.kind === 'count');
  const trend = p.log.slice(-20);
  const row = (label: string, mode: StatMode) =>
    `<tr><td class="l b">${label}</td>${STAT_COLUMNS.map((c) => `<td>${cell(c, p.line, p.games, mode)}</td>`).join('')}</tr>`;
  const body = `
<div class="hero"><div class="no">${esc(p.number)}</div><div><div class="name">${esc(p.name || '名前なし')}</div><div class="legend">${esc(o.teamName || '自チーム')}・${esc(o.rangeLabel)}・${p.games}試合</div></div></div>
<div class="tiles">
${['pts', 'reb', 'ast']
  .map((k) => {
    const c = statColumn(k);
    return `<div class="tile"><div class="l">${esc(c.name)}</div><div class="v">${one(perGame(c.get(p.line) ?? 0, p.games))}</div><div class="s">計 ${c.get(p.line)}</div></div>`;
  })
  .join('')}
</div>
<h2>成績</h2>
<table><tr><th class="l"></th>${STAT_COLUMNS.map((c) => `<th>${c.label}</th>`).join('')}</tr>
${row('合計', 'total')}${row('平均', 'avg')}</table>
<h2>得点の推移（${trend.length < p.games ? `直近${trend.length}試合` : `全${p.games}試合`}）</h2>
${bars(trend.map((t) => ({ label: shortDate(t.date), own: t.line.pts })))}
<h2>試合ごとの成績</h2>
<table><tr><th class="l">日付</th><th class="l">相手</th><th>結果</th>${counts.map((c) => `<th>${c.label}</th>`).join('')}</tr>
${[...p.log]
  .reverse()
  .map(
    (g) =>
      `<tr><td class="l">${esc(g.date)}</td><td class="l">${esc(g.opponent)}</td><td>${RESULT[g.result]}</td>${counts.map((c) => `<td class="${c.key === 'pts' ? 'b' : ''}">${c.get(g.line)}</td>`).join('')}</tr>`,
  )
  .join('')}
</table>`;
  return { title: `#${p.number} ${p.name} 選手成績`.replace(/\s+/g, ' '), sub: esc(o.rangeLabel), body };
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
