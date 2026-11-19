import { useMemo } from 'react';

import { db } from '@/db/client';
import { currentSpaceId, currentSpaceLapsed, getGameBundle, listGames, todayString } from '@/db/repo';
import { NO_FILTER, analyzeTeam, filterGames, type AnalysisGame, type DateRange, type TeamAnalysis } from '@/domain/analysis';
import { paywallEnabled } from '@/sync/client';

import { useRefresh } from './useGame';

/** 無料で分析できる試合の数（直近から） */
export const FREE_ANALYSIS_GAMES = 3;

export interface AnalysisLimit {
  /** 無料の範囲に絞っているか */
  limited: boolean;
  /** 絞る前の、終了した試合の数 */
  totalGames: number;
}

/**
 * 分析の範囲。チーム（契約中）は制限なし。個人は、制限が有効なビルドでは直近の数試合だけ。
 * 権利は置き場所に付く（docs/SPEC.md 10-2b）。
 */
export function useAnalysisLimit(): AnalysisLimit {
  const [version] = useRefresh();
  return useMemo(() => {
    const totalGames = listGames(db).filter((g) => g.game.status === 'finished').length;
    return { limited: paywallEnabled && (currentSpaceId(db) === null || currentSpaceLapsed(db)), totalGames };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  }, [version]);
}

/** 期間内の終了した試合を、自チームの視点で集計する。画面に戻るたびに読み直す */
export function useAnalysis(range: DateRange): TeamAnalysis {
  const [version] = useRefresh();
  return useMemo(() => {
    const finished = listGames(db).filter((g) => g.game.status === 'finished');
    const limited = paywallEnabled && (currentSpaceId(db) === null || currentSpaceLapsed(db));
    // 無料の範囲では、期間によらず直近の数試合（一覧は新しい順）
    const target = limited
      ? finished.slice(0, FREE_ANALYSIS_GAMES)
      : filterGames(finished, { ...NO_FILTER, range }, todayString());
    const games = target
      .map(({ game }) => getGameBundle(db, game.id))
      .filter((b): b is NonNullable<typeof b> => b !== undefined) satisfies AnalysisGame[];
    return analyzeTeam(games);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  }, [version, range]);
}
