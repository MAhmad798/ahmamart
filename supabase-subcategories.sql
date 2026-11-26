-- AhmaMart: sub-categories support
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run (only once).
-- This makes no changes to your existing categories/products; everything stays "top level" as before.

alter table public.categories
  add column if not exists parent_id bigint references public.categories(id) on delete restrict;

create index if not exists categories_parent_id_idx on public.categories(parent_id);

-- Make Supabase pick up the new column immediately
notify pgrst, 'reload schema';
