begin;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'apple-user@example.com');
insert into public.apple_tokens (user_id, refresh_token) values ('00000000-0000-0000-0000-0000000000e1', 'secret');

-- 本人でも、解除用の鍵は読めず、書けない（関数だけが扱う）
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e1', 'role', 'authenticated')::text, true);
select throws_ok($$ select refresh_token from public.apple_tokens $$, '42501', null, '利用者は鍵を読めない');
select throws_ok(
  $$ insert into public.apple_tokens (user_id, refresh_token) values ('00000000-0000-0000-0000-0000000000e1', 'x') $$,
  '42501', null, '利用者は鍵を書けない');

-- 利用者が消えると、鍵も消える
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true);
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1';
select is((select count(*) from public.apple_tokens), 0::bigint, '利用者を消すと鍵も消える');

select * from finish();
rollback;
