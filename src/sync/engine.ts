import { sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db/repo';

import { SYNC_TABLES, toLocal, toRemote, type LocalRow, type RemoteRow, type SyncTable } from './tables';

/**
 * 同期の本体。端末のSQLiteを正とし、チームの行をサーバーと行き来させる。
 *
 * - 送る：印（dirty）の付いた行をIDで上書き保存する。端末で消した行は、控え（sync_tombstones）から削除を伝える
 * - 受け取る：テーブルごとに「前回の続き」（updated_at）から取りに行く
 * - 送る → 受け取る の順に行う。受け取るときに未送信の行があれば、端末の内容を残す
 *
 * サーバーとのやりとりは Remote に切り出してある（テストでは偽物に差し替える）。
 */

/** サーバーとのやりとり */
export interface Remote {
  /** IDが同じ行は上書き、なければ追加 */
  upsert(table: string, rows: RemoteRow[], key: string[]): Promise<void>;
  /** deleted_at を立てる。権限がなければ SyncDeniedError */
  softDelete(table: string, ids: string[]): Promise<void>;
  /** updated_at が since 以降の行を、updated_at の古い順に limit 件まで（since が null なら最初から） */
  pull(table: string, teamId: string, since: string | null, limit: number, key: string[]): Promise<RemoteRow[]>;
}

/** サーバーに断られた（権限がない、チームが有効でない） */
export class SyncDeniedError extends Error {}

/** 1回に受け取る件数 */
const PAGE = 500;
/**
 * 1回に送る件数。まとめて送った行はサーバーで同じ updated_at になるので、
 * PAGE より小さくして「同じ時刻の行だけで1ページが埋まる」ことが起きないようにする
 */
const PUSH_CHUNK = 200;
/** 続きから取りに行くときに重ねる幅。書き込み中だった行の取りこぼしを防ぐ */
const OVERLAP_MS = 10_000;

function stmt(text: string, params: readonly unknown[] = []): SQL {
  const parts = text.split('?');
  if (parts.length - 1 !== params.length) throw new Error(`SQLの引数の数が合いません: ${text}`);
  const chunks: SQL[] = [];
  parts.forEach((part, i) => {
    chunks.push(sql.raw(part));
    if (i < params.length) chunks.push(sql`${params[i]}`);
  });
  return sql.join(chunks, sql.raw(''));
}

const marks = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 受け取った内容を書く間、トリガーが印や控えを付けないようにする */
function applying<T>(db: Db, fn: (tx: Db) => T): T {
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    t.run(stmt('UPDATE sync_ctl SET applying = 1 WHERE id = 1'));
    try {
      return fn(t);
    } finally {
      t.run(stmt('UPDATE sync_ctl SET applying = 0 WHERE id = 1'));
    }
  });
}

// ---------------------------------------------------------------- 送る

/** まだ送っていない行と削除の数 */
export function pendingCount(db: Db, spaceId: string): number {
  let count = 0;
  for (const table of SYNC_TABLES) {
    const row = db.get<{ n: number }>(
      stmt(`SELECT count(*) AS n FROM ${table.local} AS t WHERE t.dirty <> 0 AND ${table.spaceSql} = ?`, [spaceId]),
    );
    count += row?.n ?? 0;
  }
  const tomb = db.get<{ n: number }>(stmt('SELECT count(*) AS n FROM sync_tombstones WHERE space_id = ?', [spaceId]));
  return count + (tomb?.n ?? 0);
}

/** 受け取り直す（次の受け取りで最初から取りに行く） */
export function resetCursors(db: Db, spaceId: string): void {
  db.run(stmt('DELETE FROM sync_state WHERE space_id = ?', [spaceId]));
}

export async function push(db: Db, remote: Remote, spaceId: string): Promise<number> {
  let sent = 0;
  for (const table of SYNC_TABLES) {
    // 送る行に「送信中」の印を付ける。送っている間に端末で直された行は、トリガーが未送信に戻す
    db.run(stmt(`UPDATE ${table.local} AS t SET dirty = 2 WHERE t.dirty = 1 AND ${table.spaceSql} = ?`, [spaceId]));
    const rows = db.all<LocalRow>(
      stmt(`SELECT t.* FROM ${table.local} AS t WHERE t.dirty = 2 AND ${table.spaceSql} = ?`, [spaceId]),
    );
    if (rows.length === 0) continue;
    try {
      for (const part of chunk(rows, PUSH_CHUNK)) {
        await remote.upsert(
          table.remote,
          part.map((row) => toRemote(table, row, spaceId)),
          table.key,
        );
      }
    } catch (e) {
      // 次の同期でもう一度送る
      db.run(stmt(`UPDATE ${table.local} AS t SET dirty = 1 WHERE t.dirty = 2 AND ${table.spaceSql} = ?`, [spaceId]));
      throw e;
    }
    db.run(stmt(`UPDATE ${table.local} AS t SET dirty = 0 WHERE t.dirty = 2 AND ${table.spaceSql} = ?`, [spaceId]));
    sent += rows.length;
  }

  // 削除は子から親の順に伝える
  for (const table of [...SYNC_TABLES].reverse()) {
    if (!table.softDelete) continue;
    const ids = db
      .all<{ id: string }>(
        stmt('SELECT id FROM sync_tombstones WHERE tbl = ? AND space_id = ?', [table.remote, spaceId]),
      )
      .map((r) => r.id);
    for (const part of chunk(ids, PAGE)) {
      try {
        await remote.softDelete(table.remote, part);
      } catch (e) {
        if (!(e instanceof SyncDeniedError)) throw e;
        // 消す権限がなかった（ほかの人が記録した試合など）。端末の削除を取り下げ、サーバーの内容を取り直す
        resetCursors(db, spaceId);
      }
      db.run(
        stmt(`DELETE FROM sync_tombstones WHERE tbl = ? AND space_id = ? AND id IN (${marks(part.length)})`, [
          table.remote,
          spaceId,
          ...part,
        ]),
      );
      sent += part.length;
    }
  }
  return sent;
}

// ---------------------------------------------------------------- 受け取る

function removeLocal(tx: Db, table: SyncTable, row: RemoteRow): void {
  const id = row.id as string;
  if (table.local === 'games') {
    for (const child of ['period_checks', 'game_events', 'game_staff', 'game_roster']) {
      tx.run(stmt(`DELETE FROM ${child} WHERE game_id = ?`, [id]));
    }
  }
  if (table.local === 'teams') tx.run(stmt('DELETE FROM players WHERE team_id = ?', [id]));
  tx.run(stmt(`DELETE FROM ${table.local} WHERE id = ?`, [id]));
}

function applyRow(tx: Db, table: SyncTable, row: RemoteRow, spaceId: string): boolean {
  if (table.softDelete && row.deleted_at) {
    removeLocal(tx, table, row);
    return true;
  }
  const local = toLocal(table, row);
  if (table.parent) {
    const [parentTable, column] = table.parent;
    const parent = tx.get(stmt(`SELECT 1 AS x FROM ${parentTable} WHERE id = ?`, [local[column]]));
    // 親が消されている行は持たない
    if (!parent) return false;
  }
  const where = table.key.map((k) => `${k} = ?`).join(' AND ');
  const keyValues = table.key.map((k) => local[k]);
  const existing = tx.get<{ dirty: number }>(stmt(`SELECT dirty FROM ${table.local} WHERE ${where}`, keyValues));
  // 端末にまだ送っていない変更がある行は、端末の内容を残す（次の同期で送られる）
  if (existing && existing.dirty !== 0) return false;

  const values: LocalRow = { ...local, dirty: 0 };
  if (table.local === 'teams') values.space_id = spaceId;
  if (table.local === 'games') {
    values.space_id = spaceId;
    values.created_by = (row.created_by ?? null) as string | null;
  }
  const columns = Object.keys(values);
  const updates = columns.filter((c) => !table.key.includes(c)).map((c) => `${c} = excluded.${c}`);
  tx.run(
    stmt(
      `INSERT INTO ${table.local} (${columns.join(', ')}) VALUES (${marks(columns.length)}) ` +
        `ON CONFLICT (${table.key.join(', ')}) DO UPDATE SET ${updates.join(', ')}`,
      columns.map((c) => values[c]),
    ),
  );
  return true;
}

function overlapStart(cursor: string): string {
  const t = Date.parse(cursor);
  return Number.isFinite(t) ? new Date(t - OVERLAP_MS).toISOString() : cursor;
}

export async function pull(db: Db, remote: Remote, spaceId: string): Promise<number> {
  let received = 0;
  for (const table of SYNC_TABLES) {
    const state = db.get<{ cursor: string }>(
      stmt('SELECT cursor FROM sync_state WHERE space_id = ? AND tbl = ?', [spaceId, table.remote]),
    );
    let since: string | null = state ? overlapStart(state.cursor) : null;
    let limit = PAGE;
    let newest: string | null = state?.cursor ?? null;
    for (;;) {
      const rows = await remote.pull(table.remote, spaceId, since, limit, table.key);
      if (rows.length === 0) break;
      received += applying(db, (tx) => rows.filter((row) => applyRow(tx, table, row, spaceId)).length);
      const last = rows[rows.length - 1].updated_at as string;
      if (newest === null || Date.parse(last) > Date.parse(newest)) newest = last;
      if (rows.length < limit) break;
      // 同じ時刻の行だけで1ページが埋まったら、ページを広げて取り直す
      if (last === since) limit *= 2;
      else since = last;
    }
    if (newest !== null) {
      db.run(
        stmt(
          'INSERT INTO sync_state (space_id, tbl, cursor) VALUES (?, ?, ?) ' +
            'ON CONFLICT (space_id, tbl) DO UPDATE SET cursor = excluded.cursor',
          [spaceId, table.remote, newest],
        ),
      );
    }
  }
  return received;
}

export interface SyncResult {
  sent: number;
  received: number;
}

/** 1つのチームを同期する（送ってから受け取る） */
export async function syncSpace(db: Db, remote: Remote, spaceId: string): Promise<SyncResult> {
  const sent = await push(db, remote, spaceId);
  const received = await pull(db, remote, spaceId);
  return { sent, received };
}

/**
 * チームが使えなくなったとき（契約切れ）に、ほかの人が記録した試合を端末から消す（サーバーには伝えない）。
 * 自分が記録した試合と名簿は残す。次に使えるようになったら最初から受け取り直す。
 */
export function dropOthersGames(db: Db, spaceId: string, userId: string): void {
  applying(db, (tx) => {
    const others = 'SELECT id FROM games WHERE space_id = ? AND created_by IS NOT NULL AND created_by <> ?';
    for (const child of ['period_checks', 'game_events', 'game_staff', 'game_roster']) {
      tx.run(stmt(`DELETE FROM ${child} WHERE game_id IN (${others})`, [spaceId, userId]));
    }
    tx.run(stmt('DELETE FROM games WHERE space_id = ? AND created_by IS NOT NULL AND created_by <> ?', [spaceId, userId]));
    tx.run(stmt('DELETE FROM sync_state WHERE space_id = ?', [spaceId]));
  });
}

/** チームから外れたときなどに、そのチームの内容を端末から消す（サーバーには伝えない） */
export function purgeSpace(db: Db, spaceId: string): void {
  applying(db, (tx) => {
    const viaGame = 'game_id IN (SELECT id FROM games WHERE space_id = ?)';
    for (const child of ['period_checks', 'game_events', 'game_staff', 'game_roster']) {
      tx.run(stmt(`DELETE FROM ${child} WHERE ${viaGame}`, [spaceId]));
    }
    tx.run(stmt('DELETE FROM games WHERE space_id = ?', [spaceId]));
    tx.run(stmt('DELETE FROM players WHERE team_id IN (SELECT id FROM teams WHERE space_id = ?)', [spaceId]));
    tx.run(stmt('DELETE FROM teams WHERE space_id = ?', [spaceId]));
    tx.run(stmt('DELETE FROM sync_tombstones WHERE space_id = ?', [spaceId]));
    tx.run(stmt('DELETE FROM sync_state WHERE space_id = ?', [spaceId]));
    tx.run(stmt('DELETE FROM spaces WHERE id = ?', [spaceId]));
  });
}
