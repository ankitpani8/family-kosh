-- RLS scenario tests. Run after shim.sql and the migration. Any failed check raises an exception.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','asha@example.com','{"display_name":"Asha"}'),
 ('00000000-0000-0000-0000-00000000000b','bina@example.com','{"display_name":"Bina"}'),
 ('00000000-0000-0000-0000-00000000000c','chet@example.com','{"display_name":"Chet"}');

create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond,false) then raise exception 'FAILED: %', msg; end if; raise notice 'ok: %', msg; end $$;
grant execute on function pg_temp.check(boolean, text) to authenticated;

-- Asha: self + manages Mother; creates a family; adds a holding for Mother and a private one for herself.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) from people) = 1, 'new account sees only its own self person');
insert into people (manager_id, name, relation) values (auth.uid(), 'Mother', 'Mother');
insert into families (name) values ('Asha family');
insert into family_members (family_id, person_id) select f.id, p.id from families f, people p where p.name = 'Mother';
select pg_temp.check((select count(*) from family_members) = 2, 'creator is admin and can add a managed person');
insert into holdings (name, cls, value) values ('Mother FD', 'fd', 400000), ('Asha secret', 'cash', 100), ('Asha bank', 'cash', 300000);
update holdings set private = true where name = 'Asha secret';
insert into holding_owners (holding_id, person_id) select h.id, p.id from holdings h, people p where h.name = 'Mother FD' and p.name = 'Mother';
insert into holding_owners (holding_id, person_id) select h.id, p.id from holdings h, people p where h.name in ('Asha secret','Asha bank') and p.user_id = auth.uid();
select record_snapshot((select id from holdings where name = 'Asha bank'), '2026-11-01', 250000, null);
select pg_temp.check((select value from holdings where name = 'Asha bank') = 250000, 'record_snapshot updates current value');
insert into price_series (label, unit, price) values ('Gold', 'gram', 13000);
insert into family_invites (family_id) select id from families;
insert into goals (person_id, name, target, target_month) select id, 'Medical', 200000, '2026-12-01' from people where name = 'Mother';
insert into person_claims (person_id) select id from people where name = 'Mother';
-- Asha cannot change who a person belongs to.
do $$ begin
  begin update people set user_id = '00000000-0000-0000-0000-00000000000c' where name = 'Mother'; raise exception 'FAILED: user_id was editable';
  exception when insufficient_privilege then raise notice 'ok: people.user_id is not client-editable'; end;
end $$;
reset role;

-- Bina: not in the family yet, sees nothing of Asha's.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from holdings) = 0, 'outsider sees no holdings');
select pg_temp.check((select count(*) from people) = 1, 'outsider sees only herself');
select pg_temp.check((select count(*) from price_series) = 0, 'outsider sees no price series');
select pg_temp.check((select count(*) from family_invites) = 0, 'outsider cannot read invite codes');
reset role;
-- Bina joins with the code.
do $$ declare c text; begin select code into c from family_invites limit 1; perform set_config('kosh.code', c, false); end $$;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select join_family(current_setting('kosh.code'));
select pg_temp.check((select count(*) from holdings) = 2, 'member sees family holdings but not private ones');
select pg_temp.check(not exists (select 1 from holdings where name = 'Asha secret'), 'private holding stays hidden');
select pg_temp.check((select count(*) from people) = 3, 'member sees all family people');
select pg_temp.check((select count(*) from goals) = 1, 'member sees family goals');
select pg_temp.check((select count(*) from price_series) = 1, 'member sees family price series');
update holdings set value = 1 where name = 'Mother FD';
select pg_temp.check((select value from holdings where name = 'Mother FD') = 400000, 'member cannot edit someone else''s holding');
delete from goals;
select pg_temp.check((select count(*) from goals) = 1, 'member cannot delete someone else''s goal');
do $$ begin
  begin insert into family_members (family_id, person_id, role) select family_id, my_self(), 'admin' from family_members limit 1 on conflict (family_id, person_id) do update set role = 'admin';
    raise exception 'FAILED: member promoted herself';
  exception when insufficient_privilege then raise notice 'ok: member cannot make herself admin'; end;
end $$;
reset role;
select pg_temp.check((select count(*) from family_members where role = 'admin') = 1, 'still exactly one admin');

-- Chet, a stranger, claims Mother with the claim code: data moves with her, Asha loses management.
do $$ declare c text; begin select code into c from person_claims limit 1; perform set_config('kosh.claim', c, false); end $$;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select claim_person(current_setting('kosh.claim'));
select pg_temp.check((select name from people where user_id = auth.uid()) = 'Mother', 'claim makes the person the caller''s self');
select pg_temp.check((select count(*) from holdings where name = 'Mother FD') = 1, 'claimed person keeps her holdings');
select pg_temp.check((select count(*) from people where name = 'Chet') = 0, 'empty starter profile is merged away');
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update holdings set value = 2 where name = 'Mother FD';
select pg_temp.check((select value from holdings where name = 'Mother FD') = 400000, 'former manager can no longer edit');
select pg_temp.check((select count(*) from holdings where name = 'Mother FD') = 1, 'but still sees it as a family member');
reset role;


-- The app's own write pattern: client-generated ids, no RETURNING (see src/data/api.ts newId).
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into people (id, manager_id, name) values ('10000000-0000-0000-0000-000000000001', auth.uid(), 'Father');
insert into price_series (id, label, unit, price) values ('10000000-0000-0000-0000-000000000002', 'Euro', 'EUR', 106);
insert into holdings (id, name, cls, value) values ('10000000-0000-0000-0000-000000000003', 'Father SBI', 'cash', 285000);
insert into holding_owners (holding_id, person_id) values ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001');
insert into goals (id, person_id, name, target, target_month) values ('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Wedding', 550000, '2028-01-01');
insert into goal_links (goal_id, holding_id) values ('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from holdings where name = 'Father SBI') = 1, 'app write pattern works for people, prices, holdings, owners, goals, links');
-- Reading a new row back is what broke the first import; keep it documented.
do $$ declare x uuid; begin
  begin insert into holdings (name, cls) values ('Returning probe', 'cash') returning id into x;
    raise notice 'note: INSERT ... RETURNING on holdings now works';
  exception when insufficient_privilege then raise notice 'ok: INSERT ... RETURNING on holdings is rejected, so the app must not use it'; end;
end $$;
reset role;

-- Anonymous visitors see nothing.
set role anon; reset request.jwt.claim.sub;
select pg_temp.check((select count(*) from holdings) = 0 and (select count(*) from people) = 0, 'anonymous sees nothing');
reset role;
