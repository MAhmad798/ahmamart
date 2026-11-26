-- AhmaMart: fix "My Orders" and "Track order"
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run (only once).
-- Running it again is safe. No changes are made to orders, products or any other data; only the 2 lookup functions are recreated.
--
-- What the problem was:
--  * The customer types the number as "0300-1234567" at checkout and later searches with "03001234567" or "+92 300 1234567".
--    The old lookup matched the number word for word, so the orders list came back empty.
--  * Now only the digits are taken from both sides and the last 10 digits are matched, so any style works.
--  * The order code is also not affected by upper/lower case letters or extra spaces.
--  * The number must be at least 10 digits long (so nobody can see other people's orders by typing a short/incomplete number).

drop function if exists public.list_customer_orders(text);
drop function if exists public.track_order(text, text);

-- 1) My Orders: orders for this number (newest first, max 50)
create function public.list_customer_orders(p_phone text)
returns table (
  code       text,
  status     text,
  items      jsonb,
  item_count integer,
  subtotal   numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.code::text,
         o.status::text,
         x.j,
         coalesce((select sum(case when (e->>'qty') ~ '^[0-9]+$' then (e->>'qty')::integer else 1 end)
                     from jsonb_array_elements(x.j) e), 0)::integer,
         o.subtotal::numeric,
         o.created_at
    from public.orders o
   cross join lateral (
         select case when jsonb_typeof(to_jsonb(o.items)) = 'array' then to_jsonb(o.items) else '[]'::jsonb end as j
   ) x
   where length(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)) = 10
     and right(regexp_replace(coalesce(o.phone::text, ''), '\D', '', 'g'), 10)
       = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
   order by o.created_at desc
   limit 50;
$$;

-- 2) Track order: if both code + phone are correct, that order's status etc.
create function public.track_order(p_code text, p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'status',     o.status::text,
           'subtotal',   o.subtotal,
           'address',    o.address,
           'city',       o.city,
           'created_at', o.created_at,
           'item_count', coalesce((select sum(case when (e->>'qty') ~ '^[0-9]+$' then (e->>'qty')::integer else 1 end)
                                     from jsonb_array_elements(x.j) e), 0)
         )
    from public.orders o
   cross join lateral (
         select case when jsonb_typeof(to_jsonb(o.items)) = 'array' then to_jsonb(o.items) else '[]'::jsonb end as j
   ) x
   where upper(btrim(o.code::text)) = upper(btrim(coalesce(p_code, '')))
     and length(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)) = 10
     and right(regexp_replace(coalesce(o.phone::text, ''), '\D', '', 'g'), 10)
       = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
   order by o.created_at desc
   limit 1;
$$;

revoke all on function public.list_customer_orders(text) from public;
revoke all on function public.track_order(text, text) from public;
grant execute on function public.list_customer_orders(text) to anon, authenticated;
grant execute on function public.track_order(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select 'OK - order tracking fixed' as status,
       to_regprocedure('public.list_customer_orders(text)') is not null as list_ready,
       to_regprocedure('public.track_order(text,text)') is not null as track_ready;
