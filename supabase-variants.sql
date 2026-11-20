-- AhmaMart: product variants (Size / Colour / ...) with variant-wise stock  — VERSION 2 (fixed + hardened)
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run.
-- Yeh file dobara dobara chalana bilkul safe hai (purana data/orders delete nahi hote). Purani version ke upar bhi chala dein.
-- Jis product me variants nahi, woh pehle ki tarah chalta hai.
--
-- Kaise kaam karta hai:
--  * Har variant ek row hai, jaise Size=M + Colour=Red, apne alag stock ke saath.
--  * Product ka total stock (products.stock) automatically variants ke stock ka jama (sum) ban jata hai.
--  * Order place_order_v3() se hota hai: variant ka stock server par kam hota hai (stock khatam ho to order reject),
--    phir purana place_order()/place_order_v2() product ka stock kam karta hai. Order me item ka naam
--    "Product (M / Red)" ban kar save hota hai, to admin, receipt aur WhatsApp sab me nazar aata hai.
--  * place_order_v3 purane place_order() par chalta hai, is liye pehle wali SQL files (orders/payment) maujood honi chahiyen.
--
-- Version 2 me kya theek hua:
--  * products.stock aur variants ke stock me farq (drift) ho to order ab "out of stock" ghalat reject nahi hota —
--    function order se pehle product ka stock variants ke mutabiq theek kar leta hai.
--  * Aik hi variant cart me do baar aaye to jama ho jata hai; variants hamesha aik tarteeb se lock hote hain (deadlock nahi).
--  * Ghalat/khali/ajeeb input par saaf error (BAD_ITEM, VARIANT_NOT_FOUND ...) milta hai, crash nahi.
--  * Agar order kisi wajah se fail ho to variant ka stock bhi saath hi wapas ho jata hai (aik transaction).
--  * Run karte hi purane products ka stock variants ke jama se barabar kar diya jata hai (neeche step 5).

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
  pid := case when tg_op = 'DELETE' then old.product_id else new.product_id end;
  if exists (select 1 from public.product_variants where product_id = pid) then
    update public.products
       set stock = (select coalesce(sum(stock), 0) from public.product_variants where product_id = pid)
     where id = pid;
  end if;
  return null;
end;
$$;

drop trigger if exists product_variants_sync_stock on public.product_variants;
create trigger product_variants_sync_stock
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

-- 5) abhi ke saare products ka stock variants ke mutabiq theek kar do (purana farq/drift saaf)
update public.products p
   set stock = v.total
  from (select product_id, coalesce(sum(stock), 0)::integer as total
          from public.product_variants group by product_id) v
 where p.id = v.product_id and p.stock is distinct from v.total;

-- 6) order placement with variants
--    items: [{"product_id":1,"variant_id":7,"qty":2}, {"product_id":3,"qty":1}]   (variant_id sirf variants wale product ke liye)
--    Errors (customer ko friendly message dikhta hai):
--      EMPTY_CART, BAD_ITEM, BAD_PAYMENT_METHOD, VARIANT_REQUIRED, VARIANT_NOT_FOUND, OUT_OF_STOCK, COD_LIMIT
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
  m         text := lower(coalesce(p_payment_method, 'advance'));
  addr      text := p_address;
  it        jsonb;
  r         record;
  line      jsonb;
  lines     jsonb := '[]'::jsonb;   -- har variant/product line: product_id, variant_id, qty, label
  agg       jsonb;                  -- product-wise jama: purane place_order ko yehi diya jata hai
  vrow      public.product_variants%rowtype;
  vtxt      text;
  v         jsonb;
  base      jsonb;
  pname     text;
  pprice    numeric;
  pimg      text;
  lbl       text;
  new_items jsonb := '[]'::jsonb;
  seen      bigint[] := '{}';
  pid       bigint;
begin
  if m not in ('advance', 'cod', 'online') then
    raise exception 'BAD_PAYMENT_METHOD';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;

  -- input check: product_id / qty poore (positive) number hon, variant_id khali ya number
  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object'
       or coalesce(it->>'product_id', '') !~ '^[0-9]{1,15}$'
       or coalesce(it->>'qty', '') !~ '^[0-9]{1,4}$'
       or coalesce(it->>'variant_id', '') !~ '^[0-9]{0,15}$'
       or (it->>'qty')::integer < 1 then
      raise exception 'BAD_ITEM';
    end if;
  end loop;

  -- variant ka stock kam karte waqt products.stock trigger se dobara na badle
  perform set_config('app.skip_variant_sync', '1', true);

  -- 1) har variant line: variant ka stock server par kam karo (agar kam na ho to order reject).
  --    Same variant do baar ho to jama; hamesha (product, variant) ki tarteeb se lock => deadlock nahi.
  for r in
    select (e->>'product_id')::bigint                    as pid,
           nullif(e->>'variant_id', '')::bigint          as vid,
           sum((e->>'qty')::integer)::integer            as qty
      from jsonb_array_elements(p_items) e
     group by 1, 2
     order by 1, 2 nulls first
  loop
    if r.vid is not null then
      update public.product_variants pv
         set stock = pv.stock - r.qty
       where pv.id = r.vid and pv.product_id = r.pid and pv.stock >= r.qty
      returning pv.* into vrow;
      if not found then
        if exists (select 1 from public.product_variants x where x.id = r.vid and x.product_id = r.pid) then
          raise exception 'OUT_OF_STOCK';
        end if;
        raise exception 'VARIANT_NOT_FOUND';
      end if;
      line := jsonb_build_object('product_id', r.pid, 'variant_id', r.vid, 'qty', r.qty,
                                 'label', public.variant_label(vrow.options));
    else
      if exists (select 1 from public.product_variants x where x.product_id = r.pid) then
        raise exception 'VARIANT_REQUIRED';
      end if;
      line := jsonb_build_object('product_id', r.pid, 'qty', r.qty);
    end if;
    lines := lines || jsonb_build_array(line);
  end loop;

  -- 2) purane place_order ko product-wise jama kiya hua cart do (wohi product ka stock kam karta hai)
  select coalesce(jsonb_agg(jsonb_build_object('product_id', s.product_id, 'qty', s.q) order by s.product_id), '[]'::jsonb)
    into agg
    from (select (l->>'product_id')::bigint as product_id, sum((l->>'qty')::integer) as q
            from jsonb_array_elements(lines) l group by 1) s;

  -- variants wale product ka stock pehle variants ke jama (order se pehle wala) par la do, taake purane
  -- place_order ka stock-check kabhi galat "out of stock" na de (products.stock aur variants me farq ho to bhi).
  for it in select value from jsonb_array_elements(agg) loop
    pid := (it->>'product_id')::bigint;
    if exists (select 1 from public.product_variants x where x.product_id = pid) then
      update public.products
         set stock = (select coalesce(sum(x.stock), 0) from public.product_variants x where x.product_id = pid)
                     + (it->>'qty')::integer
       where id = pid;
    end if;
  end loop;

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

  -- 3) products.stock ko variants ke jama ke barabar rakho (variants wale products)
  for it in select value from jsonb_array_elements(agg) loop
    pid := (it->>'product_id')::bigint;
    if exists (select 1 from public.product_variants x where x.product_id = pid) then
      update public.products
         set stock = (select coalesce(sum(x.stock), 0) from public.product_variants x where x.product_id = pid)
       where id = pid;
    end if;
  end loop;

  -- 4) order ke items me variant ka naam jorho: "Product (M / Red)"
  for line in select value from jsonb_array_elements(lines) loop
    pid := (line->>'product_id')::bigint;
    select e into base from jsonb_array_elements(coalesce(v->'items', '[]'::jsonb)) e
     where coalesce(e->>'product_id', e->>'id') = pid::text limit 1;
    if (line->>'variant_id') is not null then
      select name, price, image_url into pname, pprice, pimg from public.products where id = pid;
      base := coalesce(base, '{}'::jsonb);
      lbl  := nullif(line->>'label', '');
      new_items := new_items || jsonb_build_array(
        base || jsonb_build_object(
          'product_id', pid,
          'variant_id', (line->>'variant_id')::bigint,
          'variant', coalesce(lbl, ''),
          'name', coalesce(base->>'name', pname) || case when lbl is null then '' else ' (' || lbl || ')' end,
          'price', coalesce((base->>'price')::numeric, pprice),
          'image_url', coalesce(base->>'image_url', pimg),
          'qty', (line->>'qty')::integer));
    elsif not (pid = any(seen)) then
      seen := seen || pid;
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
select 'OK - variants setup complete (v2)' as status,
       to_regclass('public.product_variants') is not null as table_ready,
       to_regprocedure('public.place_order_v3(text,text,text,text,text,jsonb,text)') is not null as order_function_ready,
       (select count(*) from pg_policies where schemaname='public' and tablename='product_variants') = 4 as policies_ready,
       (select count(*) from public.product_variants) as variants_in_db,
       (select count(*) from public.products p
         where exists (select 1 from public.product_variants x where x.product_id = p.id)
           and p.stock is distinct from (select sum(x.stock) from public.product_variants x where x.product_id = p.id)) as products_with_stock_mismatch;
