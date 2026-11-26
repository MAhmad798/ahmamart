-- AhmaMart: save the full order details (email, city, payment method, TID, screenshot) in the orders table
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run.
-- Running it again is safe. No changes are made to existing orders/products.
--
-- Why it is needed:
--  * Previously the advance payment TID, the payment method (JazzCash/EasyPaisa...) and the screenshot link were not saved with the order,
--    so they did not show up next to the order in the admin.
--  * This file adds 5 new columns to the orders table (does nothing if they already exist) and creates a function save_order_details()
--    which the website calls right after an order is placed.
--  * The function can fill in only that order, with the correct code + correct phone number, only within the first 2 hours, and only once.
--    Nobody else can change the details of an older order.

alter table public.orders add column if not exists email         text;
alter table public.orders add column if not exists city          text;
alter table public.orders add column if not exists payment_via   text;   -- JazzCash / EasyPaisa / SadaPay / Other
alter table public.orders add column if not exists payment_tid   text;   -- transaction ID
alter table public.orders add column if not exists payment_proof text;   -- screenshot path (storage: payment-proofs)

create or replace function public.save_order_details(
  p_code  text,
  p_phone text,
  p_email text default null,
  p_city  text default null,
  p_via   text default null,
  p_tid   text default null,
  p_proof text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  if coalesce(p_code, '') = '' or length(ph) < 7 then
    return false;
  end if;

  update public.orders o
     set email         = coalesce(nullif(btrim(o.email), ''), left(nullif(btrim(p_email), ''), 254)),
         city          = coalesce(nullif(btrim(o.city),  ''), left(nullif(btrim(p_city),  ''), 120)),
         payment_via   = coalesce(o.payment_via,   left(nullif(btrim(p_via),   ''), 60)),
         payment_tid   = coalesce(o.payment_tid,   left(nullif(btrim(p_tid),   ''), 80)),
         payment_proof = coalesce(o.payment_proof, left(nullif(btrim(p_proof), ''), 300))
   where o.code = p_code
     and right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 10) = ph
     and o.created_at > now() - interval '2 hours';

  return found;
end;
$$;

revoke all on function public.save_order_details(text, text, text, text, text, text, text) from public;
grant execute on function public.save_order_details(text, text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select 'OK - order details setup complete' as status,
       to_regprocedure('public.save_order_details(text,text,text,text,text,text,text)') is not null as function_ready,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'orders'
           and column_name in ('email','city','payment_via','payment_tid','payment_proof')) = 5 as columns_ready;
