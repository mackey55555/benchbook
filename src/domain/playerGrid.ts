import { RULES } from './rules';

/** 入力画面の、選手ボタンの1段 */
export interface PlayerGridRow<T> {
  items: T[];
  /** この段の列数（選手が足りない分は空ける） */
  columns: number;
  /** 段の高さの比 */
  weight: number;
  /** 小さいボタンで出す段（ベンチの選手） */
  compact: boolean;
}

const BASE_COLUMNS = 3;
/** コートの選手の段は、ベンチの段の2倍の高さにする */
const COURT_WEIGHT = 2;

function chunk<T>(items: readonly T[], columns: number, minRows: number): T[][] {
  const rows = Math.max(minRows, Math.ceil(items.length / columns));
  return Array.from({ length: rows }, (_, r) => items.slice(r * columns, (r + 1) * columns));
}

/**
 * 入力画面の選手ボタンの並びを決める。スクロールはさせず、全員を1画面に出す。
 *
 * - 交代を記録しているチーム：コートの選手を上に大きく、ベンチの選手を下に小さく並べる。
 *   試合中に押すのはコートの選手なので、登録が増えても、押すボタンは小さくならない。
 * - 交代を記録していないチーム：全員を同じ大きさで並べる。12名までは3列4段、それを超えたら4列にする。
 *
 * どちらも、渡された順（背番号順）を保つ。
 */
export function layoutPlayerGrid<T extends { onCourt: boolean }>(
  players: readonly T[],
  lineupTracked: boolean,
): PlayerGridRow<T>[] {
  const court = players.filter((p) => p.onCourt);
  if (!lineupTracked || court.length === 0) {
    const columns = players.length > RULES.standardRosterSize ? BASE_COLUMNS + 1 : BASE_COLUMNS;
    return chunk(players, columns, RULES.standardRosterSize / BASE_COLUMNS).map((items) => ({
      items,
      columns,
      weight: 1,
      compact: false,
    }));
  }
  const bench = players.filter((p) => !p.onCourt);
  const benchColumns = bench.length > 8 ? 5 : 4;
  return [
    ...chunk(court, BASE_COLUMNS, 2).map((items) => ({
      items,
      columns: BASE_COLUMNS,
      weight: COURT_WEIGHT,
      compact: false,
    })),
    ...chunk(bench, benchColumns, 0).map((items) => ({
      items,
      columns: benchColumns,
      weight: 1,
      compact: true,
    })),
  ];
}
