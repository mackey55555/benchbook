import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Storage from 'expo-sqlite/kv-store';

/**
 * チームプラン用のサーバー（Supabase）への接続。
 * 接続先はビルド時の環境変数で決める。設定がなければチームプランの画面そのものを出さない
 * （サーバーなしで使う今までのアプリと同じ動きになる）。
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';

export const teamEnabled = url !== '' && key !== '';

/**
 * 分析の無料範囲（個人は直近3試合まで）を有効にするか。
 * チームプランの契約ができるようになるまでは入れない（入れると、払う手段がないのに機能だけ減るため）。
 */
export const paywallEnabled = teamEnabled && process.env.EXPO_PUBLIC_PAYWALL === '1';

export const supabase: SupabaseClient | null = teamEnabled
  ? createClient(url, key, {
      auth: {
        // サインインの状態は端末内（SQLiteのキー・値の保存領域）に持つ
        storage: Storage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
