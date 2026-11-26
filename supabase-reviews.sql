-- AhmaMart: product reviews + star ratings
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run (only once; running it again is also safe).
-- No changes are made to existing orders/products/categories.
--
-- How it works:
--  * The customer submits a star rating + name + comment on the product page (via the submit_review function).
--  * A new review is "pending" first. It appears on the website only after the admin approves it in the Admin -> Reviews tab (protection against spam/fakes).
--      -> If you want reviews to show immediately (without approval), set  v_status  to 'approved' in submit_review below.
--  * Visitors cannot write anything to the table directly. They can only read approved reviews.
--  * Spam protection: a hidden honeypot field, max 5 reviews per connection per hour, no repeat of the same review, reviews with links are rejected.
--  * product_rating_summary: each product's average + review count (for product cards and Google schema).

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

-- Visitors: approved reviews only
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_reviews' and policyname='reviews public read approved') then
    create policy "reviews public read approved" on public.product_reviews for select to anon, authenticated using (status = 'approved');
  end if;
end $$;

-- Admin (is_admin() is the same function the admin login uses): see all, approve/reject, delete
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

-- Direct insert/update/delete is closed to visitors (insert happens only through submit_review())
revoke insert, update, delete on public.product_reviews from anon;
revoke insert, update on public.product_reviews from authenticated;
grant select on public.product_reviews to anon, authenticated;
grant update (status) on public.product_reviews to authenticated;   -- admin can change only the status
grant delete on public.product_reviews to authenticated;

-- Rate-limit bookkeeping (nobody can read it, only submit_review() uses it)
create table if not exists public.review_rate_limit (
  id          bigint generated always as identity primary key,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists review_rate_limit_idx on public.review_rate_limit (ip_hash, created_at);
alter table public.review_rate_limit enable row level security;
revoke all on public.review_rate_limit from anon, authenticated;

-- Average rating + count for each product (approved reviews only)
create or replace view public.product_rating_summary
with (security_invoker = on) as
  select product_id,
         round(avg(rating)::numeric, 1) as avg_rating,
         count(*)::int                  as review_count
    from public.product_reviews
   where status = 'approved'
   group by product_id;
grant select on public.product_rating_summary to anon, authenticated;

-- Function to submit a review
create or replace function public.submit_review(
  p_product_id bigint,
  p_rating     int,
  p_name       text,
  p_title      text default null,
  p_body       text default null,
  p_website    text default null      -- honeypot: a real customer leaves this empty
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status constant text := 'pending';   -- setting it to 'approved' shows reviews immediately, without admin approval
  v_name   text := regexp_replace(btrim(coalesce(p_name,  '')), '\s+', ' ', 'g');
  v_title  text := regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_body   text := btrim(coalesce(p_body, ''));
  hdr      json;
  ip       text := '';
  h        text;
begin
  -- a bot filled in the honeypot: quietly say "ok", save nothing
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

  -- max 5 reviews per connection per hour
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

  -- no repeat of the same review
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
