begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'slot-owner@example.com');

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
create function pg_temp.active(p_name text) returns boolean language sql as $$
  select public.team_is_active((select id from public.teams where name = p_name));
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select public.create_team('S1');
select public.create_team('S2');
select public.create_team('S3');

-- 2チーム分の契約
select pg_temp.act_as_admin();
insert into public.subscriptions (user_id, tier, expires_at, product_id)
values ('00000000-0000-0000-0000-0000000000d1', 2, now() + interval '30 days', 'team_2_monthly');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select public.set_team_slot((select id from public.teams where name = 'S1'), true);
select pg_temp.act_as_admin();
update public.teams set slot_assigned_at = now() - interval '2 hours' where name = 'S1';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select public.set_team_slot((select id from public.teams where name = 'S2'), true);
select pg_temp.act_as_admin();
update public.teams set slot_assigned_at = now() - interval '1 hour' where name = 'S2';

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$ select public.set_team_slot((select id from public.teams where name = 'S3'), true) $$,
  'P0001', null, '枠の数を超えて割り当てられない');
select is(pg_temp.active('S1') and pg_temp.active('S2'), true, '枠を割り当てた2チームは有効');
select is(pg_temp.active('S3'), false, '割り当てていないチームは有効でない');

-- 段階を1チームに下げる：割り当てた順の古いチームだけが残る
select pg_temp.act_as_admin();
update public.subscriptions set tier = 1;
select is(pg_temp.active('S1'), true, '段階を下げても、先に割り当てたチームは有効');
select is(pg_temp.active('S2'), false, '枠から外れたチームは有効でなくなる');

-- 割り当てを入れ替えると、残すチームを選べる
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select public.set_team_slot((select id from public.teams where name = 'S1'), false);
select is(pg_temp.active('S2'), true, '割り当てを外すと、次のチームが有効になる');

-- 特別扱いのチームは枠を使わない
select pg_temp.act_as_admin();
update public.teams set complimentary = true where name = 'S3';
select is(pg_temp.active('S3') and pg_temp.active('S2'), true, '特別扱いのチームは枠を使わず、ほかのチームを押し出さない');

-- 契約が切れると、割り当て済みでも有効でなくなる
update public.subscriptions set expires_at = now() - interval '1 minute';
select is(pg_temp.active('S2'), false, '契約が切れたら有効でなくなる');
select is(pg_temp.active('S3'), true, '特別扱いのチームは契約が切れても有効');

select * from finish();
rollback;
