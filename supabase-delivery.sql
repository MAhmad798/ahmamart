-- AhmaMart — Delivery charges (city / province rates + free delivery above an amount)
-- Run this ONCE in Supabase -> SQL Editor -> New query -> paste all -> Run. It is safe to run again (your rates are kept).
--
-- How it works
--   * Rates are kept in the database and are edited in  Admin -> Delivery  (no code needed).
--   * Every order gets its delivery charge calculated BY THE DATABASE when it is saved, from the customer's city and the
--     product total. A customer (or a modified browser) cannot change it.
--   * Order columns:  subtotal = product total (unchanged) | shipping_fee = delivery charge | grand_total = subtotal + shipping_fee
--   * Inside Pakistan:  city rate  ->  else province rate  ->  else the "other locations" rate.  Free delivery when the product
--     total reaches the free-delivery amount (default Rs. 2,000).
--   * Outside Pakistan the charge is "to be confirmed": it is 0 until you set it for that order in Admin -> Orders
--     (you agree the price with the customer on WhatsApp first).
--   * The starting rates below are only examples. Set your real courier costs in Admin -> Delivery.

-- ---------------------------------------------------------------- order columns
alter table public.orders add column if not exists shipping_fee    numeric not null default 0;
alter table public.orders add column if not exists grand_total     numeric;
alter table public.orders add column if not exists shipping_tbc    boolean not null default false;   -- charge still to be confirmed (international)
alter table public.orders add column if not exists shipping_manual boolean not null default false;   -- charge set by hand by the admin

-- old orders had no delivery charge: their total is simply the product total
update public.orders set grand_total = subtotal where grand_total is null;

-- ---------------------------------------------------------------- settings + rates
create table if not exists public.delivery_settings (
  id           int primary key default 1 check (id = 1),     -- exactly one row
  enabled      boolean not null default true,                -- false = no delivery charges at all
  free_over    numeric not null default 2000 check (free_over >= 0),   -- product total that ships free inside Pakistan (0 = never free)
  default_fee  numeric not null default 300  check (default_fee >= 0), -- Pakistan locations that match no rate below
  default_eta  text    default '3-5 business days',
  intl_note    text    default 'Delivery outside Pakistan: we confirm the shipping charge with you on WhatsApp before dispatch.',
  updated_at   timestamptz not null default now()
);
insert into public.delivery_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.delivery_rates (
  id         bigint generated always as identity primary key,
  scope      text    not null check (scope in ('city', 'province')),
  name       text    not null,                              -- e.g. Kasur  /  Punjab
  fee        numeric not null check (fee >= 0),
  eta        text,                                          -- e.g. 2-4 business days
  created_at timestamptz not null default now()
);
create unique index if not exists delivery_rates_unique on public.delivery_rates (scope, lower(btrim(name)));

-- example starting rates (only when the table is empty)
insert into public.delivery_rates (scope, name, fee, eta)
select v.scope, v.name, v.fee, v.eta
  from (values
    ('city',     'Kasur',                       150, '1-2 business days'),
    ('city',     'Lahore',                      200, '2-3 business days'),
    ('province', 'Punjab',                      200, '2-4 business days'),
    ('province', 'Islamabad Capital Territory', 250, '2-4 business days'),
    ('province', 'Sindh',                       250, '3-5 business days'),
    ('province', 'Khyber Pakhtunkhwa',          250, '3-5 business days'),
    ('province', 'Balochistan',                 350, '4-6 business days'),
    ('province', 'Azad Jammu & Kashmir',        350, '4-6 business days'),
    ('province', 'Gilgit-Baltistan',            400, '5-7 business days')
  ) as v(scope, name, fee, eta)
 where not exists (select 1 from public.delivery_rates);

alter table public.delivery_settings enable row level security;
alter table public.delivery_rates    enable row level security;
revoke all on public.delivery_settings, public.delivery_rates from anon, authenticated;
grant select on public.delivery_settings, public.delivery_rates to anon, authenticated;       -- rates are public information
grant insert, update, delete on public.delivery_rates    to authenticated;
grant update                 on public.delivery_settings to authenticated;

drop policy if exists "delivery settings read"   on public.delivery_settings;
drop policy if exists "delivery settings update" on public.delivery_settings;
drop policy if exists "delivery rates read"      on public.delivery_rates;
drop policy if exists "delivery rates insert"    on public.delivery_rates;
drop policy if exists "delivery rates update"    on public.delivery_rates;
drop policy if exists "delivery rates delete"    on public.delivery_rates;
create policy "delivery settings read"   on public.delivery_settings for select to anon, authenticated using (true);
create policy "delivery settings update" on public.delivery_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "delivery rates read"      on public.delivery_rates    for select to anon, authenticated using (true);
create policy "delivery rates insert"    on public.delivery_rates    for insert to authenticated with check (public.is_admin());
create policy "delivery rates update"    on public.delivery_rates    for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "delivery rates delete"    on public.delivery_rates    for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- the calculation (one place, used by the website AND by the order trigger)
-- p_location is the text the checkout sends as the city:  "Area, City, Province"  (Pakistan)  or  "City, State ZIP, Country"  (abroad)
create or replace function public._delivery_calc(p_location text, p_items numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s        public.delivery_settings%rowtype;
  r        public.delivery_rates%rowtype;
  v_items  numeric := greatest(coalesce(p_items, 0), 0);
  parts    text[];
  n        int;
  v_last   text;
  v_prov   text;
  v_city   text;
  v_fee    numeric;
  v_zone   text;
  v_eta    text;
  v_free   boolean := false;
  v_rem    numeric;
  provs    constant text[] := array['punjab', 'sindh', 'khyber pakhtunkhwa', 'balochistan', 'islamabad capital territory',
                                    'azad jammu & kashmir', 'azad kashmir', 'gilgit-baltistan', 'gilgit baltistan',
                                    'pakistan', 'kpk', 'ajk', 'ict', 'islamabad'];
begin
  select * into s from public.delivery_settings where id = 1;
  if not found then
    return jsonb_build_object('ok', true, 'known', false, 'enabled', false, 'fee', 0, 'free', false, 'tbc', false);
  end if;
  v_rem := case when s.free_over > 0 then greatest(s.free_over - v_items, 0) else null end;

  select array_agg(lower(btrim(x))) filter (where btrim(x) <> '') into parts
    from unnest(string_to_array(coalesce(p_location, ''), ',')) as x;
  n := coalesce(array_length(parts, 1), 0);

  if not s.enabled then
    return jsonb_build_object('ok', true, 'known', n > 0, 'enabled', false, 'fee', 0, 'free', false, 'tbc', false,
                              'zone', 'Delivery', 'free_over', s.free_over, 'remaining', v_rem);
  end if;

  -- no location chosen yet: only the general information (free delivery amount, other-locations rate)
  if n = 0 then
    return jsonb_build_object('ok', true, 'known', false, 'enabled', true, 'fee', null, 'free', v_rem = 0, 'tbc', false,
                              'free_over', s.free_over, 'remaining', v_rem, 'default_fee', s.default_fee);
  end if;

  v_last := parts[n];
  if not (v_last = any (provs)) then
    -- outside Pakistan: charge is agreed with the customer on WhatsApp
    return jsonb_build_object('ok', true, 'known', true, 'enabled', true, 'tbc', true, 'fee', 0, 'free', false,
                              'zone', 'International', 'note', s.intl_note, 'free_over', s.free_over, 'remaining', v_rem);
  end if;

  v_prov := case v_last when 'kpk' then 'khyber pakhtunkhwa'
                        when 'ajk' then 'azad jammu & kashmir'
                        when 'azad kashmir' then 'azad jammu & kashmir'
                        when 'gilgit baltistan' then 'gilgit-baltistan'
                        when 'ict' then 'islamabad capital territory'
                        when 'islamabad' then 'islamabad capital territory'
                        else v_last end;
  v_city := case when n >= 2 then parts[n - 1] else null end;

  select * into r from public.delivery_rates where scope = 'city' and lower(btrim(name)) = v_city limit 1;
  if not found then
    select * into r from public.delivery_rates where scope = 'province' and lower(btrim(name)) = v_prov limit 1;
  end if;
  if found then
    v_fee := r.fee; v_zone := r.name; v_eta := r.eta;
  else
    v_fee := s.default_fee; v_zone := 'Pakistan'; v_eta := s.default_eta;
  end if;

  if s.free_over > 0 and v_items >= s.free_over then v_free := true; end if;

  return jsonb_build_object('ok', true, 'known', true, 'enabled', true, 'tbc', false,
                            'fee', case when v_free then 0 else v_fee end, 'base_fee', v_fee, 'free', v_free,
                            'zone', v_zone, 'eta', v_eta, 'free_over', s.free_over, 'remaining', v_rem);
end;
$$;
revoke all on function public._delivery_calc(text, numeric) from public, anon, authenticated;

-- public: used by the cart and checkout to show the charge before the customer confirms
create or replace function public.delivery_quote(p_location text default '', p_subtotal numeric default 0)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._delivery_calc(left(coalesce(p_location, ''), 300), p_subtotal);
$$;
revoke all on function public.delivery_quote(text, numeric) from public;
grant execute on function public.delivery_quote(text, numeric) to anon, authenticated;

-- ---------------------------------------------------------------- every saved order gets its charge from the database
create or replace function public.orders_apply_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  q jsonb;
begin
  if tg_op = 'UPDATE' and old.shipping_manual then
    -- the admin set this order's charge by hand: keep it
    new.shipping_manual := true;
    new.shipping_tbc    := false;
    new.shipping_fee    := old.shipping_fee;
  else
    q := public._delivery_calc(new.city::text, coalesce(new.subtotal, 0));
    new.shipping_fee := coalesce((q->>'fee')::numeric, 0);
    new.shipping_tbc := coalesce((q->>'tbc')::boolean, false);
    if coalesce((q->>'enabled')::boolean, false) and not coalesce((q->>'known')::boolean, false) then
      -- no city saved (yet): charge the standard rate (unless free delivery applies); it is recalculated as soon as the city is saved
      new.shipping_fee := case when coalesce((q->>'free')::boolean, false) then 0 else coalesce((q->>'default_fee')::numeric, 0) end;
    end if;
  end if;
  new.grand_total := coalesce(new.subtotal, 0) + new.shipping_fee;
  return new;
end;
$$;

drop trigger if exists trg_orders_apply_delivery on public.orders;
create trigger trg_orders_apply_delivery
  before insert or update of subtotal, city on public.orders
  for each row execute function public.orders_apply_delivery();

-- admin: set the delivery charge of one order by hand (e.g. after agreeing an international price on WhatsApp)
create or replace function public.admin_set_order_shipping(p_code text, p_fee numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  v_fee numeric := greatest(coalesce(p_fee, 0), 0);
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  update public.orders
     set shipping_fee = v_fee, shipping_manual = true, shipping_tbc = false, grand_total = coalesce(subtotal, 0) + v_fee
   where upper(btrim(code::text)) = upper(btrim(coalesce(p_code, '')));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'shipping_fee', v_fee);
end;
$$;
revoke all on function public.admin_set_order_shipping(text, numeric) from public, anon;
grant execute on function public.admin_set_order_shipping(text, numeric) to authenticated;

-- ---------------------------------------------------------------- customer lookups now include the delivery charge and the total
drop function if exists public.list_customer_orders(text);
drop function if exists public.track_order(text, text);

create function public.list_customer_orders(p_phone text)
returns table (
  code         text,
  status       text,
  items        jsonb,
  item_count   integer,
  subtotal     numeric,
  created_at   timestamptz,
  shipping_fee numeric,
  grand_total  numeric,
  shipping_tbc boolean
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
         o.created_at,
         coalesce(o.shipping_fee, 0)::numeric,
         coalesce(o.grand_total, o.subtotal)::numeric,
         coalesce(o.shipping_tbc, false)
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

create function public.track_order(p_code text, p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'status',       o.status::text,
           'subtotal',     o.subtotal,
           'shipping_fee', coalesce(o.shipping_fee, 0),
           'grand_total',  coalesce(o.grand_total, o.subtotal),
           'shipping_tbc', coalesce(o.shipping_tbc, false),
           'address',      o.address,
           'city',         o.city,
           'created_at',   o.created_at,
           'item_count',   coalesce((select sum(case when (e->>'qty') ~ '^[0-9]+$' then (e->>'qty')::integer else 1 end)
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

-- the customer can read the amounts of the order they just placed (code + phone), used for the receipt
create or replace function public.order_amounts(p_code text, p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('subtotal', o.subtotal, 'shipping_fee', coalesce(o.shipping_fee, 0),
                            'grand_total', coalesce(o.grand_total, o.subtotal), 'shipping_tbc', coalesce(o.shipping_tbc, false))
    from public.orders o
   where upper(btrim(o.code::text)) = upper(btrim(coalesce(p_code, '')))
     and length(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)) = 10
     and right(regexp_replace(coalesce(o.phone::text, ''), '\D', '', 'g'), 10)
       = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
   limit 1;
$$;
revoke all on function public.order_amounts(text, text) from public;
grant execute on function public.order_amounts(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select 'OK - delivery charges installed' as result,
       (select free_over from public.delivery_settings where id = 1) as free_delivery_from,
       (select count(*) from public.delivery_rates) as rates,
       exists (select 1 from pg_trigger where tgname = 'trg_orders_apply_delivery' and not tgisinternal) as trigger_ready;
