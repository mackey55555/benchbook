/**
 * 端末のテーブルとサーバーのテーブルの対応。
 * 端末の行（SQLiteの列名のまま）とサーバーの行を相互に変換する。
 * 順番は親から子（受け取りはこの順、削除は逆順）。
 */

export type LocalRow = Record<string, string | number | null>;
export type RemoteRow = Record<string, string | number | boolean | null>;

export interface SyncTable {
  /** 端末のテーブル名 */
  local: string;
  /** サーバーのテーブル名 */
  remote: string;
  /** 主キーの列（端末・サーバー共通の名前） */
  key: string[];
  /** そのまま写す列 */
  columns: string[];
  /** 端末では 0/1、サーバーでは真偽値の列 */
  booleans: string[];
  /** 列名が違うもの（端末 → サーバー） */
  rename: Record<string, string>;
  /** その行が属するチームを求めるSQL（端末のテーブルを t として、チームIDを返す式） */
  spaceSql: string;
  /** 親の行（なければ受け取った行を捨てる）。[端末のテーブル, 端末の列] */
  parent?: [string, string];
  /** サーバーに deleted_at があるか */
  softDelete: boolean;
}

const viaGame = '(SELECT g.space_id FROM games g WHERE g.id = t.game_id)';

export const SYNC_TABLES: SyncTable[] = [
  {
    local: 'teams',
    remote: 'squads',
    key: ['id'],
    columns: ['id', 'name', 'created_at'],
    booleans: ['is_own'],
    rename: {},
    spaceSql: 't.space_id',
    softDelete: true,
  },
  {
    local: 'players',
    remote: 'squad_players',
    key: ['id'],
    columns: ['id', 'number', 'name'],
    booleans: ['is_active'],
    rename: { team_id: 'squad_id' },
    spaceSql: '(SELECT s.space_id FROM teams s WHERE s.id = t.team_id)',
    parent: ['teams', 'team_id'],
    softDelete: true,
  },
  {
    local: 'games',
    remote: 'games',
    key: ['id'],
    columns: [
      'id',
      'date',
      'league_name',
      'venue',
      'own_side',
      'team_a_name',
      'team_b_name',
      'period_minutes',
      'ot_minutes',
      'status',
      'current_period',
      'created_at',
      'finished_at',
    ],
    booleans: [],
    rename: {},
    spaceSql: 't.space_id',
    softDelete: true,
  },
  {
    local: 'game_roster',
    remote: 'game_roster',
    key: ['id'],
    columns: ['id', 'game_id', 'side', 'player_id', 'number', 'name'],
    booleans: ['is_starter', 'is_captain'],
    rename: {},
    spaceSql: viaGame,
    parent: ['games', 'game_id'],
    softDelete: true,
  },
  {
    local: 'game_staff',
    remote: 'game_staff',
    key: ['id'],
    columns: ['id', 'game_id', 'side', 'role', 'name'],
    booleans: [],
    rename: {},
    spaceSql: viaGame,
    parent: ['games', 'game_id'],
    softDelete: true,
  },
  {
    local: 'game_events',
    remote: 'game_events',
    key: ['id'],
    columns: [
      'id',
      'game_id',
      'order_key',
      'period',
      'side',
      'roster_id',
      'type',
      'foul_kind',
      'ft_awarded',
      'clock_seconds',
      'created_at',
      'voided_at',
      'replaces_event_id',
    ],
    booleans: [],
    rename: {},
    spaceSql: viaGame,
    parent: ['games', 'game_id'],
    softDelete: false,
  },
  {
    local: 'period_checks',
    remote: 'period_checks',
    key: ['game_id', 'period'],
    columns: ['game_id', 'period', 'score_a', 'score_b', 'team_fouls_a', 'team_fouls_b', 'note', 'confirmed_at'],
    booleans: ['matched'],
    rename: {},
    spaceSql: viaGame,
    parent: ['games', 'game_id'],
    softDelete: false,
  },
];

/** 端末の行をサーバーへ送る形にする */
export function toRemote(table: SyncTable, row: LocalRow, teamId: string): RemoteRow {
  const out: RemoteRow = { team_id: teamId };
  for (const c of table.columns) out[c] = row[c] ?? null;
  for (const c of table.booleans) out[c] = row[c] === 1;
  for (const [local, remote] of Object.entries(table.rename)) out[remote] = row[local] ?? null;
  return out;
}

/** サーバーの行を端末に書く形にする（置き場所の列と同期の印は呼び出し側が足す） */
export function toLocal(table: SyncTable, row: RemoteRow): LocalRow {
  const out: LocalRow = {};
  for (const c of table.columns) out[c] = (row[c] ?? null) as string | number | null;
  for (const c of table.booleans) out[c] = row[c] ? 1 : 0;
  for (const [local, remote] of Object.entries(table.rename)) out[local] = (row[remote] ?? null) as string | null;
  return out;
}
