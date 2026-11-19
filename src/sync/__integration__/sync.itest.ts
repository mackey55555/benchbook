/**
 * 手元の Supabase を相手にした通しの確認。`supabase start` をしてから `sh scripts/test-sync.sh` で動かす。
 * ふだんの `npx jest` には含めない（サーバーが要るため）。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import {
  addEvent,
  addPlayer,
  addRosterEntry,
  createGame,
  deleteGame,
  ensureOwnTeam,
  getGameBundle,
  listGames,
  listPlayers,
  setCurrentSpace,
  startGame,
  type Db,
} from '@/db/repo';
import * as schema from '@/db/schema';
import { openTestDb } from '@/db/__tests__/testDb';

import { pendingCount, syncSpace } from '../engine';
import { supabaseRemote } from '../supabaseRemote';

const URL = process.env.SUPABASE_TEST_URL;
if (!URL) throw new Error('SUPABASE_TEST_URL がありません。sh scripts/test-sync.sh から動かしてください');
const ANON = process.env.SUPABASE_TEST_ANON ?? '';
const SERVICE = process.env.SUPABASE_TEST_SERVICE ?? '';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function signUp(admin: SupabaseClient, label: string): Promise<{ client: SupabaseClient; id: string }> {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = 'password-1234';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(URL!, ANON, opts);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { client, id: created.data.user.id };
}

function device(teamId: string): Db {
  const { db } = openTestDb();
  db.insert(schema.spaces).values({ id: teamId, name: 'HAWKS', role: 'member', active: true }).run();
  setCurrentSpace(db, teamId);
  return db;
}

function recordGame(db: Db): string {
  const own = ensureOwnTeam(db);
  for (const n of ['4', '5', '6', '7', '8']) addPlayer(db, own.id, { number: n, name: `P${n}` });
  const game = createGame(db);
  addRosterEntry(db, game.id, 'B', { number: '10' });
  startGame(db, game.id);
  const bundle = getGameBundle(db, game.id)!;
  addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: bundle.roster[0].id, type: 'FG2_MADE' });
  addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: null, type: 'TOV' });
  db.update(schema.games).set({ status: 'finished', finishedAt: Date.now() }).where(eq(schema.games.id, game.id)).run();
  return game.id;
}

describe('手元のSupabaseとの同期', () => {
  jest.setTimeout(60_000);

  test('運営者が記録した試合がメンバーに届き、メンバーは消せない', async () => {
    const admin = createClient(URL!, SERVICE, opts);
    const owner = await signUp(admin, 'owner');
    const member = await signUp(admin, 'member');
    const outsider = await signUp(admin, 'outsider');

    const team = await owner.client.rpc('create_team', { p_name: 'HAWKS' });
    if (team.error) throw team.error;
    const teamId = team.data as string;
    // 契約の代わりに、特別扱いの印を付ける
    const comp = await admin.from('teams').update({ complimentary: true }).eq('id', teamId);
    if (comp.error) throw comp.error;
    const invite = await owner.client.rpc('create_invite', { p_team: teamId });
    if (invite.error) throw invite.error;
    const joined = await member.client.rpc('accept_invite', { p_token: invite.data as string });
    if (joined.error) throw joined.error;

    const a = device(teamId);
    const b = device(teamId);
    const gameId = recordGame(a);
    await syncSpace(a, supabaseRemote(owner.client), teamId);
    expect(pendingCount(a, teamId)).toBe(0);

    const got = await syncSpace(b, supabaseRemote(member.client), teamId);
    expect(got.received).toBeGreaterThan(0);
    const bundle = getGameBundle(b, gameId)!;
    expect(bundle.game.createdBy).toBe(owner.id);
    expect(bundle.events.filter((e) => e.type === 'FG2_MADE' || e.type === 'TOV')).toHaveLength(2);
    expect(listGames(b)[0].score).toEqual({ A: 2, B: 0 });
    expect(listPlayers(b, ensureOwnTeam(b).id)).toHaveLength(5);

    // 2回目は送るものがない（直近の分は重ねて受け取るが、内容は変わらない）
    const again = await syncSpace(b, supabaseRemote(member.client), teamId);
    expect(again.sent).toBe(0);
    expect(pendingCount(b, teamId)).toBe(0);

    // メンバーが運営者の試合を消そうとしても、断られて元に戻る
    deleteGame(b, gameId);
    await syncSpace(b, supabaseRemote(member.client), teamId);
    expect(listGames(b)).toHaveLength(1);

    // メンバーの修正は運営者に届く
    const target = getGameBundle(b, gameId)!.events.find((e) => e.type === 'FG2_MADE')!;
    b.update(schema.gameEvents).set({ voidedAt: Date.now() }).where(eq(schema.gameEvents.id, target.id)).run();
    await syncSpace(b, supabaseRemote(member.client), teamId);
    await syncSpace(a, supabaseRemote(owner.client), teamId);
    expect(listGames(a)[0].score).toEqual({ A: 0, B: 0 });

    // 運営者は消せて、メンバーからも消える
    deleteGame(a, gameId);
    await syncSpace(a, supabaseRemote(owner.client), teamId);
    await syncSpace(b, supabaseRemote(member.client), teamId);
    expect(listGames(b)).toHaveLength(0);

    // チームに入っていない人には何も届かず、書き込みも断られる
    const c = device(teamId);
    await syncSpace(c, supabaseRemote(outsider.client), teamId);
    expect(c.select().from(schema.players).all()).toHaveLength(0);
    recordGame(c);
    await expect(syncSpace(c, supabaseRemote(outsider.client), teamId)).rejects.toThrow();
  });
});
