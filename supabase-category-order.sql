-- AhmaMart: category ORDER (drag & drop / move up-down in Admin)
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run (sirf ek baar).
-- Is se purane categories ka order wahi rehta hai jo abhi hai; baad me admin se jaise chahein move kar sakte hain.

alter table public.categories
  add column if not exists sort_order integer not null default 0;

-- purana order (id ke hisaab se) save kar do
update public.categories set sort_order = id * 10 where sort_order = 0;

create index if not exists categories_sort_order_idx on public.categories(parent_id, sort_order);

-- Supabase ko naya column foran dikhane ke liye
notify pgrst, 'reload schema';
