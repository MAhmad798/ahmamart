-- AhmaMart: product variants (Size / Colour / ...) with variant-wise stock
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run (sirf ek baar).
-- Purane products/orders me koi change nahi hota. Jis product me variants nahi, woh pehle ki tarah chalta hai.
--
-- Kaise kaam karta hai:
--  * Har variant ek row hai, jaise Size=M + Colour=Red, apne alag stock ke saath.
--  * Product ka total stock (products.stock) automatically variants ke stock ka jama (sum) ban jata hai.
--  * Order place_order_v3() se hota hai: variant ka stock server par kam hota hai (stock khatam ho to order reject),
--    phir purana place_order()/place_order_v2() product ka stock kam karta hai. Order me item ka naam
--    "Product (M / Red)" ban kar save hota hai, to admin, receipt aur WhatsApp sab me nazar aata hai.
--  * place_order_v3 purane place_order() par chalta hai, is liye pehle wali SQL files (orders/payment) maujood honi chahiyen.

-- 1) variants table
create table if not exists public.product_variants (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references public.products(id) on delete cascade,
  -- ordered list, e.g. [{"n":"Size","v":"M"},{"n":"Colour","v":"Red"}]
  options     jsonb  not null default '[]'::jsonb,
  stock       integer not null default 0 check (stock >= 0),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists product_variants_product_idx on public.product_variants (product_id);
-- ek product me same combination do baar nahi
create unique index if not exists product_variants_unique_combo on public.product_variants (product_id, options);

-- 2) access: sab variants dekh sakte hain, sirf admin badal sakta hai
alter table public.product_variants enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_variants' and policyname='variants public read') then
    create policy "variants public read" on public.product_variants for select to anon, authenticated using (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_variants' and policyname='variants admin insert') then
    create policy "variants admin insert" on public.product_variants for insert to authenticated with check (public.is_admin());
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_variants' and policyname='variants admin update') then
    create policy "variants admin update" on public.product_variants for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_variants' and policyname='variants admin delete') then
    create policy "variants admin delete" on public.product_variants for delete to authenticated using (public.is_admin());
  end if;
end $$;

grant select on public.product_variants to anon, authenticated;
grant insert, update, delete on public.product_variants to authenticated;

-- 3) products.stock = variants ke stock ka jama (jab product me variants hon)
create or replace function public.sync_product_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare pid bigint;
begin
  -- order ke dauran place_order_v3 yeh flag lagata hai (product ka stock purana place_order() kam karta hai)
  if coalesce(current_setting('app.skip_variant_sync', true), '') = '1' then
    return null;
  end if;
  pid := coalesce(new.product_id, old.product_id);
  if exists (select 1 from public.product_variants where product_id = pid) then
    update public.products
       set stock = (select coalesce(sum(stock), 0) from public.product_variants where product_id = pid)
     where id = pid;
  end if;
  return null;
end;
$$;

create or replace trigger product_variants_sync_stock
  after insert or update or delete on public.product_variants
  for each row execute function public.sync_product_stock();

-- 4) "M / Red" jaisa label
create or replace function public.variant_label(p_options jsonb)
returns text
language sql
immutable
as $$
  select string_agg(e->>'v', ' / ' order by ord)
    from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) with ordinality as t(e, ord)
$$;

-- 5) order placement with variants
--    items: [{"product_id":1,"variant_id":7,"qty":2}, {"product_id":3,"qty":1}]   (variant_id sirf variants wale product ke liye)
create or replace function public.place_order_v3(
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_city text,
  p_items jsonb,
  p_payment_method text default 'advance'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m        text := lower(coalesce(p_payment_method, 'advance'));
  addr     text := p_address;
  it       jsonb;
  line     jsonb;
  lines    jsonb := '[]'::jsonb;
  agg      jsonb;
  qty      integer;
  pid      bigint;
  vid      bigint;
  vrow     public.product_variants%rowtype;
  vtxt     text;
  v        jsonb;
  base     jsonb;
  pname    text;
  pprice   numeric;
  new_items jsonb := '[]'::jsonb;
  seen     bigint[] := '{}';
begin
  if m not in ('advance', 'cod', 'online') then
    raise exception 'BAD_PAYMENT_METHOD';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;

  -- variant stock kam karte waqt products.stock trigger se dobara na badle
  perform set_config('app.skip_variant_sync', '1', true);

  -- 1) har item: variant ka stock server par kam karo (agar kam na ho to order reject)
  for it in select value from jsonb_array_elements(p_items) loop
    pid := (it->>'product_id')::bigint;
    qty := (it->>'qty')::integer;
    vid := nullif(it->>'variant_id', '')::bigint;
    if pid is null or qty is null or qty < 1 then
      raise exception 'BAD_ITEM';
    end if;

    if vid is not null then
      update public.product_variants
         set stock = stock - qty
       where id = vid and product_id = pid and stock >= qty
      returning * into vrow;
      if not found then
        raise exception 'OUT_OF_STOCK';
      end if;
      line := jsonb_build_object('product_id', pid, 'variant_id', vid, 'qty', qty,
                                 'label', public.variant_label(vrow.options));
    else
      if exists (select 1 from public.product_variants where product_id = pid) then
        raise exception 'VARIANT_REQUIRED';
      end if;
      line := jsonb_build_object('product_id', pid, 'qty', qty);
    end if;
    lines := lines || jsonb_build_array(line);
  end loop;

  -- 2) purane place_order ko product-wise jama kiya hua cart do (wohi product ka stock kam karta hai)
  select coalesce(jsonb_agg(jsonb_build_object('product_id', s.pid, 'qty', s.q)), '[]'::jsonb)
    into agg
    from (select (l->>'product_id')::bigint as pid, sum((l->>'qty')::integer) as q
            from jsonb_array_elements(lines) l group by 1) s;

  if to_regprocedure('public.place_order_v2(text,text,text,text,text,jsonb,text)') is not null then
    execute format('select (public.place_order_v2(%L, %L, %L, %L, %L, %L::jsonb, %L))::text',
                   p_name, p_phone, p_email, p_address, p_city, agg::text, m)
       into vtxt;
  else
    if m = 'cod' then addr := '[COD - cash on delivery] ' || p_address; end if;
    execute format('select (public.place_order(%L, %L, %L, %L, %L, %L))::text',
                   p_name, p_phone, p_email, addr, p_city, agg::text)
       into vtxt;
  end if;
  v := vtxt::jsonb;

  -- 3) order ke items me variant ka naam jorho: "Product (M / Red)"
  for line in select value from jsonb_array_elements(lines) loop
    pid := (line->>'product_id')::bigint;
    if (line->>'variant_id') is not null then
      select e into base from jsonb_array_elements(coalesce(v->'items', '[]'::jsonb)) e
       where coalesce(e->>'product_id', e->>'id') = pid::text limit 1;
      select name, price into pname, pprice from public.products where id = pid;
      base := coalesce(base, '{}'::jsonb);
      new_items := new_items || jsonb_build_array(
        base || jsonb_build_object(
          'product_id', pid,
          'variant_id', (line->>'variant_id')::bigint,
          'variant', line->>'label',
          'name', coalesce(base->>'name', pname) || ' (' || (line->>'label') || ')',
          'price', coalesce((base->>'price')::numeric, pprice),
          'qty', (line->>'qty')::integer));
    elsif not (pid = any(seen)) then
      seen := seen || pid;
      select e into base from jsonb_array_elements(coalesce(v->'items', '[]'::jsonb)) e
       where coalesce(e->>'product_id', e->>'id') = pid::text limit 1;
      if base is not null then new_items := new_items || jsonb_build_array(base); end if;
    end if;
  end loop;

  if jsonb_array_length(new_items) > 0 then
    v := v || jsonb_build_object('items', new_items);
    begin
      execute format('update public.orders set items = %L where code = %L', new_items::text, v->>'code');
    exception when others then
      raise warning 'place_order_v3: could not store variant names on order %: %', v->>'code', sqlerrm;
    end;
  end if;

  perform set_config('app.skip_variant_sync', '', true);
  return v;
end;
$$;

revoke all on function public.place_order_v3(text, text, text, text, text, jsonb, text) from public;
grant execute on function public.place_order_v3(text, text, text, text, text, jsonb, text) to anon, authenticated;

-- Supabase ko naya table/function foran dikhane ke liye
notify pgrst, 'reload schema';

-- Natija: neeche "status" me OK aur teeno cheezen true dikhni chahiyen. Agar error ya false aaye to mujhe woh message bhej dein.
select 'OK - variants setup complete' as status,
       to_regclass('public.product_variants') is not null as table_ready,
       to_regprocedure('public.place_order_v3(text,text,text,text,text,jsonb,text)') is not null as order_function_ready,
       (select count(*) from pg_policies where schemaname='public' and tablename='product_variants') = 4 as policies_ready;
