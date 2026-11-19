import type { GameEvent, Side } from './types';

/**
 * 練習用の試合のID。1つだけ作り、一覧・分析・再開・バックアップの対象から外す。
 * 練習が終わったら（やめたら）消す。
 */
export const PRACTICE_GAME_ID = 'practice';

/** 練習で次に押してほしい場所（入力画面のどこを目立たせるか） */
export type PracticeTarget =
  | 'playerA'
  | 'anyPlayer'
  | 'made2'
  | 'foul'
  | 'undo'
  | 'timeout'
  | 'fouls'
  | 'endPeriod';

export interface PracticeStep {
  /** 何番目の手順か（1始まり）と、全体の数 */
  index: number;
  total: number;
  text: string;
  target: PracticeTarget;
}

/** 記録からは分からない、画面の操作の済み・未済 */
export interface PracticeFlags {
  /** FOUL の長押しで開くシートから、種類を選んで記録した */
  foulSheetUsed: boolean;
  /** 「ファウル状況」を開いた */
  foulsViewed: boolean;
}

export const PRACTICE_STEPS = 10;

/**
 * 練習の、いまの手順。記録の状態と画面の操作から決める（取り消した記録も「やったこと」として数える）。
 *
 * 1. 自チームの選手を選ぶ → 2. 2P○
 * 3. 選手を選ぶ → 4. FOUL
 * 5. 取り消す
 * 6. 選手を選ぶ → 7. FOUL を長押しして種類を選ぶ
 * 8. タイムアウト
 * 9. ファウル状況を見る
 * 10. Q終了
 */
export function practiceStep(
  events: readonly GameEvent[],
  selectedSide: Side | null,
  flags: PracticeFlags,
): PracticeStep {
  const step = (index: number, text: string, target: PracticeTarget): PracticeStep => ({
    index,
    total: PRACTICE_STEPS,
    text,
    target,
  });
  const scored = events.some((e) => e.type === 'FG2_MADE' && e.side === 'A');
  if (!scored) {
    return selectedSide === 'A'
      ? step(2, '「2P○」をタップ（2点が入ります）', 'made2')
      : step(1, '左の自チームから、番号をタップ', 'playerA');
  }
  const fouled = events.some((e) => e.type === 'FOUL');
  if (!fouled) {
    return selectedSide !== null
      ? step(4, '「FOUL」をタップ（ファウルを記録）', 'foul')
      : step(3, '次はファウル。どちらかの番号をタップ', 'anyPlayer');
  }
  const undone = events.some((e) => e.voidedAt !== null && e.type !== 'MARK');
  if (!undone) return step(5, '押し間違えたら「取り消す」。押してみましょう', 'undo');
  if (!flags.foulSheetUsed) {
    return selectedSide !== null
      ? step(7, '「FOUL」を長押し → 種類を選んで「記録」', 'foul')
      : step(6, 'ファウルの種類を選ぶ練習。番号をタップ', 'anyPlayer');
  }
  const timeout = events.some((e) => e.type === 'TIMEOUT');
  if (!timeout) return step(8, 'タイムアウトは「TO」をタップ（選手は選びません）', 'timeout');
  if (!flags.foulsViewed) return step(9, '右上の「ファウル状況」で、全員のファウルを確認', 'fouls');
  return step(10, 'Qが終わったら「Q1 終了」をタップ', 'endPeriod');
}
