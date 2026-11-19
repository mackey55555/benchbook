import { SyncDeniedError, type Remote } from '../engine';
import type { RemoteRow } from '../tables';

/** メモリ上の偽サーバー。updated_at は書き込みのたびに進む */
export class FakeRemote implements Remote {
  tables = new Map<string, Map<string, RemoteRow>>();
  private clock = Date.parse('2026-01-01T00:00:00.000Z');
  /** 同じ時刻で書き込みたいときに true にする */
  freeze = false;
  /** softDelete を断る行のID */
  denyDelete = new Set<string>();
  failUpsert = false;
  calls = { upsert: 0, pull: 0 };

  private now(): string {
    if (!this.freeze) this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private table(name: string): Map<string, RemoteRow> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  rows(name: string): RemoteRow[] {
    return [...this.table(name).values()];
  }

  async upsert(table: string, rows: RemoteRow[], key: string[]): Promise<void> {
    this.calls.upsert++;
    if (this.failUpsert) throw new Error('network');
    const t = this.table(table);
    for (const row of rows) {
      const id = key.map((k) => row[k]).join('|');
      const prev = t.get(id);
      t.set(id, { deleted_at: null, created_by: 'someone', ...prev, ...row, updated_at: this.now() });
    }
  }

  async softDelete(table: string, ids: string[]): Promise<void> {
    const t = this.table(table);
    if (ids.some((id) => this.denyDelete.has(id))) throw new SyncDeniedError('denied');
    for (const id of ids) {
      const prev = t.get(id);
      if (prev) t.set(id, { ...prev, deleted_at: this.now(), updated_at: this.now() });
    }
  }

  async pull(table: string, teamId: string, since: string | null, limit: number, key: string[]): Promise<RemoteRow[]> {
    this.calls.pull++;
    const id = (r: RemoteRow) => key.map((k) => r[k]).join('|');
    return this.rows(table)
      .filter((r) => r.team_id === teamId && (since === null || Date.parse(r.updated_at as string) >= Date.parse(since)))
      .sort((a, b) => Date.parse(a.updated_at as string) - Date.parse(b.updated_at as string) || id(a).localeCompare(id(b)))
      .slice(0, limit);
  }
}
