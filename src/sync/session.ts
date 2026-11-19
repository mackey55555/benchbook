import { useSyncExternalStore } from 'react';

import { db } from '@/db/client';
import {
  copyOwnRosterToSpace,
  currentSpaceId,
  listSpaces,
  setCurrentSpace,
} from '@/db/repo';
import * as schema from '@/db/schema';
import type { Space } from '@/db/schema';

import { supabase } from './client';
import { pendingCount, purgeSpace, syncSpace } from './engine';
import { supabaseRemote } from './supabaseRemote';

/**
 * サインインの状態、所属チーム、同期の状態をまとめて持つ。
 * 画面からは useTeamState() で読み、下の関数で操作する。
 */
export interface TeamState {
  /** サインインの状態を読み終えた */
  ready: boolean;
  userId: string | null;
  email: string | null;
  displayName: string;
  spaces: Space[];
  /** いま開いている置き場所。null は個人 */
  spaceId: string | null;
  syncing: boolean;
  /** 直近の同期が失敗した理由（成功すると消える） */
  syncError: string | null;
  lastSyncedAt: number | null;
  /** いまの置き場所の、まだ送っていない変更の数 */
  pending: number;
  /** 端末の内容が同期や切り替えで変わるたびに増える。画面の再読み込みに使う */
  dataVersion: number;
}

let state: TeamState = {
  ready: supabase === null,
  userId: null,
  email: null,
  displayName: '',
  spaces: [],
  spaceId: null,
  syncing: false,
  syncError: null,
  lastSyncedAt: null,
  pending: 0,
  dataVersion: 0,
};
const listeners = new Set<() => void>();
function set(patch: Partial<TeamState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useTeamState(): TeamState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export function getTeamState(): TeamState {
  return state;
}

/** 画面に出せる言葉にする */
export function errorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : '';
  if (/network|fetch|timeout|failed to connect/i.test(message)) return '通信できませんでした。電波の状況を確かめてください';
  if (/rate limit|too many/i.test(message)) return '少し時間をおいてから、もう一度試してください';
  if (/invalid.*(otp|token)|expired/i.test(message)) return 'コードが違うか、期限が切れています';
  // サーバーの関数が返すメッセージは日本語なので、そのまま出す
  return message || 'うまくいきませんでした。もう一度試してください';
}

function client() {
  if (!supabase) throw new Error('チームプランは、このアプリではまだ使えません');
  return supabase;
}

/** 端末にある内容から、画面用の状態を作り直す */
function readLocal(): Pick<TeamState, 'spaces' | 'spaceId' | 'pending'> {
  const spaceId = currentSpaceId(db);
  return { spaces: listSpaces(db), spaceId, pending: spaceId ? pendingCount(db, spaceId) : 0 };
}

/** 同期を通さない書き込みのあとに、未送信の数を数え直す */
export function refreshPending(): void {
  const next = readLocal();
  if (next.pending !== state.pending) set({ pending: next.pending });
}

// ---------------------------------------------------------------- サインイン

let started = false;

/** アプリの起動時に一度呼ぶ。保存してあるサインインの状態を読み、以後の変化を追う */
export function startSession(): void {
  if (started || !supabase) return;
  started = true;
  set(readLocal());
  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null;
    const changed = (user?.id ?? null) !== state.userId;
    set({ ready: true, userId: user?.id ?? null, email: user?.email ?? null });
    if (user && changed) {
      void loadProfile();
      void syncNow();
    }
  });
  void supabase.auth.getSession().then(() => set({ ready: true }));
}

/** アプリが前面にいる間だけ、サインインの更新を続ける */
export function setForeground(active: boolean): void {
  if (!supabase) return;
  if (active) void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
}

async function loadProfile(): Promise<void> {
  if (!state.userId) return;
  const { data } = await client().from('profiles').select('display_name').eq('id', state.userId).maybeSingle();
  if (data) set({ displayName: (data.display_name as string) ?? '' });
}

/** メールアドレスに確認コードを送る（はじめての人は、ここでアカウントができる） */
export async function requestCode(email: string): Promise<void> {
  const { error } = await client().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email: string, code: string): Promise<void> {
  const { error } = await client().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
  if (error) throw error;
}

export async function setDisplayName(name: string): Promise<void> {
  if (!state.userId) return;
  const displayName = name.trim().slice(0, 40);
  const { error } = await client().from('profiles').update({ display_name: displayName }).eq('id', state.userId);
  if (error) throw error;
  set({ displayName });
}

/** サインアウトする。端末にあるチームの内容は消す（個人の記録は残る） */
export async function signOut(): Promise<void> {
  for (const space of listSpaces(db)) purgeSpace(db, space.id);
  setCurrentSpace(db, null);
  set({ ...readLocal(), displayName: '', syncError: null, lastSyncedAt: null, dataVersion: state.dataVersion + 1 });
  await client().auth.signOut();
}

/**
 * アカウントを削除する。運営しているチームは内容ごと消え、ほかのチームからは抜ける。
 * 端末にあるチームの内容も消す（個人の記録は残る）。
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await client().rpc('delete_account');
  if (error) throw error;
  for (const space of listSpaces(db)) purgeSpace(db, space.id);
  setCurrentSpace(db, null);
  set({ ...readLocal(), displayName: '', syncError: null, lastSyncedAt: null, dataVersion: state.dataVersion + 1 });
  // サーバーの利用者はもういないので、端末のサインイン状態だけを消す
  await client().auth.signOut({ scope: 'local' });
}

// ---------------------------------------------------------------- チームと同期

interface MyTeamRow {
  id: string;
  name: string;
  role: 'owner' | 'member';
  active: boolean;
  complimentary: boolean;
  slot_assigned: boolean;
  member_count: number;
}

/** 所属チームの一覧を取り直し、端末の写しを合わせる。外れたチームの内容は端末から消す */
async function refreshSpaces(): Promise<void> {
  const { data, error } = await client().rpc('my_teams');
  if (error) throw error;
  const rows = (data ?? []) as MyTeamRow[];
  const keep = new Set(rows.map((r) => r.id));
  for (const space of listSpaces(db)) {
    if (!keep.has(space.id)) purgeSpace(db, space.id);
  }
  for (const r of rows) {
    const row = {
      id: r.id,
      name: r.name,
      role: r.role,
      active: r.active,
      complimentary: r.complimentary,
      slotAssigned: r.slot_assigned,
      memberCount: Number(r.member_count),
    };
    db.insert(schema.spaces).values(row).onConflictDoUpdate({ target: schema.spaces.id, set: row }).run();
  }
  // 開いていたチームが使えなくなったら、個人に戻す
  const current = currentSpaceId(db);
  if (current && !rows.some((r) => r.id === current && r.active)) setCurrentSpace(db, null);
}

let running: Promise<void> | null = null;

/** 所属チームを取り直して、使えるチームをすべて同期する。同時に動くのは1つだけ */
export function syncNow(): Promise<void> {
  if (!supabase || !state.userId) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    set({ syncing: true });
    const before = JSON.stringify(readLocal());
    let received = 0;
    try {
      await refreshSpaces();
      const remote = supabaseRemote(client());
      for (const space of listSpaces(db)) {
        if (!space.active) continue;
        received += (await syncSpace(db, remote, space.id)).received;
      }
      set({ syncError: null, lastSyncedAt: Date.now() });
    } catch (e) {
      set({ syncError: errorMessage(e) });
    } finally {
      const local = readLocal();
      const changed = received > 0 || JSON.stringify(local) !== before;
      set({ ...local, syncing: false, dataVersion: state.dataVersion + (changed ? 1 : 0) });
      running = null;
    }
  })();
  return running;
}

/** 開く置き場所を切り替える（null は個人） */
export function switchSpace(spaceId: string | null): void {
  setCurrentSpace(db, spaceId);
  set({ ...readLocal(), dataVersion: state.dataVersion + 1 });
  void syncNow();
}

/** チームを作る。個人の自チーム名簿を、そのままチームの名簿に写す */
export async function createTeam(name: string): Promise<string> {
  const { data, error } = await client().rpc('create_team', { p_name: name.trim() });
  if (error) throw error;
  const teamId = data as string;
  await syncNow();
  if (listSpaces(db).some((s) => s.id === teamId)) {
    copyOwnRosterToSpace(db, teamId, name.trim());
    await syncNow();
  }
  return teamId;
}

export async function renameTeam(teamId: string, name: string): Promise<void> {
  const { error } = await client().from('teams').update({ name: name.trim() }).eq('id', teamId);
  if (error) throw error;
  await syncNow();
}

/** 招待のコードを作る（14日間有効） */
export async function createInvite(teamId: string): Promise<string> {
  const { data, error } = await client().rpc('create_invite', { p_team: teamId });
  if (error) throw error;
  return data as string;
}

export const inviteLink = (token: string): string => `benchbook://join/${token}`;

/** 貼り付けられた招待のリンク・コードから、コードだけを取り出す */
export function parseInvite(text: string): string {
  const match = text.trim().match(/([0-9a-f]{36})\s*$/i);
  return match ? match[1].toLowerCase() : text.trim();
}

/** 招待を受けてチームに入り、そのチームを開く */
export async function acceptInvite(text: string): Promise<string> {
  const { data, error } = await client().rpc('accept_invite', { p_token: parseInvite(text) });
  if (error) throw error;
  const teamId = data as string;
  await syncNow();
  if (listSpaces(db).some((s) => s.id === teamId && s.active)) switchSpace(teamId);
  return teamId;
}

export interface Member {
  userId: string;
  role: 'owner' | 'member';
  name: string;
}

export async function listMembers(teamId: string): Promise<Member[]> {
  const members = await client().from('team_members').select('user_id, role, joined_at').eq('team_id', teamId).order('joined_at');
  if (members.error) throw members.error;
  const ids = (members.data ?? []).map((m) => m.user_id as string);
  const profiles = await client().from('profiles').select('id, display_name').in('id', ids);
  if (profiles.error) throw profiles.error;
  const names = new Map((profiles.data ?? []).map((p) => [p.id as string, (p.display_name as string) ?? '']));
  return (members.data ?? []).map((m) => ({
    userId: m.user_id as string,
    role: m.role as Member['role'],
    name: names.get(m.user_id as string) ?? '',
  }));
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  const { error } = await client().rpc('remove_member', { p_team: teamId, p_user: userId });
  if (error) throw error;
}

export async function leaveTeam(teamId: string): Promise<void> {
  const { error } = await client().rpc('leave_team', { p_team: teamId });
  if (error) throw error;
  await syncNow();
}

export async function deleteTeam(teamId: string): Promise<void> {
  const { error } = await client().rpc('delete_team', { p_team: teamId });
  if (error) throw error;
  await syncNow();
}
