export type Side = 'A' | 'B';
export const SIDES: readonly Side[] = ['A', 'B'];

export const EVENT_TYPES = [
  'FG2_MADE',
  'FG2_MISS',
  'FG3_MADE',
  'FG3_MISS',
  'FT_MADE',
  'FT_MISS',
  'OREB',
  'DREB',
  'AST',
  'STL',
  'BLK',
  'TOV',
  'FOUL',
  'TIMEOUT',
  'PERIOD_END',
  // 第4Q「残り2分」トグルのON位置を示すマーカー（SPECへの追加。TO上限の計算に必要）
  'L2M',
  // 選手交代（SPECへの追加）。コート上の5人と出場時間・+/- の算出に使う
  'SUB_IN',
  'SUB_OUT',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** P/T/U/D は選手のファウル、C/B はHC・ベンチのファウル */
export const PLAYER_FOUL_KINDS = ['P', 'T', 'U', 'D'] as const;
export const BENCH_FOUL_KINDS = ['C', 'B'] as const;
export type PlayerFoulKind = (typeof PLAYER_FOUL_KINDS)[number];
export type BenchFoulKind = (typeof BENCH_FOUL_KINDS)[number];
export type FoulKind = PlayerFoulKind | BenchFoulKind;

export type GameStatus = 'prep' | 'live' | 'finished';

export interface GameEvent {
  id: string;
  gameId: string;
  orderKey: number;
  /** 1〜4、5以降は延長 */
  period: number;
  /** PERIOD_END / L2M は null */
  side: Side | null;
  /** null = チーム/ベンチ */
  rosterId: string | null;
  type: EventType;
  foulKind: FoulKind | null;
  ftAwarded: number | null;
  /** そのピリオドの残り時間（秒）。交代で任意入力。未入力は null */
  clockSeconds: number | null;
  createdAt: number;
  voidedAt: number | null;
  replacesEventId: string | null;
}

export interface RosterEntry {
  id: string;
  gameId: string;
  side: Side;
  playerId: string | null;
  number: string;
  name: string;
  isStarter: boolean;
  isCaptain: boolean;
}

export interface Score {
  A: number;
  B: number;
}

export type PlayerStatus = 'ok' | 'warning' | 'fouledOut' | 'disqualified';

export interface PlayerFouls {
  P: number;
  T: number;
  U: number;
  D: number;
  total: number;
  /** 記録順のファウル（スコアシートのファウル欄用） */
  list: { kind: PlayerFoulKind; ftAwarded: number; period: number }[];
}

export interface CoachFouls {
  C: number;
  B: number;
  disqualified: boolean;
  list: { kind: BenchFoulKind; ftAwarded: number; period: number }[];
}
