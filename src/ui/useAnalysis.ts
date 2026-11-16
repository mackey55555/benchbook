import { useMemo } from 'react';

import { db } from '@/db/client';
import { getGameBundle, listGames, todayString } from '@/db/repo';
import { NO_FILTER, analyzeTeam, filterGames, type AnalysisGame, type DateRange, type TeamAnalysis } from '@/domain/analysis';

import { useRefresh } from './useGame';

/** 期間内の終了した試合を、自チームの視点で集計する。画面に戻るたびに読み直す */
export function useAnalysis(range: DateRange): TeamAnalysis {
  const [version] = useRefresh();
  return useMemo(() => {
    const finished = listGames(db).filter((g) => g.game.status === 'finished');
    const games = filterGames(finished, { ...NO_FILTER, range }, todayString())
      .map(({ game }) => getGameBundle(db, game.id))
      .filter((b): b is NonNullable<typeof b> => b !== undefined) satisfies AnalysisGame[];
    return analyzeTeam(games);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  }, [version, range]);
}
