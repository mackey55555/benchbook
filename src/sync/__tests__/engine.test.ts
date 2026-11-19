import { eq } from 'drizzle-orm';

import {
  addEvent,
  addPlayer,
  addRosterEntry,
  createGame,
  createTeam,
  deleteGame,
  deletePlayer,
  ensureOwnTeam,
  getGameBundle,
  listGames,
  listPlayers,
  listTeams,
  setCurrentSpace,
  setCurrentUser,
  startGame,
  updateGame,
  updatePlayer,
  voidEvent,
  type Db,
} from '@/db/repo';
import * as schema from '@/db/schema';
import { openTestDb } from '@/db/__tests__/testDb';

import { dropOthersGames, pendingCount, purgeSpace, push, syncSpace } from '../engine';
import { FakeRemote } from '../testing/fakeRemote';

const TEAM = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function device(space: string | null = TEAM): Db {
  const { db } = openTestDb();
  db.insert(schema.spaces).values({ id: TEAM, name: 'HAWKS', role: 'member', active: true }).run();
  setCurrentSpace(db, space);
  return db;
}

/** 自チームに選手を入れて試合を1つ記録する */
function recordGame(db: Db): string {
  const own = ensureOwnTeam(db);
  for (const n of ['4', '5', '6', '7', '8']) {
    if (!listPlayers(db, own.id).some((p) => p.number === n)) addPlayer(db, own.id, { number: n, name: `P${n}` });
  }
  const game = createGame(db);
  updateGame(db, game.id, { teamBName: 'RIVALS' });
  addRosterEntry(db, game.id, 'B', { number: '10' });
  startGame(db, game.id);
  const bundle = getGameBundle(db, game.id)!;
  addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: bundle.roster[0].id, type: 'FG2_MADE' });
  addEvent(db, { gameId: game.id, period: 1, side: 'A', rosterId: bundle.roster[1].id, type: 'FG3_MADE' });
  // 進行中の試合は端末に1つだけなので、終了済みにしておく
  db.update(schema.games).set({ status: 'finished', finishedAt: Date.now() }).where(eq(schema.games.id, game.id)).run();
  return game.id;
}

describe('同期', () => {
  test('1台で記録した試合が、もう1台に届く', async () => {
    const remote = new FakeRemote();
    const a = device();
    const b = device();
    const gameId = recordGame(a);
    expect(pendingCount(a, TEAM)).toBeGreaterThan(0);

    await syncSpace(a, remote, TEAM);
    expect(pendingCount(a, TEAM)).toBe(0);
    await syncSpace(b, remote, TEAM);

    const got = getGameBundle(b, gameId)!;
    expect(got.game.spaceId).toBe(TEAM);
    expect(got.game.teamBName).toBe('RIVALS');
    expect(got.game.createdBy).toBe('someone');
    expect(got.events.filter((e) => e.type === 'FG2_MADE' || e.type === 'FG3_MADE')).toHaveLength(2);
    expect(got.roster).toHaveLength(getGameBundle(a, gameId)!.roster.length);
    expect(listGames(b)[0].score).toEqual({ A: 5, B: 0 });
    // 受け取っただけの端末には、送るものがない
    expect(pendingCount(b, TEAM)).toBe(0);
    // 自チームの名簿も1つだけ届く
    expect(listTeams(b).filter((t) => t.isOwn)).toHaveLength(1);
    expect(listPlayers(b, listTeams(b)[0].id)).toHaveLength(5);
  });

  test('何も変わっていなければ送らない', async () => {
    const remote = new FakeRemote();
    const a = device();
    recordGame(a);
    await syncSpace(a, remote, TEAM);
    const before = remote.calls.upsert;
    const result = await syncSpace(a, remote, TEAM);
    expect(remote.calls.upsert).toBe(before);
    expect(result.sent).toBe(0);
    expect(pendingCount(a, TEAM)).toBe(0);
  });

  test('ほかの端末での修正（取り消し）が届く', async () => {
    const remote = new FakeRemote();
    const a = device();
    const b = device();
    const gameId = recordGame(a);
    await syncSpace(a, remote, TEAM);
    await syncSpace(b, remote, TEAM);

    const target = getGameBundle(b, gameId)!.events.find((e) => e.type === 'FG3_MADE')!;
    voidEvent(b, target.id);
    expect(pendingCount(b, TEAM)).toBe(1);
    await syncSpace(b, remote, TEAM);
    await syncSpace(a, remote, TEAM);

    expect(listGames(a)[0].score).toEqual({ A: 2, B: 0 });
  });

  test('名簿の修正と削除が届く', async () => {
    const remote = new FakeRemote();
    const a = device();
    const b = device();
    recordGame(a);
    await syncSpace(a, remote, TEAM);
    await syncSpace(b, remote, TEAM);

    const own = listTeams(b).find((t) => t.isOwn)!;
    const [first, second] = listPlayers(b, own.id);
    updatePlayer(b, first.id, { name: '改名' });
    deletePlayer(b, second.id);
    await syncSpace(b, remote, TEAM);
    await syncSpace(a, remote, TEAM);

    const players = listPlayers(a, own.id);
    expect(players).toHaveLength(4);
    expect(players.find((p) => p.id === first.id)!.name).toBe('改名');
  });

  test('試合の削除が届き、子の行も消える', async () => {
    const remote = new FakeRemote();
    const a = device();
    const b = device();
    const gameId = recordGame(a);
    await syncSpace(a, remote, TEAM);
    await syncSpace(b, remote, TEAM);

    deleteGame(a, gameId);
    await syncSpace(a, remote, TEAM);
    await syncSpace(b, remote, TEAM);

    expect(listGames(b)).toHaveLength(0);
    expect(b.select().from(schema.gameEvents).all()).toHaveLength(0);
    expect(b.select().from(schema.gameRoster).all()).toHaveLength(0);
    // 新しく入った端末にも、消した試合は届かない
    const c = device();
    await syncSpace(c, remote, TEAM);
    expect(listGames(c)).toHaveLength(0);
    expect(c.select().from(schema.gameEvents).all()).toHaveLength(0);
  });

  test('削除を断られたら、端末の削除を取り下げて元に戻す', async () => {
    const remote = new FakeRemote();
    const a = device();
    const b = device();
    const gameId = recordGame(a);
    await syncSpace(a, remote, TEAM);
    await syncSpace(b, remote, TEAM);

    remote.denyDelete.add(gameId);
    deleteGame(b, gameId);
    await syncSpace(b, remote, TEAM);

    expect(listGames(b)).toHaveLength(1);
    expect(getGameBundle(b, gameId)!.events.length).toBeGreaterThan(0);
    expect(pendingCount(b, TEAM)).toBe(0);
  });

  test('送信に失敗しても、次の同期で送られる', async () => {
    const remote = new FakeRemote();
    const a = device();
    recordGame(a);
    remote.failUpsert = true;
    await expect(push(a, remote, TEAM)).rejects.toThrow('network');
    const pending = pendingCount(a, TEAM);
    expect(pending).toBeGreaterThan(0);
    remote.failUpsert = false;
    await syncSpace(a, remote, TEAM);
    expect(pendingCount(a, TEAM)).toBe(0);
    expect(remote.rows('games')).toHaveLength(1);
  });

  test('送っている間に直した行は、未送信のまま残る', async () => {
    const remote = new FakeRemote();
    const a = device();
    const gameId = recordGame(a);
    const original = remote.upsert.bind(remote);
    remote.upsert = async (table, rows, key) => {
      if (table === 'games') updateGame(a, gameId, { venue: '市民体育館' });
      await original(table, rows, key);
    };
    await push(a, remote, TEAM);
    expect(pendingCount(a, TEAM)).toBe(1);
    remote.upsert = original;
    await syncSpace(a, remote, TEAM);
    expect(remote.rows('games')[0].venue).toBe('市民体育館');
    expect(pendingCount(a, TEAM)).toBe(0);
  });

  test('未送信の変更がある行は、受け取りで上書きしない', async () => {
    const remote = new FakeRemote();
    const a = device();
    const b = device();
    const gameId = recordGame(a);
    await syncSpace(a, remote, TEAM);
    await syncSpace(b, remote, TEAM);

    updateGame(a, gameId, { venue: 'A会場' });
    await syncSpace(a, remote, TEAM);
    updateGame(b, gameId, { venue: 'B会場' });
    // b は送ってから受け取るので、あとから送った b の内容が残る
    await syncSpace(b, remote, TEAM);
    expect(b.select().from(schema.games).where(eq(schema.games.id, gameId)).get()!.venue).toBe('B会場');
    await syncSpace(a, remote, TEAM);
    expect(a.select().from(schema.games).where(eq(schema.games.id, gameId)).get()!.venue).toBe('B会場');
  });

  test('同じ時刻の行がページより多くても、全部受け取る', async () => {
    const remote = new FakeRemote();
    remote.freeze = true;
    const a = device();
    const own = ensureOwnTeam(a);
    const b = device();
    // 1200人分（ページは500件）
    a.transaction((tx) => {
      for (let i = 0; i < 1200; i++) {
        tx.insert(schema.players)
          .values({ id: `p${String(i).padStart(4, '0')}`, teamId: own.id, number: String(i % 100), name: '' })
          .run();
      }
    });
    await syncSpace(a, remote, TEAM);
    await syncSpace(b, remote, TEAM);
    expect(b.select().from(schema.players).all()).toHaveLength(1200);
  });

  test('個人の置き場所の内容は送らない', async () => {
    const remote = new FakeRemote();
    const a = device(null);
    recordGame(a);
    createTeam(a, '相手');
    expect(pendingCount(a, TEAM)).toBe(0);
    await syncSpace(a, remote, TEAM);
    expect(remote.rows('games')).toHaveLength(0);
    expect(remote.rows('squads')).toHaveLength(0);
    // 個人で消しても、削除の控えは作らない
    deleteGame(a, listGames(a)[0].game.id);
    expect(a.select().from(schema.syncTombstones).all()).toHaveLength(0);
  });

  test('置き場所ごとに一覧が分かれる', async () => {
    const a = device(null);
    recordGame(a);
    setCurrentSpace(a, TEAM);
    expect(listGames(a)).toHaveLength(0);
    recordGame(a);
    expect(listGames(a)).toHaveLength(1);
    expect(listTeams(a).every((t) => t.spaceId === TEAM)).toBe(true);
    setCurrentSpace(a, null);
    expect(listGames(a)).toHaveLength(1);
    expect(listTeams(a).every((t) => t.spaceId === null)).toBe(true);
  });

  test('チームから外れたら、そのチームの内容だけを端末から消す', async () => {
    const remote = new FakeRemote();
    const a = device(null);
    recordGame(a);
    setCurrentSpace(a, TEAM);
    recordGame(a);
    await syncSpace(a, remote, TEAM);

    purgeSpace(a, TEAM);
    expect(a.select().from(schema.games).all()).toHaveLength(1);
    expect(a.select().from(schema.games).all()[0].spaceId).toBeNull();
    expect(a.select().from(schema.syncTombstones).all()).toHaveLength(0);
    // サーバーの内容には触れない
    expect(remote.rows('games').filter((g) => g.deleted_at)).toHaveLength(0);
    expect(pendingCount(a, OTHER)).toBe(0);
  });

  test('契約が切れたチームでは、自分が記録した試合だけが残る', async () => {
    const remote = new FakeRemote();
    const a = device();
    const b = device();
    const theirs = recordGame(a);
    await syncSpace(a, remote, TEAM);
    await syncSpace(b, remote, TEAM);
    // b も1試合記録して送る。サーバーは b の利用者IDを記録した人として返す
    setCurrentUser(b, 'user-b');
    const mine = recordGame(b);
    await push(b, remote, TEAM);
    remote.rows('games').find((g) => g.id === mine)!.created_by = 'user-b';
    await syncSpace(b, remote, TEAM);
    expect(listGames(b)).toHaveLength(2);

    // 契約が切れる
    b.update(schema.spaces).set({ active: false }).where(eq(schema.spaces.id, TEAM)).run();
    expect(listGames(b).map((g) => g.game.id)).toEqual([mine]);
    dropOthersGames(b, TEAM, 'user-b');
    expect(b.select().from(schema.games).all().map((g) => g.id)).toEqual([mine]);
    expect(b.select().from(schema.gameEvents).all().every((e) => e.gameId === mine)).toBe(true);
    // 消したことはサーバーに伝えない
    expect(pendingCount(b, TEAM)).toBe(0);
    expect(remote.rows('games').filter((g) => g.deleted_at)).toHaveLength(0);

    // 契約が戻ると、ほかの人の試合も受け取り直す
    b.update(schema.spaces).set({ active: true }).where(eq(schema.spaces.id, TEAM)).run();
    await syncSpace(b, remote, TEAM);
    expect(listGames(b).map((g) => g.game.id).sort()).toEqual([theirs, mine].sort());
  });
});
