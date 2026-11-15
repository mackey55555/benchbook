import type { EventType, FoulKind, GameEvent, RosterEntry, Side } from '../types';

let seq = 0;

export function resetSeq(): void {
  seq = 0;
}

/** テスト用イベント。呼ぶたびに order_key が1ずつ増える */
export function ev(
  type: EventType,
  side: Side | null,
  rosterId: string | null,
  period = 1,
  extra: Partial<GameEvent> = {},
): GameEvent {
  seq += 1;
  return {
    id: `e${String(seq).padStart(4, '0')}`,
    gameId: 'g1',
    orderKey: seq,
    period,
    side,
    rosterId,
    type,
    foulKind: null,
    ftAwarded: null,
    createdAt: seq,
    voidedAt: null,
    replacesEventId: null,
    ...extra,
  };
}

export function foul(
  side: Side,
  rosterId: string | null,
  kind: FoulKind,
  period = 1,
  ftAwarded = 0,
): GameEvent {
  return ev('FOUL', side, rosterId, period, { foulKind: kind, ftAwarded });
}

export function roster(side: Side, numbers: string[]): RosterEntry[] {
  return numbers.map((number) => ({
    id: `${side}${number}`,
    gameId: 'g1',
    side,
    playerId: null,
    number,
    name: '',
    isStarter: false,
    isCaptain: false,
  }));
}
