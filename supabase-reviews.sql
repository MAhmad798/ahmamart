-- AhmaMart: product reviews + star ratings
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run (sirf ek baar; dobara chalana bhi safe hai).
-- Purane orders/products/categories me koi change nahi hota.
--
-- Kaise kaam karta hai:
--  * Customer product page par star rating + naam + comment bhejta hai (submit_review function se).
--  * Naya review pehle "pending" hota hai. Admin -> Reviews tab me Approve karne ke baad hi website par dikhta hai (spam/fake se bachao).
--      -> Agar review foran dikhana ho (bina approve kiye), neeche submit_review me  v_status  ko 'approved' kar dein.
--  * Visitors table me direct kuch likh nahi sakte. Sirf approved reviews padh sakte hain.
--  * Spam se bachao: chhupa hua honeypot field, har connection se 1 ghante me max 5 reviews, same review dobara nahi, links wale review reject.
--  * product_rating_summary: har product ka average + review count (product cards aur Google schema ke liye).

create table if not exists public.product_reviews (
  id             bigint generated always as identity primary key,
  product_id     bigint not null references public.products(id) on delete cascade,
  rating         smallint not null check (rating between 1 and 5),
  reviewer_name  text not null check (char_length(reviewer_name) between 2 and 60),
  title          text check (title is null or char_length(title) <= 100),
  body           text not null check (char_length(body) between 5 and 1500),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at     timestamptz not null default now()
);

create index if not exists product_reviews_product_idx on public.product_reviews (product_id, status, created_at desc);
create index if not exists product_reviews_status_idx  on public.product_reviews (status, created_at desc);

alter table public.product_reviews enable row level security;

-- Visitors: sirf approved reviews
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_reviews' and policyname='reviews public read approved') then
    create policy "reviews public read approved" on public.product_reviews for select to anon, authenticated using (status = 'approved');
  end if;
end $$;

-- Admin (is_admin() wohi function jo admin login use karta hai): sab dekh, approve/reject, delete
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_reviews' and policyname='reviews admin read') then
    create policy "reviews admin read" on public.product_reviews for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_reviews' and policyname='reviews admin update') then
    create policy "reviews admin update" on public.product_reviews for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_reviews' and policyname='reviews admin delete') then
    create policy "reviews admin delete" on public.product_reviews for delete to authenticated using (public.is_admin());
  end if;
end $$;

-- Direct insert/update/delete visitors ke liye band (insert sirf submit_review() se hota hai)
revoke insert, update, delete on public.product_reviews from anon;
revoke insert, update on public.product_reviews from authenticated;
grant select on public.product_reviews to anon, authenticated;
grant update (status) on public.product_reviews to authenticated;   -- admin sirf status badal sakta hai
grant delete on public.product_reviews to authenticated;

-- Rate-limit ka hisaab (koi bhi isay padh nahi sakta, sirf submit_review() use karta hai)
create table if not exists public.review_rate_limit (
  id          bigint generated always as identity primary key,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists review_rate_limit_idx on public.review_rate_limit (ip_hash, created_at);
alter table public.review_rate_limit enable row level security;
revoke all on public.review_rate_limit from anon, authenticated;

-- Har product ka average rating + count (sirf approved reviews)
create or replace view public.product_rating_summary
with (security_invoker = on) as
  select product_id,
         round(avg(rating)::numeric, 1) as avg_rating,
         count(*)::int                  as review_count
    from public.product_reviews
   where status = 'approved'
   group by product_id;
grant select on public.product_rating_summary to anon, authenticated;

-- Review bhejne ka function
create or replace function public.submit_review(
  p_product_id bigint,
  p_rating     int,
  p_name       text,
  p_title      text default null,
  p_body       text default null,
  p_website    text default null      -- honeypot: asli customer isay khali chhorta hai
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status constant text := 'pending';   -- 'approved' karne se review bina admin approval ke foran dikhega
  v_name   text := regexp_replace(btrim(coalesce(p_name,  '')), '\s+', ' ', 'g');
  v_title  text := regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_body   text := btrim(coalesce(p_body, ''));
  hdr      json;
  ip       text := '';
  h        text;
begin
  -- bot ne honeypot bhara: chup-chaap "ok" keh do, kuch save na karo
  if btrim(coalesce(p_website, '')) <> '' then
    return jsonb_build_object('ok', true);
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'error', 'rating');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'error', 'name');
  end if;
  if char_length(v_body) < 5 or char_length(v_body) > 1500 then
    return jsonb_build_object('ok', false, 'error', 'body');
  end if;
  if char_length(v_title) > 100 then
    v_title := left(v_title, 100);
  end if;
  if (v_name || ' ' || v_title || ' ' || v_body) ~* '(https?://|www\.)' then
    return jsonb_build_object('ok', false, 'error', 'links');
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    return jsonb_build_object('ok', false, 'error', 'product');
  end if;

  -- har connection se 1 ghante me max 5 reviews
  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
    ip  := btrim(split_part(coalesce(hdr->>'x-forwarded-for', hdr->>'cf-connecting-ip', ''), ',', 1));
  exception when others then
    ip := '';
  end;
  if ip <> '' then
    h := md5(ip || ':ahmamart-reviews');
    if (select count(*) from public.review_rate_limit where ip_hash = h and created_at > now() - interval '1 hour') >= 5 then
      return jsonb_build_object('ok', false, 'error', 'too_many');
    end if;
  end if;

  -- same review dobara nahi
  if exists (
    select 1 from public.product_reviews
     where product_id = p_product_id
       and lower(reviewer_name) = lower(v_name)
       and body = v_body
       and created_at > now() - interval '7 days'
  ) then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;

  insert into public.product_reviews (product_id, rating, reviewer_name, title, body, status)
  values (p_product_id, p_rating, v_name, nullif(v_title, ''), v_body, v_status);

  if ip <> '' then
    insert into public.review_rate_limit (ip_hash) values (h);
    delete from public.review_rate_limit where created_at < now() - interval '2 days';
  end if;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

revoke all on function public.submit_review(bigint, int, text, text, text, text) from public;
grant execute on function public.submit_review(bigint, int, text, text, text, text) to anon, authenticated;

select 'OK - reviews setup complete' as result,
       (select count(*) from pg_policies where schemaname='public' and tablename='product_reviews') as policies,
       exists (select 1 from pg_proc where proname = 'submit_review') as function_ready;
