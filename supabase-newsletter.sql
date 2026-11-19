-- AhmaMart: newsletter subscribers
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run (sirf ek baar).
-- Purane orders/products/categories me koi change nahi hota.
--
-- Kaise kaam karta hai:
--  * Website ka "Sign me up" form subscribe_newsletter() function call karta hai, jo email is table me save karta hai.
--  * Same email dobara aaye to duplicate nahi banta (naya row nahi, user ko "already subscribed" nahi batate).
--  * Table ko visitors direct read/write nahi kar sakte (list private rehti hai). Sirf admin padh/delete kar sakta hai.

create table if not exists public.newsletter_subscribers (
  id          bigint generated always as identity primary key,
  email       text not null,
  created_at  timestamptz not null default now()
);

-- ek email sirf ek baar (chhote/bare haroof ka farq nahi)
create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (lower(email));

alter table public.newsletter_subscribers enable row level security;

-- Admin (is_admin() wohi function jo admin login use karta hai) list dekh aur delete kar sakta hai
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

-- Visitors sirf is function se email jama kara sakte hain
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

-- Supabase ko naya table/function foran dikhane ke liye
notify pgrst, 'reload schema';

select 'OK - newsletter setup complete' as status,
       to_regclass('public.newsletter_subscribers') is not null as table_ready,
       to_regprocedure('public.subscribe_newsletter(text)') is not null as function_ready;
