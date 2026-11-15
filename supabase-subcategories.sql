-- AhmaMart: sub-categories support
-- Supabase Dashboard -> SQL Editor -> New query -> yeh poora paste karein -> Run (sirf ek baar).
-- Is se aap ke purane categories/products me koi change nahi hota; sab pehle ki tarah "top level" rehte hain.

alter table public.categories
  add column if not exists parent_id bigint references public.categories(id) on delete restrict;

create index if not exists categories_parent_id_idx on public.categories(parent_id);

-- Supabase ko naya column foran dikhane ke liye
notify pgrst, 'reload schema';
