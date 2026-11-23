-- AhmaMart: naya order aate hi owner ko WhatsApp notification
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run (sirf ek baar).
-- Dobara chalana safe hai. Orders, products aur baqi data me koi change nahi hota.
--
-- Yeh kya karta hai:
--  * orders me ek column wa_notified_at jorta hai (taake har order ka message sirf ek baar jaye).
--  * orders table par ek trigger lagata hai: jaise hi naya order save hota hai, edge function "notify-order" ko order ka code bhejta hai.
--  * Agar notification me koi bhi masla ho (function deploy na ho, internet masla...) to bhi CUSTOMER KA ORDER HAMESHA SAVE HOTA HAI —
--    trigger ki har galti andar hi pakar li jati hai.
--
-- Is ke baad WHATSAPP-ORDER-ALERTS.md ke mutabiq function deploy karna zaroori hai.

create extension if not exists pg_net with schema extensions;

-- column sirf pehli baar banta hai; usi waqt purane (pehle se maujood) orders "notified" mark hote hain,
-- warna kisi purane order par galti se message ja sakta hai. SQL dobara chalane par yeh hissa kuch nahi karta.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'wa_notified_at') then
    alter table public.orders add column wa_notified_at timestamptz;
    update public.orders set wa_notified_at = coalesce(created_at, now());
  end if;
end $$;

create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- code abhi khali ho (insert ke baad set hota ho) to ruk jao; code set hote hi trigger dobara chalega (neeche "update of code")
  if new.code is null or btrim(new.code::text) = '' then return new; end if;
  if tg_op = 'UPDATE' and old.code is not distinct from new.code then return new; end if;
  begin
    perform net.http_post(
      url     := 'https://wfdedrzkqtndnqulvpos.supabase.co/functions/v1/notify-order',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('code', new.code),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'notify_new_order failed: %', sqlerrm;   -- order phir bhi save hoga
  end;
  return new;
end;
$$;

drop trigger if exists trg_notify_new_order on public.orders;
create trigger trg_notify_new_order
  after insert or update of code on public.orders
  for each row execute function public.notify_new_order();

notify pgrst, 'reload schema';

select 'OK - WhatsApp order alert trigger installed' as status,
       exists (select 1 from pg_trigger where tgname = 'trg_notify_new_order' and not tgisinternal) as trigger_ready,
       exists (select 1 from pg_extension where extname = 'pg_net') as pg_net_ready;
