-- AhmaMart — Order returns (hidden customer form + admin "Returns" tab)
-- Run this ONCE in Supabase -> SQL Editor -> New query -> paste -> Run. It is safe to run again.
--
-- What it creates
--   * table  return_requests          one row per customer return request
--   * column orders.delivered_at      filled automatically when an order is marked "delivered"
--   * private storage bucket          return-photos (photos the customer attaches)
--   * functions (used by the hidden page returns.html)
--       return_lookup_order(code, phone)   finds the order + tells the page what can be returned
--       submit_return_request(data)        validates and saves the request
--       return_status(code, phone)         lets the customer follow the request
--       cancel_return_request(code, phone) lets the customer withdraw a request that is still pending
--   * admin access: only a logged-in admin (public.is_admin()) can read / update / delete requests.
--
-- Return rules (change the numbers below if you want, then run the file again):
--   return window ........ 3 days (counted from the delivery date)
--   photo limit .......... 4 photos per request
--   spam limit ........... 5 requests / 1 hour and 15 failed order lookups / 1 hour per connection

-- ---------------------------------------------------------------- tables
alter table public.orders add column if not exists delivered_at timestamptz;

create or replace function public.set_order_delivered_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_delivered_at on public.orders;
create trigger trg_orders_delivered_at
  before update on public.orders
  for each row execute function public.set_order_delivered_at();

create table if not exists public.return_requests (
  id                   bigint generated always as identity primary key,
  code                 text not null unique,                 -- e.g. RET-7KQ2MX
  order_code           text not null,
  order_created_at     timestamptz,
  delivered_at         timestamptz,                          -- from the order, if known
  received_on          date not null,                        -- date the customer says the parcel arrived
  customer_name        text not null,
  phone                text not null,
  email                text,
  pickup_address       text not null,
  pickup_city          text,
  items                jsonb not null,                       -- [{name, variant, qty, price, line_total}]
  items_total          numeric not null default 0,
  reason               text not null,
  item_condition       text not null,
  details              text not null,
  resolution           text not null,                        -- refund | replacement | exchange
  refund_method        text,
  refund_account_title text,
  refund_account_no    text,
  photos               text[] not null default '{}',
  status               text not null default 'pending',      -- pending | approved | pickup_scheduled | received | completed | rejected | cancelled
  admin_note           text,                                 -- private note (customers never see it)
  customer_note        text,                                 -- shown to the customer on the status page
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  resolved_at          timestamptz
);
create index if not exists return_requests_order_idx   on public.return_requests (upper(order_code));
create index if not exists return_requests_status_idx  on public.return_requests (status, created_at desc);

create or replace function public.touch_return_request()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status in ('completed','rejected','cancelled') and (old.status is distinct from new.status) then
    new.resolved_at := now();
  elsif new.status not in ('completed','rejected','cancelled') then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_touch_return_request on public.return_requests;
create trigger trg_touch_return_request
  before update on public.return_requests
  for each row execute function public.touch_return_request();

-- spam protection (hashed connection + kind of action)
create table if not exists public.return_rate_limit (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists return_rate_limit_idx on public.return_rate_limit (ip_hash, kind, created_at);
alter table public.return_rate_limit enable row level security;
revoke all on public.return_rate_limit from anon, authenticated;

-- ---------------------------------------------------------------- access rules
alter table public.return_requests enable row level security;

revoke all on public.return_requests from anon, authenticated;
grant select, delete on public.return_requests to authenticated;
grant update (status, admin_note, customer_note) on public.return_requests to authenticated;

drop policy if exists "returns admin select" on public.return_requests;
drop policy if exists "returns admin update" on public.return_requests;
drop policy if exists "returns admin delete" on public.return_requests;
create policy "returns admin select" on public.return_requests for select to authenticated using (public.is_admin());
create policy "returns admin update" on public.return_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "returns admin delete" on public.return_requests for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- photo storage (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('return-photos', 'return-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "return photos upload" on storage.objects;
drop policy if exists "return photos admin read" on storage.objects;
drop policy if exists "return photos admin delete" on storage.objects;
create policy "return photos upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'return-photos' and name ~ '^returns/[a-z0-9-]{8,40}/[a-z0-9_.-]{1,60}$');
create policy "return photos admin read" on storage.objects for select to authenticated
  using (bucket_id = 'return-photos' and public.is_admin());
create policy "return photos admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'return-photos' and public.is_admin());

-- ---------------------------------------------------------------- helpers
create or replace function public._ret_ip_hash()
returns text
language plpgsql
stable
as $$
declare
  hdr json;
  ip  text := '';
begin
  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
    ip  := btrim(split_part(coalesce(hdr->>'x-forwarded-for', hdr->>'cf-connecting-ip', ''), ',', 1));
  exception when others then
    ip := '';
  end;
  if ip = '' then return ''; end if;
  return md5(ip || ':ahmamart-returns');
end;
$$;
revoke all on function public._ret_ip_hash() from public, anon, authenticated;

-- order items may be stored as a json array OR as json text inside a json string; this returns an array either way
create or replace function public._ret_items(p jsonb)
returns jsonb
language plpgsql
immutable
as $$
begin
  if p is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p) = 'array' then return p; end if;
  if jsonb_typeof(p) = 'string' then
    begin
      p := (p #>> '{}')::jsonb;
      if jsonb_typeof(p) = 'array' then return p; end if;
    exception when others then
      return '[]'::jsonb;
    end;
  end if;
  return '[]'::jsonb;
end;
$$;
revoke all on function public._ret_items(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 1) find the order
create or replace function public.return_lookup_order(p_code text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_window constant int := 3;                          -- return window in days
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  h        text := public._ret_ip_hash();
  o        record;
  v_base   timestamptz;
  v_deadline timestamptz;
  v_existing text;
  v_o      jsonb;
begin
  if h <> '' and (select count(*) from public.return_rate_limit
                   where ip_hash = h and kind = 'lookup_fail' and created_at > now() - interval '1 hour') >= 15 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  if v_code = '' or char_length(v_digits) < 10 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into o from public.orders
   where upper(btrim(code)) = v_code
     and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_digits
   limit 1;

  if not found then
    if h <> '' then insert into public.return_rate_limit (ip_hash, kind) values (h, 'lookup_fail'); end if;
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if o.status not in ('shipped', 'delivered') then
    return jsonb_build_object('ok', false, 'error', case when o.status = 'cancelled' then 'cancelled' else 'not_delivered' end,
                              'order_status', o.status);
  end if;

  select code into v_existing from public.return_requests
   where upper(order_code) = v_code and status not in ('rejected', 'cancelled')
   order by created_at desc limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'error', 'already_requested', 'return_code', v_existing);
  end if;

  if o.delivered_at is not null then
    v_base := o.delivered_at;
    v_deadline := o.delivered_at + make_interval(days => c_window);
    if now() > v_deadline then
      return jsonb_build_object('ok', false, 'error', 'window_closed', 'window_days', c_window, 'deadline', v_deadline);
    end if;
  end if;

  v_o := to_jsonb(o);          -- read the order through json so a missing optional column can never break the lookup
  return jsonb_build_object(
    'ok', true,
    'window_days', c_window,
    'order', jsonb_build_object(
      'code',            v_o->>'code',
      'name',            v_o->>'name',
      'phone',           v_o->>'phone',
      'email',           v_o->>'email',
      'address',         v_o->>'address',
      'city',            v_o->>'city',
      'status',          v_o->>'status',
      'created_at',      v_o->>'created_at',
      'delivered_at',    v_o->>'delivered_at',
      'deadline',        v_deadline,
      'subtotal',        v_o->'subtotal',
      'shipping_fee',    coalesce(v_o->'shipping_fee', '0'::jsonb),   -- only present once supabase-delivery.sql is installed
      'grand_total',     coalesce(v_o->'grand_total', v_o->'subtotal'),
      'payment_method',  v_o->>'payment_method',
      'items',           public._ret_items(v_o->'items')
    )
  );
end;
$$;
revoke all on function public.return_lookup_order(text, text) from public;
grant execute on function public.return_lookup_order(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- 2) save the request
create or replace function public.submit_return_request(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_window   constant int := 3;
  c_photos   constant int := 4;
  c_hourly   constant int := 5;
  d          jsonb := coalesce(p_data, '{}'::jsonb);
  v_code     text := upper(btrim(coalesce(d->>'order_code', '')));
  v_digits   text := right(regexp_replace(coalesce(d->>'order_phone', ''), '\D', '', 'g'), 10);
  h          text := public._ret_ip_hash();
  o          record;
  v_reason   text := btrim(coalesce(d->>'reason', ''));
  v_cond     text := btrim(coalesce(d->>'item_condition', ''));
  v_res      text := btrim(coalesce(d->>'resolution', ''));
  v_details  text := btrim(coalesce(d->>'details', ''));
  v_name     text := regexp_replace(btrim(coalesce(d->>'name', '')), '\s+', ' ', 'g');
  v_phone    text := btrim(coalesce(d->>'phone', ''));
  v_email    text := lower(btrim(coalesce(d->>'email', '')));
  v_addr     text := btrim(coalesce(d->>'pickup_address', ''));
  v_city     text := btrim(coalesce(d->>'pickup_city', ''));
  v_method   text := btrim(coalesce(d->>'refund_method', ''));
  v_title    text := btrim(coalesce(d->>'refund_account_title', ''));
  v_acct     text := btrim(coalesce(d->>'refund_account_no', ''));
  v_recv     date;
  v_photos   text[] := '{}';
  v_items    jsonb := '[]'::jsonb;
  v_total    numeric := 0;
  v_base     timestamptz;
  sel        jsonb;
  oi         jsonb;
  v_idx      int;
  v_qty      int;
  v_oqty     int;
  v_price    numeric;
  v_new      text;
  v_try      int := 0;
  v_alpha    constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i          int;
begin
  -- a bot filled the hidden field: quietly say "ok", save nothing
  if btrim(coalesce(d->>'website', '')) <> '' then
    return jsonb_build_object('ok', true, 'return_code', 'RET-000000');
  end if;

  if h <> '' and (select count(*) from public.return_rate_limit
                   where ip_hash = h and kind = 'submit' and created_at > now() - interval '1 hour') >= c_hourly then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  -- the order must exist and belong to this phone number
  select * into o from public.orders
   where upper(btrim(code)) = v_code
     and char_length(v_digits) >= 10
     and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_digits
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if o.status not in ('shipped', 'delivered') then return jsonb_build_object('ok', false, 'error', 'not_delivered'); end if;

  if exists (select 1 from public.return_requests where upper(order_code) = v_code and status not in ('rejected', 'cancelled')) then
    return jsonb_build_object('ok', false, 'error', 'already_requested');
  end if;

  -- date the parcel was received
  begin v_recv := (d->>'received_on')::date; exception when others then v_recv := null; end;
  if v_recv is null or v_recv > (now() at time zone 'Asia/Karachi')::date
     or (o.created_at is not null and v_recv < (o.created_at at time zone 'Asia/Karachi')::date) then
    return jsonb_build_object('ok', false, 'error', 'received_on');
  end if;
  v_base := coalesce(o.delivered_at, v_recv::timestamp at time zone 'Asia/Karachi');
  if now() > v_base + make_interval(days => c_window + 1) then
    return jsonb_build_object('ok', false, 'error', 'window_closed', 'window_days', c_window);
  end if;

  -- fields
  if v_reason not in ('damaged', 'wrong_item', 'not_as_described', 'defective', 'size_fit', 'quality', 'changed_mind', 'other') then
    return jsonb_build_object('ok', false, 'error', 'reason'); end if;
  if v_cond not in ('unopened', 'opened_unused', 'used', 'damaged') then
    return jsonb_build_object('ok', false, 'error', 'condition'); end if;
  if v_res not in ('refund', 'replacement', 'exchange') then
    return jsonb_build_object('ok', false, 'error', 'resolution'); end if;
  if char_length(v_details) < 10 or char_length(v_details) > 1500 then
    return jsonb_build_object('ok', false, 'error', 'details'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'name'); end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) < 10 or char_length(v_phone) > 25 then
    return jsonb_build_object('ok', false, 'error', 'phone'); end if;
  if v_email <> '' and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 120) then
    return jsonb_build_object('ok', false, 'error', 'email'); end if;
  if char_length(v_addr) < 8 or char_length(v_addr) > 300 or char_length(v_city) > 80 then
    return jsonb_build_object('ok', false, 'error', 'address'); end if;
  if (v_name || ' ' || v_details) ~* '(https?://|www\.)' then
    return jsonb_build_object('ok', false, 'error', 'links'); end if;

  if v_res = 'refund' then
    if v_method not in ('JazzCash', 'EasyPaisa', 'SadaPay', 'NayaPay', 'Bank transfer') then
      return jsonb_build_object('ok', false, 'error', 'refund_method'); end if;
    if char_length(v_title) < 2 or char_length(v_title) > 80 then
      return jsonb_build_object('ok', false, 'error', 'refund_title'); end if;
    if char_length(regexp_replace(v_acct, '[\s-]', '', 'g')) < 7 or char_length(v_acct) > 40 then
      return jsonb_build_object('ok', false, 'error', 'refund_account'); end if;
  else
    v_method := null; v_title := null; v_acct := null;
  end if;

  -- photos (uploaded to the private bucket first; only valid paths are accepted)
  if jsonb_typeof(d->'photos') = 'array' then
    select coalesce(array_agg(p), '{}') into v_photos
      from (select x as p from jsonb_array_elements_text(d->'photos') x
             where x ~ '^returns/[a-z0-9-]{8,40}/[a-z0-9_.-]{1,60}$' limit c_photos) q;
  end if;
  if v_reason in ('damaged', 'wrong_item', 'not_as_described', 'defective') and coalesce(array_length(v_photos, 1), 0) < 1 then
    return jsonb_build_object('ok', false, 'error', 'photos');
  end if;

  -- items: [{idx: 1-based position in the order, qty}]
  if coalesce(jsonb_typeof(d->'items'), '') <> 'array' or jsonb_array_length(d->'items') = 0 then
    return jsonb_build_object('ok', false, 'error', 'items'); end if;
  for sel in select * from jsonb_array_elements(d->'items') loop
    begin
      v_idx := (sel->>'idx')::int;
      v_qty := (sel->>'qty')::int;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'items');
    end;
    if v_idx is null or v_idx < 1 then return jsonb_build_object('ok', false, 'error', 'items'); end if;
    oi := public._ret_items(to_jsonb(o)->'items') -> (v_idx - 1);
    if oi is null or jsonb_typeof(oi) <> 'object' then return jsonb_build_object('ok', false, 'error', 'items'); end if;
    v_oqty := greatest(1, coalesce(nullif(oi->>'qty', '')::numeric, nullif(oi->>'quantity', '')::numeric, 1)::int);
    if v_qty is null or v_qty < 1 or v_qty > v_oqty then return jsonb_build_object('ok', false, 'error', 'items'); end if;
    v_price := coalesce(nullif(oi->>'price', '')::numeric, 0);
    v_items := v_items || jsonb_build_object(
      'name', coalesce(oi->>'name', 'Product'), 'variant', nullif(oi->>'variant', ''),
      'qty', v_qty, 'price', v_price, 'line_total', v_price * v_qty);
    v_total := v_total + v_price * v_qty;
  end loop;

  -- unique return code
  loop
    v_new := 'RET-';
    for i in 1..6 loop
      v_new := v_new || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    exit when not exists (select 1 from public.return_requests where code = v_new);
    v_try := v_try + 1;
    if v_try > 20 then return jsonb_build_object('ok', false, 'error', 'server'); end if;
  end loop;

  insert into public.return_requests (
    code, order_code, order_created_at, delivered_at, received_on, customer_name, phone, email,
    pickup_address, pickup_city, items, items_total, reason, item_condition, details, resolution,
    refund_method, refund_account_title, refund_account_no, photos)
  values (
    v_new, o.code, o.created_at, o.delivered_at, v_recv, v_name, v_phone, nullif(v_email, ''),
    v_addr, nullif(v_city, ''), v_items, v_total, v_reason, v_cond, v_details, v_res,
    v_method, v_title, v_acct, v_photos);

  if h <> '' then
    insert into public.return_rate_limit (ip_hash, kind) values (h, 'submit');
    delete from public.return_rate_limit where created_at < now() - interval '2 days';
  end if;

  return jsonb_build_object('ok', true, 'return_code', v_new, 'items_total', v_total);
end;
$$;
revoke all on function public.submit_return_request(jsonb) from public;
grant execute on function public.submit_return_request(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- 3) follow a request
create or replace function public.return_status(p_code text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  h        text := public._ret_ip_hash();
  r        record;
begin
  if h <> '' and (select count(*) from public.return_rate_limit
                   where ip_hash = h and kind = 'lookup_fail' and created_at > now() - interval '1 hour') >= 15 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  select * into r from public.return_requests
   where upper(code) = v_code
     and char_length(v_digits) >= 10
     and (right(regexp_replace(phone, '\D', '', 'g'), 10) = v_digits
          or exists (select 1 from public.orders x
                      where upper(btrim(x.code)) = upper(return_requests.order_code)
                        and right(regexp_replace(coalesce(x.phone, ''), '\D', '', 'g'), 10) = v_digits))
   limit 1;
  if not found then
    if h <> '' then insert into public.return_rate_limit (ip_hash, kind) values (h, 'lookup_fail'); end if;
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'request', jsonb_build_object(
      'code', r.code, 'order_code', r.order_code, 'status', r.status, 'created_at', r.created_at,
      'updated_at', r.updated_at, 'resolved_at', r.resolved_at, 'items', r.items, 'items_total', r.items_total,
      'reason', r.reason, 'resolution', r.resolution, 'customer_note', r.customer_note,
      'refund_method', r.refund_method, 'received_on', r.received_on)
  );
end;
$$;
revoke all on function public.return_status(text, text) from public;
grant execute on function public.return_status(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- 4) withdraw a pending request
create or replace function public.cancel_return_request(p_code text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  n        int;
begin
  update public.return_requests
     set status = 'cancelled'
   where upper(code) = v_code and status = 'pending' and char_length(v_digits) >= 10
     and right(regexp_replace(phone, '\D', '', 'g'), 10) = v_digits;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'not_pending'); end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.cancel_return_request(text, text) from public;
grant execute on function public.cancel_return_request(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select 'OK - returns setup complete' as result,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'return_requests') as policies,
       exists (select 1 from pg_proc where proname = 'submit_return_request') as function_ready,
       exists (select 1 from storage.buckets where id = 'return-photos') as photo_bucket_ready;
