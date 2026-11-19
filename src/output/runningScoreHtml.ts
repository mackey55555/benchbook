import {
  RULES,
  computeCoachFouls,
  computePeriodScores,
  computePlayerFouls,
  computeScore,
  computeTeamFouls,
  foulNotation,
  periodLabel,
  timeoutsByPeriod,
} from '@/domain/rules';
import {
  RUNNING_SCORE_MAX,
  buildBoxScore,
  buildRunningScore,
  type RunningScoreEntry,
} from '@/domain/stats';
import type { GameEvent, RosterEntry, Side } from '@/domain/types';

/**
 * Qごとの記入色。JBAの記入要領が未確定のため設定値にしている（SPEC 6章・9章）。
 * 既定：第1Q・第3Qは赤、第2Q・第4Q・延長は黒。
 */
export const PERIOD_COLORS: Record<number | 'ot', string> = {
  1: '#c81e1e',
  2: '#111111',
  3: '#c81e1e',
  4: '#111111',
  ot: '#111111',
};

export interface RunningScoreInput {
  game: {
    date: string;
    leagueName: string;
    venue: string;
    teamAName: string;
    teamBName: string;
    currentPeriod: number;
    periodMinutes: number;
    otMinutes: number;
    status: 'prep' | 'live' | 'finished';
  };
  roster: readonly RosterEntry[];
  staff: readonly { side: Side; role: 'HC' | 'AC'; name: string }[];
  events: readonly GameEvent[];
}

const ROWS_PER_GROUP = 40;
const GROUPS = RUNNING_SCORE_MAX / ROWS_PER_GROUP;

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const qClass = (period: number) => (period <= RULES.regulationPeriods ? `q${period}` : 'qot');

function scoreCells(side: Side, n: number, entry: RunningScoreEntry | undefined): string {
  if (!entry) {
    const blank = '<td class="no"></td>';
    const num = `<td class="sc">${n}</td>`;
    return side === 'A' ? blank + num : num + blank;
  }
  const q = qClass(entry.period);
  const end = entry.periodEnd ? ' end' : '';
  const mark = entry.kind === 'FT' ? '<span class="dot"></span>' : String(n);
  const inner = entry.periodEnd ? `<span class="ring">${mark}</span>` : mark;
  const slash = entry.kind === 'FT' ? '' : ' slash';
  const num = `<td class="sc hit ${q}${slash}${end}">${inner}</td>`;
  const player =
    entry.kind === 'FG3'
      ? `<span class="ring">${esc(entry.number)}</span>`
      : esc(entry.number);
  const no = `<td class="no ${q}${end}">${player}</td>`;
  return side === 'A' ? no + num : num + no;
}

function runningTable(input: RunningScoreInput): string {
  const running = buildRunningScore(input.events, input.roster);
  const byTotal = {
    A: new Map(running.A.map((e) => [e.total, e])),
    B: new Map(running.B.map((e) => [e.total, e])),
  };
  const head = Array.from(
    { length: GROUPS },
    () => '<th class="no">A</th><th class="sc" colspan="2">得点</th><th class="no">B</th>',
  ).join('<th class="gap"></th>');
  const rows: string[] = [];
  for (let r = 1; r <= ROWS_PER_GROUP; r++) {
    const cells: string[] = [];
    for (let g = 0; g < GROUPS; g++) {
      const n = g * ROWS_PER_GROUP + r;
      cells.push(scoreCells('A', n, byTotal.A.get(n)) + scoreCells('B', n, byTotal.B.get(n)));
    }
    rows.push(`<tr>${cells.join('<td class="gap"></td>')}</tr>`);
  }
  return `<table class="running"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function boxes(total: number, used: number): string {
  return Array.from(
    { length: total },
    (_, i) => `<span class="box">${i < used ? '×' : ''}</span>`,
  ).join('');
}

function teamPanel(input: RunningScoreInput, side: Side): string {
  const { game, roster, staff, events } = input;
  const name = side === 'A' ? game.teamAName : game.teamBName;
  const hc = staff.find((s) => s.side === side && s.role === 'HC')?.name ?? '';
  const box = buildBoxScore(events, roster)[side];
  const rosterById = new Map(roster.map((r) => [r.id, r]));

  const tos = timeoutsByPeriod(events, side);
  const firstHalf = (tos.get(1) ?? 0) + (tos.get(2) ?? 0);
  const secondHalf = (tos.get(3) ?? 0) + (tos.get(4) ?? 0);
  let overtime = '';
  for (let p = RULES.regulationPeriods + 1; p <= game.currentPeriod; p++) {
    overtime += ` ${periodLabel(p)} ${boxes(RULES.timeoutsPerOvertime, tos.get(p) ?? 0)}`;
  }

  const teamFouls = [1, 2, 3, 4]
    .map((p) => {
      const count = events.filter(
        (e) =>
          e.voidedAt === null &&
          e.type === 'FOUL' &&
          e.side === side &&
          e.rosterId !== null &&
          e.period === p,
      ).length;
      return `<span class="tfq ${qClass(p)}">Q${p} ${boxes(4, Math.min(count, 4))}${count > 4 ? `<b>+${count - 4}</b>` : ''}</span>`;
    })
    .join('');
  const otFouls =
    game.currentPeriod > RULES.regulationPeriods
      ? `<span class="tfq qot">Q4+OT計 ${computeTeamFouls(events, side, game.currentPeriod)}</span>`
      : '';

  const playerRows = box.players
    .map((line) => {
      const entry = line.rosterId ? rosterById.get(line.rosterId) : undefined;
      const fouls = line.rosterId ? computePlayerFouls(events, line.rosterId).list : [];
      const foulCells = Array.from({ length: RULES.foulOutAt }, (_, i) => {
        const f = fouls[i];
        return f
          ? `<td class="f ${qClass(f.period)}">${foulNotation(f.kind, f.ftAwarded)}</td>`
          : '<td class="f"></td>';
      }).join('');
      const marks = `${entry?.isStarter ? '◎' : ''}${entry?.isCaptain ? '(C)' : ''}`;
      return `<tr><td class="pn">${esc(line.number)}</td><td class="pname">${esc(line.name)} <small>${marks}</small></td>${foulCells}<td class="pts">${line.pts || ''}</td></tr>`;
    })
    .join('');
  const emptyRows = Array.from(
    { length: Math.max(0, RULES.standardRosterSize - box.players.length) },
    () =>
      `<tr><td class="pn"></td><td class="pname"></td>${'<td class="f"></td>'.repeat(RULES.foulOutAt)}<td class="pts"></td></tr>`,
  ).join('');

  const coach = computeCoachFouls(events, side);
  const coachFouls = coach.list
    .map((f) => `<span class="${qClass(f.period)}">${foulNotation(f.kind, f.ftAwarded)}</span>`)
    .join(' ');

  return `<section class="team">
<div class="tname"><span class="tag">チーム${side}</span> ${esc(name)}</div>
<div class="meta">タイムアウト　前半 ${boxes(RULES.timeoutsFirstHalf, firstHalf)}　後半 ${boxes(RULES.timeoutsSecondHalf, secondHalf)}${overtime}</div>
<div class="meta">チームファウル　${teamFouls}${otFouls}</div>
<table class="players"><thead><tr><th class="pn">No.</th><th class="pname">選手氏名</th><th colspan="${RULES.foulOutAt}">ファウル</th><th class="pts">得点</th></tr></thead>
<tbody>${playerRows}${emptyRows}</tbody></table>
<div class="meta">HC：${esc(hc)}　<span class="coach">HC・ベンチのファウル：${coachFouls}</span></div>
</section>`;
}

function periodTable(input: RunningScoreInput): string {
  const { game, events } = input;
  const periods = computePeriodScores(events, Math.max(game.currentPeriod, RULES.regulationPeriods));
  const total = computeScore(events);
  const head = periods.map((p) => `<th>${periodLabel(p.period)}</th>`).join('');
  const row = (side: Side, name: string) =>
    `<tr><th class="tn">${esc(name)}</th>${periods
      .map((p) => `<td class="${qClass(p.period)}">${p.score[side]}</td>`)
      .join('')}<td class="final">${total[side]}</td></tr>`;
  return `<table class="periods"><thead><tr><th></th>${head}<th>最終</th></tr></thead><tbody>${row('A', game.teamAName)}${row('B', game.teamBName)}</tbody></table>`;
}

const CSS = `
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif; color: #111; font-size: 8pt; }
.sheet { width: 194mm; margin: 0 auto; }
@media screen { .sheet { padding: 3mm 0; } }
h1 { font-size: 11pt; margin: 0 0 1mm; }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 0.4mm solid #111; padding-bottom: 1mm; margin-bottom: 2mm; }
.head .info { font-size: 8pt; line-height: 1.5; }
.head .final { font-size: 16pt; font-weight: 700; white-space: nowrap; }
.teams { display: flex; gap: 3mm; margin-bottom: 2mm; }
.team { flex: 1; min-width: 0; }
.tname { font-size: 10pt; font-weight: 700; margin-bottom: 0.5mm; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tag { font-size: 7pt; border: 0.2mm solid #111; padding: 0 1mm; margin-right: 1mm; font-weight: 400; }
.meta { font-size: 7pt; margin: 0.6mm 0; white-space: nowrap; overflow: hidden; }
.box { display: inline-block; width: 3mm; height: 3mm; border: 0.2mm solid #111; text-align: center; line-height: 2.7mm; font-size: 7pt; vertical-align: middle; margin-right: 0.3mm; }
.tfq { margin-right: 1.5mm; }
table { border-collapse: collapse; }
.players { width: 100%; table-layout: fixed; }
.players th, .players td { border: 0.2mm solid #111; height: 4.1mm; padding: 0 0.6mm; font-size: 7pt; text-align: center; overflow: hidden; white-space: nowrap; }
.players th { background: #eee; font-weight: 600; }
.players .pn { width: 7mm; font-weight: 700; }
.players .pname { text-align: left; }
.players .f { width: 6.2mm; font-weight: 700; }
.players .pts { width: 8mm; }
.running { width: 100%; table-layout: fixed; }
.running th { font-size: 6.5pt; background: #eee; border: 0.2mm solid #111; height: 3.6mm; }
.running td { border: 0.2mm solid #888; height: 3.9mm; text-align: center; font-size: 6.5pt; line-height: 1; padding: 0; position: relative; }
.running .gap { width: 2mm; border: none; background: none; }
.running .sc { color: #9aa0a6; }
.running .sc.hit { font-weight: 700; }
.running .no { font-weight: 700; }
.running .slash { background-image: linear-gradient(to bottom right, transparent calc(50% - 0.18mm), currentColor calc(50% - 0.18mm), currentColor calc(50% + 0.18mm), transparent calc(50% + 0.18mm)); }
.running .end { border-bottom: 0.6mm solid currentColor; }
.ring { display: inline-block; min-width: 3mm; height: 3mm; line-height: 2.6mm; border: 0.25mm solid currentColor; border-radius: 1.5mm; padding: 0 0.3mm; }
.dot { display: inline-block; width: 2mm; height: 2mm; border-radius: 1mm; background: currentColor; vertical-align: middle; }
.bottom { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 2mm; gap: 4mm; }
.periods th, .periods td { border: 0.2mm solid #111; padding: 0.6mm 2mm; font-size: 8pt; text-align: center; min-width: 9mm; }
.periods .tn { text-align: left; max-width: 50mm; overflow: hidden; white-space: nowrap; }
.periods .final { font-weight: 700; font-size: 10pt; color: #111; }
.legend { font-size: 6.5pt; color: #555; line-height: 1.5; text-align: right; }
.q1, .running .q1 { color: ${PERIOD_COLORS[1]}; } .q2, .running .q2 { color: ${PERIOD_COLORS[2]}; }
.q3, .running .q3 { color: ${PERIOD_COLORS[3]}; } .q4, .running .q4 { color: ${PERIOD_COLORS[4]}; }
.qot, .running .qot { color: ${PERIOD_COLORS.ot}; }
`;

/**
 * ランニングスコアのHTML（A4縦）。画面（WebView）とPDF（expo-print）で同じものを使う。
 * 描画に使う値はすべてドメイン関数の結果で、ここでは集計しない。
 */
export function buildRunningScoreHtml(input: RunningScoreInput): string {
  const { game, events } = input;
  const total = computeScore(events);
  // 出場登録が標準（12名）を超えるときは、選手の行を低くして、1ページに収める
  const rosterRows = Math.max(...(['A', 'B'] as const).map((side) => input.roster.filter((r) => r.side === side).length));
  const compact =
    rosterRows > RULES.standardRosterSize
      ? `.players td { height: ${((4.1 * RULES.standardRosterSize) / rosterRows).toFixed(2)}mm; font-size: 6.5pt; }`
      : '';
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=794, user-scalable=yes">
<title>${esc(game.teamAName)} vs ${esc(game.teamBName)}</title>
<style>${CSS}${compact}</style></head>
<body><div class="sheet">
<div class="head">
<div><h1>ランニングスコア（ベンチ控え）</h1>
<div class="info">大会名：${esc(game.leagueName)}　日付：${esc(game.date)}　会場：${esc(game.venue)}</div></div>
<div class="final">${esc(game.teamAName)} ${total.A} - ${total.B} ${esc(game.teamBName)}</div>
</div>
<div class="teams">${teamPanel(input, 'A')}${teamPanel(input, 'B')}</div>
${runningTable(input)}
<div class="bottom">${periodTable(input)}
<div class="legend">斜線＝2P／斜線＋背番号を丸＝3P／黒丸＝FT／丸囲み＋太線＝Q終了<br>◎＝スターター　(C)＝キャプテン　TO欄の時刻は記録していません<br>これは控えの記録であり、公式スコアシートではありません</div></div>
</div></body></html>`;
}
