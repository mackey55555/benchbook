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
