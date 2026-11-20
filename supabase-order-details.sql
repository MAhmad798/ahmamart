-- AhmaMart: order ki poori details (email, city, payment ka tareeqa, TID, screenshot) orders table me save karna
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run.
-- Dobara chalana safe hai. Purane orders/products me koi change nahi hota.
--
-- Kyun zaroori hai:
--  * Pehle advance payment ki TID, payment ka tareeqa (JazzCash/EasyPaisa...) aur screenshot ka link order ke saath save nahi hota tha,
--    is liye admin me order ke saath nazar nahi aata tha.
--  * Yeh file orders table me 5 nayi columns jorti hai (agar pehle se hon to kuch nahi karti) aur ek function save_order_details()
--    banati hai jo order place hone ke foran baad website call karti hai.
--  * Function sirf usi order ko, sahi code + sahi phone number ke saath, aur sirf pehle 2 ghante me, sirf ek baar bhar sakta hai.
--    Koi dusra kisi purane order ki details badal nahi sakta.

alter table public.orders add column if not exists email         text;
alter table public.orders add column if not exists city          text;
alter table public.orders add column if not exists payment_via   text;   -- JazzCash / EasyPaisa / SadaPay / Other
alter table public.orders add column if not exists payment_tid   text;   -- transaction ID
alter table public.orders add column if not exists payment_proof text;   -- screenshot ka path (storage: payment-proofs)

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
