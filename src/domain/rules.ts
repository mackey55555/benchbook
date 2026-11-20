import type {
  BenchFoulKind,
  CoachFouls,
  EventType,
  FoulKind,
  GameEvent,
  PlayerFoulKind,
  PlayerFouls,
  PlayerStatus,
  Score,
  Side,
} from './types';

/** SPEC 3章の既定値 */
export const RULES = {
  regulationPeriods: 4,
  defaultPeriodMinutes: 10,
  defaultOvertimeMinutes: 5,
  /** 出場登録できる人数の上限。大会によっては12名を超えるので、20名まで受ける */
  maxRosterSize: 20,
  /** 標準の登録人数。入力画面の選手ボタンとスコアシートは、この人数分の枠を基本にして、超えた分だけ行を足す */
  standardRosterSize: 12,
  startersCount: 5,
  timeoutsFirstHalf: 2,
  timeoutsSecondHalf: 3,
  timeoutsPerOvertime: 1,
  /** 第4Q残り2分以降に取れるTOの上限 */
  timeoutsLastTwoMinutes: 2,
  /** この数に達したら次のファウルからペナルティ（FT） */
  teamFoulBonusAt: 4,
  foulOutAt: 5,
  foulWarningAt: 4,
} as const;

const POINTS: Partial<Record<EventType, number>> = {
  FG2_MADE: 2,
  FG3_MADE: 3,
  FT_MADE: 1,
};

export function pointsOf(type: EventType): number {
  return POINTS[type] ?? 0;
}

export function isPlayerFoulKind(kind: FoulKind | null): kind is PlayerFoulKind {
  return kind === 'P' || kind === 'T' || kind === 'U' || kind === 'D';
}

export function isBenchFoulKind(kind: FoulKind | null): kind is BenchFoulKind {
  return kind === 'C' || kind === 'B';
}

/** 取消済みを除き、記録順（order_key、同値は作成順）に並べる */
export function activeEvents(events: readonly GameEvent[]): GameEvent[] {
  return events
    .filter((e) => e.voidedAt === null)
    .sort(
      (a, b) => a.orderKey - b.orderKey || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
    );
}

export function computeScore(events: readonly GameEvent[], period?: number): Score {
  const score: Score = { A: 0, B: 0 };
  for (const e of events) {
    if (e.voidedAt !== null || e.side === null) continue;
    if (period !== undefined && e.period !== period) continue;
    score[e.side] += pointsOf(e.type);
  }
  return score;
}

/** 指定ピリオド終了時点までの累計 */
export function computeScoreThrough(events: readonly GameEvent[], period: number): Score {
  const score: Score = { A: 0, B: 0 };
  for (const e of events) {
    if (e.voidedAt !== null || e.side === null || e.period > period) continue;
    score[e.side] += pointsOf(e.type);
  }
  return score;
}

/** 1〜maxPeriod のピリオド別得点 */
export function computePeriodScores(
  events: readonly GameEvent[],
  maxPeriod: number,
): { period: number; score: Score }[] {
  const result: { period: number; score: Score }[] = [];
  for (let p = 1; p <= maxPeriod; p++) {
    result.push({ period: p, score: computeScore(events, p) });
  }
  return result;
}

/**
 * チームファウル。Qごとに集計し、延長は第4Qの累計を継続する。
 * 数えるのは選手のP/T/U/Dのみ（C/Bは数えない）。
 */
export function computeTeamFouls(events: readonly GameEvent[], side: Side, period: number): number {
  const inScope = (p: number) =>
    period >= RULES.regulationPeriods ? p >= RULES.regulationPeriods && p <= period : p === period;
  let count = 0;
  for (const e of events) {
    if (e.voidedAt !== null || e.type !== 'FOUL' || e.side !== side) continue;
    if (e.rosterId === null || !isPlayerFoulKind(e.foulKind)) continue;
    if (inScope(e.period)) count++;
  }
  return count;
}

/** 次のファウルからFTになる状態か（チームファウルが4に達した） */
export function isInBonus(teamFouls: number): boolean {
  return teamFouls >= RULES.teamFoulBonusAt;
}

export function computePlayerFouls(events: readonly GameEvent[], rosterId: string): PlayerFouls {
  const fouls: PlayerFouls = { P: 0, T: 0, U: 0, D: 0, total: 0, list: [] };
  for (const e of activeEvents(events)) {
    if (e.type !== 'FOUL' || e.rosterId !== rosterId || !isPlayerFoulKind(e.foulKind)) continue;
    fouls[e.foulKind]++;
    fouls.total++;
    fouls.list.push({ kind: e.foulKind, ftAwarded: e.ftAwarded ?? 0, period: e.period });
  }
  return fouls;
}

/**
 * 選手の退場・失格判定。
 * - D → 即失格 / T×2、U×2、T×1＋U×1 → 失格
 * - 合計5 → 退場 / 合計4 → 警告
 */
export function checkDisqualification(fouls: Pick<PlayerFouls, 'P' | 'T' | 'U' | 'D'>): PlayerStatus {
  const total = fouls.P + fouls.T + fouls.U + fouls.D;
  if (fouls.D >= 1 || fouls.T >= 2 || fouls.U >= 2 || (fouls.T >= 1 && fouls.U >= 1)) {
    return 'disqualified';
  }
  if (total >= RULES.foulOutAt) return 'fouledOut';
  if (total >= RULES.foulWarningAt) return 'warning';
  return 'ok';
}

/** HCの失格判定：C×2、または C・B の合計が3 */
export function computeCoachFouls(events: readonly GameEvent[], side: Side): CoachFouls {
  const fouls: CoachFouls = { C: 0, B: 0, disqualified: false, list: [] };
  for (const e of activeEvents(events)) {
    if (e.type !== 'FOUL' || e.side !== side || e.rosterId !== null) continue;
    if (!isBenchFoulKind(e.foulKind)) continue;
    fouls[e.foulKind]++;
    fouls.list.push({ kind: e.foulKind, ftAwarded: e.ftAwarded ?? 0, period: e.period });
  }
  fouls.disqualified = fouls.C >= 2 || fouls.C + fouls.B >= 3;
  return fouls;
}

/** 「残り2分」が現在ONか（第4QにL2Mマーカーがある） */
export function isLastTwoMinutes(events: readonly GameEvent[]): boolean {
  return findLastTwoMinutesMarker(events) !== undefined;
}

export function findLastTwoMinutesMarker(events: readonly GameEvent[]): GameEvent | undefined {
  return events.find(
    (e) => e.voidedAt === null && e.type === 'L2M' && e.period === RULES.regulationPeriods,
  );
}

/**
 * TO残数。前半2回 / 後半3回 / 延長は各1回、繰り越しなし。
 * 第4Qで「残り2分」がONのとき、その時点以降に取れるのは最大2回
 * （ONにした時点で3回残っていれば1回失う）。
 */
export function remainingTimeouts(
  events: readonly GameEvent[],
  side: Side,
  period: number,
): number {
  const timeouts = events.filter(
    (e) => e.voidedAt === null && e.type === 'TIMEOUT' && e.side === side,
  );
  if (period > RULES.regulationPeriods) {
    const used = timeouts.filter((e) => e.period === period).length;
    return Math.max(0, RULES.timeoutsPerOvertime - used);
  }
  if (period <= 2) {
    const used = timeouts.filter((e) => e.period <= 2).length;
    return Math.max(0, RULES.timeoutsFirstHalf - used);
  }
  const secondHalf = timeouts.filter((e) => e.period === 3 || e.period === 4);
  const marker = period === RULES.regulationPeriods ? findLastTwoMinutesMarker(events) : undefined;
  if (!marker) {
    return Math.max(0, RULES.timeoutsSecondHalf - secondHalf.length);
  }
  const usedBefore = secondHalf.filter((e) => e.orderKey < marker.orderKey).length;
  const usedAfter = secondHalf.length - usedBefore;
  const atEntry = Math.min(
    Math.max(0, RULES.timeoutsSecondHalf - usedBefore),
    RULES.timeoutsLastTwoMinutes,
  );
  return Math.max(0, atEntry - usedAfter);
}

/** そのピリオドで使ったTO数（スコアシートのTO欄用） */
export function timeoutsByPeriod(events: readonly GameEvent[], side: Side): Map<number, number> {
  const result = new Map<number, number>();
  for (const e of events) {
    if (e.voidedAt !== null || e.type !== 'TIMEOUT' || e.side !== side) continue;
    result.set(e.period, (result.get(e.period) ?? 0) + 1);
  }
  return result;
}

export type AfterPeriod = 'nextPeriod' | 'overtime' | 'finished';

/** ピリオド終了後の進行。第4Q以降は同点なら延長、それ以外は試合終了 */
export function afterPeriod(period: number, score: Score): AfterPeriod {
  if (period < RULES.regulationPeriods) return 'nextPeriod';
  return score.A === score.B ? 'overtime' : 'finished';
}

export function periodLabel(period: number): string {
  return period <= RULES.regulationPeriods ? `Q${period}` : `OT${period - RULES.regulationPeriods}`;
}

/** スコアシート表記（例：P、P2、U2）。種類＋与えたFT数から生成する */
export function foulNotation(kind: FoulKind, ftAwarded: number | null): string {
  return ftAwarded && ftAwarded > 0 ? `${kind}${ftAwarded}` : kind;
}

/** 背番号の並び順（数値順。"00" は "0" の前） */
export function compareNumbers(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  const va = Number.isNaN(na) ? Number.MAX_SAFE_INTEGER : na;
  const vb = Number.isNaN(nb) ? Number.MAX_SAFE_INTEGER : nb;
  return va - vb || b.length - a.length || a.localeCompare(b);
}
