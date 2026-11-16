import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { db } from '@/db/client';
import { RepoError, getGameBundle, type GameBundle } from '@/db/repo';
import { showDialog } from './dialog';

/**
 * 試合データを読み込む。DBは同期APIなので、書き込み → reload() の順に呼べば
 * 「書き込み完了後にUIへ反映」になる。
 */
export function useGame(gameId: string): { bundle: GameBundle | undefined; reload: () => void } {
  const [bundle, setBundle] = useState(() => getGameBundle(db, gameId));
  const reload = useCallback(() => setBundle(getGameBundle(db, gameId)), [gameId]);
  useFocusEffect(reload);
  return { bundle, reload };
}

/** 画面フォーカス時と bump() 呼び出し時に再読み込みするためのカウンタ */
export function useRefresh(): [number, () => void] {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(bump);
  return [version, bump];
}

/** 書き込みを実行し、入力エラー（RepoError）はアラートで知らせる。成功したら true */
export function attempt(action: () => void): boolean {
  try {
    action();
    return true;
  } catch (e) {
    if (e instanceof RepoError) {
      showDialog('確認してください', e.message);
      return false;
    }
    throw e;
  }
}
