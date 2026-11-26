-- AhmaMart: Cash on Delivery + online payment support
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run (only once).
-- No changes are made to existing orders/products. The old place_order() stays as it is;
-- the new place_order_v2() calls it and saves the payment method in the orders table.

-- 1) payment columns in the orders table
alter table public.orders add column if not exists payment_method text not null default 'advance';
alter table public.orders add column if not exists payment_status text not null default 'unpaid';
alter table public.orders add column if not exists payment_ref text;

-- 2) new wrapper function (the website tries this first)
--    The COD limit is enforced here too so nobody can bypass it from the browser.
--    If you want to change the limit, change cod_max AND PAYMENT.cod.maxTotal in app.js as well.
create or replace function public.place_order_v2(
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
  cod_max constant numeric := 3000;
  v jsonb;
  vtxt text;
  m text := lower(coalesce(p_payment_method, 'advance'));
begin
  if m not in ('advance', 'cod', 'online') then
    raise exception 'BAD_PAYMENT_METHOD';
  end if;

  -- the old function creates the order, reduces stock and returns code/items/subtotal.
  -- (dynamic SQL: this way it works whether place_order's p_items is json or jsonb)
  execute format('select (public.place_order(%L, %L, %L, %L, %L, %L))::text',
                 p_name, p_phone, p_email, p_address, p_city, p_items::text)
     into vtxt;
  v := vtxt::jsonb;

  -- the exception rolls back the whole transaction (order + stock)
  if m = 'cod' and (v->>'subtotal')::numeric > cod_max then
    raise exception 'COD_LIMIT';
  end if;

  update public.orders
     set payment_method = m,
         payment_status = 'unpaid'
   where code = v->>'code';

  return v;
end;
$$;

grant execute on function public.place_order_v2(text, text, text, text, text, jsonb, text) to anon, authenticated;

-- Make Supabase pick up the new column/function immediately
notify pgrst, 'reload schema';
