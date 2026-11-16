begin;
select plan(27);

-- テスト用の利用者
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'member@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'outsider@example.com');

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

select is((select count(*) from public.profiles), 3::bigint, 'サインアップでプロフィールが作られる');

-- ---- チームの作成
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.create_team('ホークス') $$, 'チームを作れる');
select is((select role from public.my_teams()), 'owner', '作った人が運営者になる');
select is((select active from public.my_teams()), false, '契約も特別扱いもないチームは有効でない');

create temp table ctx as select id as team_id from public.teams limit 1;
grant select on ctx to authenticated;

-- ---- 有効でないチームには内容を書けない
select throws_ok(
  $$ insert into public.games (id, team_id, date, created_at) values ('G1', (select team_id from ctx), '2026-11-16', 1) $$,
  '42501', null, '有効でないチームには試合を送れない');

-- ---- 契約と枠
select pg_temp.act_as_admin();
insert into public.subscriptions (user_id, tier, expires_at) values ('00000000-0000-0000-0000-00000000000a', 1, now() + interval '30 days');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select is((select active from public.my_teams()), false, '契約しても、枠を割り当てるまでは有効にならない');
select lives_ok($$ select public.set_team_slot((select team_id from ctx), true) $$, '運営者は枠を割り当てられる');
select is((select active from public.my_teams()), true, '枠を割り当てるとチームが有効になる');

select lives_ok($$ select public.create_team('2つ目') $$, '2つ目のチームを作れる');
select throws_ok(
  $$ select public.set_team_slot((select id from public.teams where name = '2つ目'), true) $$,
  'P0001', null, '段階1では、2つ目のチームに枠を割り当てられない');

-- ---- 内容の読み書きと、チーム間の分離
select lives_ok(
  $$ insert into public.games (id, team_id, date, created_at) values ('G1', (select team_id from ctx), '2026-11-16', 1) $$,
  '有効なチームには試合を送れる');
select is((select created_by from public.games where id = 'G1'), '00000000-0000-0000-0000-00000000000a'::uuid, '記録した人が入る');
select lives_ok(
  $$ insert into public.game_events (id, team_id, game_id, order_key, period, side, type, created_at)
     values ('E1', (select team_id from ctx), 'G1', 1, 1, 'A', 'FG2_MADE', 1) $$,
  '記録を送れる');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select is((select count(*) from public.games), 0::bigint, 'メンバーでない人には試合が見えない');
select is((select count(*) from public.teams), 0::bigint, 'メンバーでない人にはチームが見えない');
select throws_ok(
  $$ insert into public.games (id, team_id, date, created_at) values ('G9', (select team_id from ctx), '2026-11-16', 1) $$,
  '42501', null, 'メンバーでない人は試合を送れない');

-- ---- 招待と参加
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
create temp table inv as select public.create_invite((select team_id from ctx)) as token;
grant select on inv to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.accept_invite((select token from inv)) $$, '招待リンクで参加できる');
select is((select count(*) from public.games), 1::bigint, 'メンバーはチームの試合を見られる');

-- ---- メンバーは編集できるが、ほかの人の試合は削除できない
select lives_ok($$ update public.games set venue = '市民体育館' where id = 'G1' $$, 'メンバーはほかの人の試合を修正できる');
select throws_ok($$ update public.games set deleted_at = now() where id = 'G1' $$, '42501', null, 'メンバーはほかの人の試合を削除できない');
select throws_ok($$ select public.remove_member((select team_id from ctx), '00000000-0000-0000-0000-00000000000a') $$, '42501', null, 'メンバーはメンバーを外せない');
select throws_ok(
  $$ update public.teams set complimentary = true where id = (select team_id from ctx) $$,
  '42501', null, 'メンバーはチームの状態を書き換えられない');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ update public.games set deleted_at = now() where id = 'G1' $$, '運営者はほかの人の試合も削除できる');

-- ---- 解約すると、メンバーから内容が見えなくなる
select pg_temp.act_as_admin();
update public.subscriptions set expires_at = now() - interval '1 day';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*) from public.games), 0::bigint, '契約が切れるとメンバーに試合が見えなくなる');
select is((select count(*) from public.teams), 1::bigint, '契約が切れてもチームの名前は見える');

-- ---- 特別扱いのチームは契約なしで使える
select pg_temp.act_as_admin();
update public.teams set complimentary = true where id = (select team_id from ctx);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*) from public.games), 1::bigint, '特別扱いのチームは契約なしで内容が見える');

-- ---- 運営者になれるチームは5つまで
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select public.create_team('c1');
select public.create_team('c2');
select public.create_team('c3');
select public.create_team('c4');
select public.create_team('c5');
select throws_ok($$ select public.create_team('c6') $$, 'P0001', null, '6つ目のチームは作れない');

select * from finish();
rollback;
