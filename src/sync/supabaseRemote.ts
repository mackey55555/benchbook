import type { SupabaseClient } from '@supabase/supabase-js';

import { SyncDeniedError, type Remote } from './engine';
import type { RemoteRow } from './tables';

/** 権限がない（RLS・トリガーに断られた）ときのPostgreSQLのコード */
const DENIED = new Set(['42501']);

function fail(error: { code?: string; message: string }): never {
  if (error.code && DENIED.has(error.code)) throw new SyncDeniedError(error.message);
  throw new Error(error.message);
}

/** Supabase（PostgREST）を相手にした同期のやりとり */
export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async upsert(table, rows, key) {
      const { error } = await client.from(table).upsert(rows, { onConflict: key.join(',') });
      if (error) fail(error);
    },
    async softDelete(table, ids) {
      const { error } = await client.from(table).update({ deleted_at: new Date().toISOString() }).in('id', ids);
      if (error) fail(error);
    },
    async pull(table, teamId, since, limit, key) {
      let query = client.from(table).select('*').eq('team_id', teamId);
      if (since !== null) query = query.gte('updated_at', since);
      query = query.order('updated_at', { ascending: true });
      for (const k of key) query = query.order(k, { ascending: true });
      const { data, error } = await query.limit(limit);
      if (error) fail(error);
      return (data ?? []) as RemoteRow[];
    },
  };
}
