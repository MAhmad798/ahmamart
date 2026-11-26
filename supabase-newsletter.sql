-- AhmaMart: newsletter subscribers
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run (only once).
-- No changes are made to existing orders/products/categories.
--
-- How it works:
--  * The website's "Sign me up" form calls the subscribe_newsletter() function, which saves the email in this table.
--  * If the same email comes in again, no duplicate is created (no new row, and the user is not told "already subscribed").
--  * Visitors cannot read/write the table directly (the list stays private). Only the admin can read/delete.

create table if not exists public.newsletter_subscribers (
  id          bigint generated always as identity primary key,
  email       text not null,
  created_at  timestamptz not null default now()
);

-- one email only once (upper/lower case makes no difference)
create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (lower(email));

alter table public.newsletter_subscribers enable row level security;

-- Admin (is_admin() is the same function the admin login uses) can view and delete the list
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='newsletter_subscribers' and policyname='newsletter admin read') then
    create policy "newsletter admin read" on public.newsletter_subscribers for select to authenticated using (public.is_admin());
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='newsletter_subscribers' and policyname='newsletter admin delete') then
    create policy "newsletter admin delete" on public.newsletter_subscribers for delete to authenticated using (public.is_admin());
  end if;
end $$;

grant select, delete on public.newsletter_subscribers to authenticated;

-- Visitors can add an email only through this function
create or replace function public.subscribe_newsletter(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
begin
  if length(e) > 254 or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'BAD_EMAIL';
  end if;

  insert into public.newsletter_subscribers (email) values (e)
  on conflict (lower(email)) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.subscribe_newsletter(text) from public;
grant execute on function public.subscribe_newsletter(text) to anon, authenticated;

-- Make Supabase pick up the new table/function immediately
notify pgrst, 'reload schema';

select 'OK - newsletter setup complete' as status,
       to_regclass('public.newsletter_subscribers') is not null as table_ready,
       to_regprocedure('public.subscribe_newsletter(text)') is not null as function_ready;
