-- AhmaMart: WhatsApp notification to the owner as soon as a new order arrives
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run (only once).
-- Running it again is safe. No changes are made to orders, products or any other data.
--
-- What it does:
--  * Adds a column wa_notified_at to orders (so each order's message is sent only once).
--  * Adds a trigger on the orders table: as soon as a new order is saved, it sends the order code to the edge function "notify-order".
--  * Even if something goes wrong with the notification (function not deployed, internet problem...), THE CUSTOMER'S ORDER IS ALWAYS SAVED —
--    every error in the trigger is caught inside it.
--
-- After this, you must deploy the function as described in WHATSAPP-ORDER-ALERTS.md.

create extension if not exists pg_net with schema extensions;

-- the column is created only the first time; at that moment the existing (already present) orders are marked "notified",
-- otherwise a message could go out for an old order by mistake. Running the SQL again does nothing here.
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
  -- if the code is still empty (e.g. it is set after the insert), stop; the trigger runs again as soon as the code is set (see "update of code" below)
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
    raise warning 'notify_new_order failed: %', sqlerrm;   -- the order will still be saved
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
