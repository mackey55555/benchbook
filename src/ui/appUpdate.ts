import * as Updates from 'expo-updates';
import { useSyncExternalStore } from 'react';

// 開発ビルド・Expo Go では expo-updates が無効で、確認APIは reject される
export const canCheckUpdate = Updates.isEnabled && !__DEV__;

// OTAの自動確認は、ホームを開いたとき・アプリに戻ったときに行う。通信を繰り返さないよう間隔を空ける
const AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let lastAutoCheckAt = 0;

export interface UpdateState {
  /** 取得済みの更新がある（再読み込みで適用できる） */
  ready: boolean;
  busy: boolean;
  applying: boolean;
  /** 手動確認の経過・結果 */
  status: string | null;
}

// ホームと設定の両方から同じ状態を見るため、画面の外に持つ
let state: UpdateState = { ready: false, busy: false, applying: false, status: null };
const listeners = new Set<() => void>();
function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/**
 * 更新があれば取得まで済ませる。適用は利用者が「更新する」を押したとき（applyUpdate）。
 * manual=false は自動確認で、間隔を空け、失敗しても何も表示しない。
 */
export async function checkForUpdate(manual: boolean): Promise<void> {
  if (!canCheckUpdate || state.busy || state.ready) return;
  if (!manual) {
    if (Date.now() - lastAutoCheckAt < AUTO_CHECK_INTERVAL_MS) return;
    lastAutoCheckAt = Date.now();
  }
  set({ busy: true, ...(manual ? { status: '更新を確認中…' } : {}) });
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      if (manual) set({ status: '最新です' });
      return;
    }
    if (manual) set({ status: '更新をダウンロード中…' });
    await Updates.fetchUpdateAsync();
    set({ ready: true, status: null });
  } catch (e) {
    // オフラインでも全機能が動くこと。自動確認の失敗は黙って無視する
    if (manual) set({ status: `確認できませんでした: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    set({ busy: false });
  }
}

export async function applyUpdate(): Promise<void> {
  set({ applying: true });
  try {
    await Updates.reloadAsync();
  } catch (e) {
    set({ applying: false, status: `更新できませんでした: ${e instanceof Error ? e.message : String(e)}` });
  }
}
