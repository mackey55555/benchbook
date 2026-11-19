import { useEffect } from 'react';
import { AppState } from 'react-native';

import { teamEnabled } from '@/sync/client';
import { getTeamState, refreshPending, setForeground, startSession, syncNow } from '@/sync/session';

/** 未送信の変更があるときに送りに行く間隔 */
const PUSH_INTERVAL_MS = 20_000;
/** 何もなくても、ほかの人の変更を取りに行く間隔 */
const PULL_INTERVAL_MS = 120_000;

/**
 * 同期を動かし続ける部品（画面には何も出さない）。
 * アプリを開いたとき・前面に戻ったとき・一定の間隔で同期する。チームプランを使っていなければ何もしない。
 */
export function SyncHost() {
  useEffect(() => {
    if (!teamEnabled) return;
    startSession();
    setForeground(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (next) => {
      setForeground(next === 'active');
      if (next === 'active') void syncNow();
    });
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      const state = getTeamState();
      if (!state.userId || state.syncing) return;
      refreshPending();
      const due = Date.now() - (state.lastSyncedAt ?? 0) > PULL_INTERVAL_MS;
      if (getTeamState().pending > 0 || due) void syncNow();
    }, PUSH_INTERVAL_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);
  return null;
}
