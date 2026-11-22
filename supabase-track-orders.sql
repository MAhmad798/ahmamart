-- AhmaMart: "My Orders" aur "Track order" ko theek karna
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run (sirf ek baar).
-- Dobara chalana safe hai. Orders, products aur baqi data me koi change nahi hota; sirf 2 lookup functions dobara bante hain.
--
-- Masla kya tha:
--  * Customer checkout par number "0300-1234567" likhta hai aur baad me "03001234567" ya "+92 300 1234567" se dhoondta hai.
--    Purana lookup number ko lafz-ba-lafz match karta tha, is liye orders list khali aati thi.
--  * Ab dono taraf se sirf digits liye jate hain aur aakhri 10 digits match hote hain, to koi bhi style chalta hai.
--  * Order code bhi bari/chhoti letters aur extra spaces se farq nahi karta.
--  * Number kam az kam 10 digits ka hona zaroori hai (taake koi chhota/adhura number likh kar doosron ke orders na dekh sake).

drop function if exists public.list_customer_orders(text);
drop function if exists public.track_order(text, text);

-- 1) My Orders: is number ke orders (naye pehle, max 50)
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

-- 2) Track order: code + phone dono sahi hon to us order ki status wagera
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
