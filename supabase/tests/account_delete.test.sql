begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'del-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'del-member@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'del-other@example.com');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;
create function pg_temp.act_as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- 運営者のチームTに、メンバー2人。メンバーは自分のチームUも持つ
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.create_team('T');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select public.create_team('U');
select pg_temp.act_as_admin();
update public.teams set complimentary = true;
create temp table ctx as
  select (select id from public.teams where name = 'T') as t, (select id from public.teams where name = 'U') as u;
grant select on ctx to authenticated;
insert into public.team_members (team_id, user_id, role) values
  ((select t from ctx), '00000000-0000-0000-0000-0000000000b1', 'member'),
  ((select t from ctx), '00000000-0000-0000-0000-0000000000c1', 'member');

-- メンバーが、Tと自分のUに試合を記録する
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
insert into public.games (id, team_id, date, created_at) values
  ('DEL-GM', (select t from ctx), '2026-11-19', 1),
  ('DEL-GU', (select u from ctx), '2026-11-19', 1);
insert into public.game_roster (id, team_id, game_id, side, number) values
  ('DEL-RM', (select t from ctx), 'DEL-GM', 'A', '4'),
  ('DEL-RU', (select u from ctx), 'DEL-GU', 'A', '4');
insert into public.game_events (id, team_id, game_id, order_key, period, side, roster_id, type, created_at) values
  ('DEL-EU', (select u from ctx), 'DEL-GU', 1, 1, 'A', 'DEL-RU', 'FG2_MADE', 1);
select public.create_invite((select t from ctx));

-- サインインしていないと呼べない
select pg_temp.act_as_admin();
set local role anon;
select throws_ok($$ select public.delete_account() $$, '42501', null, 'サインインしていない人は呼べない');

-- ---- メンバーがアカウントを削除する
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.delete_account() $$, 'メンバーが自分のアカウントを削除できる');

select pg_temp.act_as_admin();
select is((select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000b1'), 0::bigint, '利用者の行が消える');
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 0::bigint, 'プロフィールが消える');
select is((select count(*) from public.teams where name = 'U'), 0::bigint, '運営していたチームが消える');
select is((select count(*) from public.games where id = 'DEL-GU') + (select count(*) from public.game_roster where id = 'DEL-RU')
  + (select count(*) from public.game_events where id = 'DEL-EU'), 0::bigint, '運営していたチームの内容も消える');
select is((select count(*) from public.team_members where team_id = (select t from ctx)), 2::bigint, 'ほかのチームからは抜ける');
select is((select created_by from public.games where id = 'DEL-GM'), null, 'ほかのチームに記録した試合は残り、記録した人が空になる');
select is((select count(*) from public.team_invites where team_id = (select t from ctx)), 0::bigint, '作った招待は無効になる');

-- 記録した人が空の試合は、メンバーには消せず、運営者は消せる
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ update public.games set deleted_at = now() where id = 'DEL-GM' $$, '42501', null,
  '記録した人がいない試合は、メンバーには消せない');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ update public.games set deleted_at = now() where id = 'DEL-GM' $$, '運営者は消せる');

-- ---- 運営者がアカウントを削除する
select lives_ok($$ select public.delete_account() $$, '運営者が自分のアカウントを削除できる');
select pg_temp.act_as_admin();
select is((select count(*) from public.teams where name = 'T') + (select count(*) from public.games where id = 'DEL-GM')
  + (select count(*) from public.team_members where user_id = '00000000-0000-0000-0000-0000000000c1'), 0::bigint,
  'チームと内容が消え、メンバーの所属もなくなる');

select * from finish();
rollback;
