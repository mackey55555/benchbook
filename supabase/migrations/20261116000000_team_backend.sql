-- Benchbook チームプランの土台（docs/SPEC.md 10章）
--
-- 方針
-- - サーバーは保存と受け渡しだけ。集計は端末側で行う
-- - 役割は運営者（owner）とメンバー（member）の2つ
-- - チームの内容を読める・書けるのは、そのチームのメンバーで、かつチームが有効（契約中または特別扱い）のとき
-- - 端末で作った行のID（ULID）をそのまま使う。行は物理削除せず deleted_at を立てる
-- - 端末は updated_at の続きから取りに行く（updated_at はサーバーが付ける）

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- 利用者

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- サインアップ時にプロフィールを作る
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- 契約

-- 運営者の契約。段階（tier）が、契約できるチームの数（枠）。書き込むのはサーバー側の処理だけ
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier integer not null check (tier between 1 and 5),
  expires_at timestamptz not null,
  product_id text not null default '',
  store text not null default 'app_store',
  original_transaction_id text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- チーム

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  owner_id uuid not null references auth.users (id),
  -- 運営者の契約の枠を、このチームに割り当てているか
  slot_assigned boolean not null default false,
  slot_assigned_at timestamptz,
  -- 契約なしで全機能を使えるチーム（自チーム・協力チーム用）。管理者がサーバーで直接付ける
  complimentary boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index teams_owner_idx on public.teams (owner_id);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);

-- 招待リンク。トークンを知っている人がチームに参加できる
create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz
);

-- ---------------------------------------------------------------- 判定用の関数
-- RLS の中から呼ぶ。テーブルの RLS を通さずに判定するため security definer にする

create function public.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid());
$$;

create function public.is_team_owner(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and role = 'owner');
$$;

-- チームが有効か：特別扱い、または運営者の契約が有効で、その枠が割り当てられている
create function public.team_is_active(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from teams t
    left join subscriptions s on s.user_id = t.owner_id and s.expires_at > now()
    where t.id = p_team
      and t.deleted_at is null
      and (t.complimentary or (t.slot_assigned and s.user_id is not null))
  );
$$;

-- メンバーで、かつチームが有効（チームの内容を読み書きできる条件）
create function public.can_use_team(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_team_member(p_team) and public.team_is_active(p_team);
$$;

-- ---------------------------------------------------------------- チームの操作（RPC）

-- チームを作る。1人が運営者になれるチームは5つまで
create function public.create_team(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_team uuid;
begin
  if v_user is null then raise exception 'サインインが必要です' using errcode = '28000'; end if;
  if (select count(*) from teams where owner_id = v_user and deleted_at is null) >= 5 then
    raise exception '運営者になれるチームは5つまでです' using errcode = 'P0001';
  end if;
  insert into teams (name, owner_id) values (btrim(p_name), v_user) returning id into v_team;
  insert into team_members (team_id, user_id, role) values (v_team, v_user, 'owner');
  return v_team;
end;
$$;

-- 契約の枠をチームに割り当てる・外す（運営者だけ）。割り当ては段階の数まで
create function public.set_team_slot(p_team uuid, p_assigned boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_tier integer;
begin
  if not exists (select 1 from teams where id = p_team and owner_id = v_user and deleted_at is null) then
    raise exception 'このチームの運営者ではありません' using errcode = '42501';
  end if;
  if p_assigned then
    select tier into v_tier from subscriptions where user_id = v_user and expires_at > now();
    if v_tier is null then raise exception '有効な契約がありません' using errcode = 'P0001'; end if;
    if (select count(*) from teams where owner_id = v_user and slot_assigned and deleted_at is null and id <> p_team) >= v_tier then
      raise exception '契約しているチーム数の上限です' using errcode = 'P0001';
    end if;
  end if;
  update teams
  set slot_assigned = p_assigned, slot_assigned_at = case when p_assigned then now() else null end
  where id = p_team;
end;
$$;

-- 招待リンクを作る。メンバーなら誰でも作れる（チームが有効なとき）
create function public.create_invite(p_team uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  if not public.can_use_team(p_team) then
    raise exception 'このチームの招待は作れません' using errcode = '42501';
  end if;
  insert into team_invites (team_id, created_by) values (p_team, auth.uid()) returning token into v_token;
  return v_token;
end;
$$;

-- 招待を受けてチームに参加する
create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_team uuid;
begin
  if v_user is null then raise exception 'サインインが必要です' using errcode = '28000'; end if;
  select i.team_id into v_team
  from team_invites i join teams t on t.id = i.team_id
  where i.token = p_token and i.revoked_at is null and i.expires_at > now() and t.deleted_at is null;
  if v_team is null then raise exception '招待が無効か、期限が切れています' using errcode = 'P0001'; end if;
  insert into team_members (team_id, user_id, role) values (v_team, v_user, 'member')
  on conflict (team_id, user_id) do nothing;
  return v_team;
end;
$$;

-- メンバーを外す（運営者だけ。運営者自身は外せない）
create function public.remove_member(p_team uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_owner(p_team) then
    raise exception 'メンバーを外せるのは運営者だけです' using errcode = '42501';
  end if;
  delete from team_members where team_id = p_team and user_id = p_user and role <> 'owner';
end;
$$;

-- チームを抜ける（運営者は抜けられない）
create function public.leave_team(p_team uuid) returns void
language sql security definer set search_path = public as $$
  delete from team_members where team_id = p_team and user_id = auth.uid() and role <> 'owner';
$$;

-- チームを削除する（運営者だけ。内容は残し、開けなくする）
create function public.delete_team(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_owner(p_team) then
    raise exception 'チームを削除できるのは運営者だけです' using errcode = '42501';
  end if;
  update teams set deleted_at = now(), slot_assigned = false, slot_assigned_at = null where id = p_team;
end;
$$;

-- ---------------------------------------------------------------- チームの内容（端末のテーブルと同じ形）

-- updated_at はサーバーの時刻で付ける（端末は続きから取りに行く）
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 名簿のまとまり（自チームと、保存した相手チーム）
create table public.squads (
  id text primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  is_own boolean not null default false,
  created_at bigint not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.squad_players (
  id text primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  squad_id text not null references public.squads (id),
  number text not null,
  name text not null default '',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.games (
  id text primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  date text not null,
  league_name text not null default '',
  venue text not null default '',
  own_side text not null default 'A' check (own_side in ('A', 'B')),
  team_a_name text not null default '',
  team_b_name text not null default '',
  period_minutes integer not null default 10,
  ot_minutes integer not null default 5,
  status text not null default 'prep' check (status in ('prep', 'live', 'finished')),
  current_period integer not null default 1,
  created_at bigint not null,
  finished_at bigint,
  -- 記録した人。ほかの人の試合を削除できるのは運営者だけ
  created_by uuid not null default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.game_roster (
  id text primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  game_id text not null references public.games (id),
  side text not null check (side in ('A', 'B')),
  player_id text,
  number text not null,
  name text not null default '',
  is_starter boolean not null default false,
  is_captain boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.game_staff (
  id text primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  game_id text not null references public.games (id),
  side text not null check (side in ('A', 'B')),
  role text not null check (role in ('HC', 'AC')),
  name text not null default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 記録の本体。追記型で、取り消しは voided_at を立てる
create table public.game_events (
  id text primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  game_id text not null references public.games (id),
  order_key double precision not null,
  period integer not null,
  side text check (side in ('A', 'B')),
  roster_id text,
  type text not null,
  foul_kind text,
  ft_awarded integer,
  clock_seconds integer,
  created_at bigint not null,
  voided_at bigint,
  replaces_event_id text,
  updated_at timestamptz not null default now()
);

create table public.period_checks (
  team_id uuid not null references public.teams (id) on delete cascade,
  game_id text not null references public.games (id),
  period integer not null,
  score_a integer not null,
  score_b integer not null,
  team_fouls_a integer not null,
  team_fouls_b integer not null,
  matched boolean not null,
  note text not null default '',
  confirmed_at bigint not null,
  updated_at timestamptz not null default now(),
  primary key (game_id, period)
);

-- ほかの人が記録した試合を削除（deleted_at を立てる）できるのは、運営者だけ
create function public.guard_game_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and auth.uid() is not null
     and old.created_by <> auth.uid()
     and not public.is_team_owner(old.team_id) then
    raise exception 'ほかの人が記録した試合を削除できるのは運営者だけです' using errcode = '42501';
  end if;
  -- 記録した人と所属チームは書き換えさせない
  new.created_by := old.created_by;
  new.team_id := old.team_id;
  return new;
end;
$$;
create trigger games_guard_delete before update on public.games
for each row execute function public.guard_game_delete();

do $$
declare
  t text;
begin
  foreach t in array array['squads', 'squad_players', 'games', 'game_roster', 'game_staff', 'game_events', 'period_checks'] loop
    execute format('create trigger %I_touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t, t);
    execute format('create index %I_pull_idx on public.%I (team_id, updated_at)', t, t);
    execute format('alter table public.%I enable row level security', t);
    -- 読む・足す・直すは、メンバーで、かつチームが有効なとき。物理削除はさせない（policy なし）
    execute format('create policy %I_select on public.%I for select to authenticated using (public.can_use_team(team_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.can_use_team(team_id))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.can_use_team(team_id)) with check (public.can_use_team(team_id))', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- 利用者・チームまわりの RLS

alter table public.profiles enable row level security;
-- 自分と、同じチームのメンバーの名前を読める
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from public.team_members mine
    join public.team_members theirs on theirs.team_id = mine.team_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy profiles_update on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

alter table public.subscriptions enable row level security;
-- 自分の契約だけ読める。書き込みはサーバー側の処理（service_role）だけ
create policy subscriptions_select on public.subscriptions for select to authenticated using (user_id = auth.uid());

alter table public.teams enable row level security;
-- 所属しているチームは、契約が切れていても名前と状態は見える（中身は見えない）
create policy teams_select on public.teams for select to authenticated using (public.is_team_member(id));
-- 名前の変更は運営者だけ。作成・削除・枠の割り当ては RPC から行う
create policy teams_update on public.teams for update to authenticated
using (public.is_team_owner(id)) with check (public.is_team_owner(id));

-- 運営者でも、名前以外（運営者、枠、特別扱い、削除）は直接書き換えさせない
create function public.guard_team_update() returns trigger
language plpgsql as $$
begin
  -- 端末から直接の更新（current_user が authenticated）のときだけ。RPC の中では関数の所有者として動くので通る
  if current_user = 'authenticated' then
    new.owner_id := old.owner_id;
    new.slot_assigned := old.slot_assigned;
    new.slot_assigned_at := old.slot_assigned_at;
    new.complimentary := old.complimentary;
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end;
$$;
create trigger teams_guard_update before update on public.teams
for each row execute function public.guard_team_update();

alter table public.team_members enable row level security;
create policy team_members_select on public.team_members for select to authenticated using (public.is_team_member(team_id));

alter table public.team_invites enable row level security;
create policy team_invites_select on public.team_invites for select to authenticated using (public.can_use_team(team_id));

-- チームの一覧に、有効かどうかを添えて返す（端末の切り替え画面用）
create function public.my_teams()
returns table (id uuid, name text, role text, active boolean, complimentary boolean, slot_assigned boolean, member_count bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, m.role, public.team_is_active(t.id), t.complimentary, t.slot_assigned,
         (select count(*) from team_members x where x.team_id = t.id)
  from teams t join team_members m on m.team_id = t.id
  where m.user_id = auth.uid() and t.deleted_at is null
  order by t.created_at;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.create_team(text), public.set_team_slot(uuid, boolean), public.create_invite(uuid),
  public.accept_invite(text), public.remove_member(uuid, uuid), public.leave_team(uuid), public.delete_team(uuid),
  public.my_teams() from public, anon;
grant execute on function public.create_team(text), public.set_team_slot(uuid, boolean), public.create_invite(uuid),
  public.accept_invite(text), public.remove_member(uuid, uuid), public.leave_team(uuid), public.delete_team(uuid),
  public.my_teams() to authenticated;

-- ---------------------------------------------------------------- 権限
-- 既定では何も許可されない。サインインした利用者（authenticated）に必要な操作だけを許可し、
-- どの行に届くかは上の RLS が決める。サインインしていない利用者（anon）には何も許可しない。

grant select, insert, update on
  public.squads, public.squad_players, public.games, public.game_roster, public.game_staff,
  public.game_events, public.period_checks
to authenticated;
grant select on public.teams, public.team_members, public.team_invites, public.profiles, public.subscriptions to authenticated;
-- チームで直接書き換えられるのは名前だけ、プロフィールは表示名だけ
grant update (name) on public.teams to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant all on all tables in schema public to service_role;
