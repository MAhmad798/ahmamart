-- AhmaMart: Cash on Delivery + online payment support
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run (sirf ek baar).
-- Purane orders/products me koi change nahi hota. Purana place_order() waisa hi rehta hai;
-- naya place_order_v2() usay call karta hai aur payment ka tareeqa orders table me save karta hai.

-- 1) orders table me payment columns
alter table public.orders add column if not exists payment_method text not null default 'advance';
alter table public.orders add column if not exists payment_status text not null default 'unpaid';
alter table public.orders add column if not exists payment_ref text;

-- 2) naya wrapper function (website yeh pehle try karti hai)
--    COD ki limit yahan bhi lagti hai taake koi browser se limit na tor sake.
--    Agar limit badalni ho to cod_max badlein AUR app.js me PAYMENT.cod.maxTotal bhi.
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

  -- purana function order banata hai, stock kam karta hai aur code/items/subtotal wapas deta hai.
  -- (dynamic SQL: is tarah chahe place_order ka p_items json ho ya jsonb, dono chalte hain)
  execute format('select (public.place_order(%L, %L, %L, %L, %L, %L))::text',
                 p_name, p_phone, p_email, p_address, p_city, p_items::text)
     into vtxt;
  v := vtxt::jsonb;

  -- exception se poora transaction (order + stock) wapas ho jata hai
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

-- Supabase ko naye column/function foran dikhane ke liye
notify pgrst, 'reload schema';
