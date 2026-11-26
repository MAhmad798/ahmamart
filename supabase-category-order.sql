-- AhmaMart: category ORDER + sub-categories + category picture (Admin drag & drop / move up-down)
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run (only once).
-- Running it again is also harmless (everything uses "if not exists"). Existing categories/products stay as they are.

-- 1) Sub-category column
alter table public.categories
  add column if not exists parent_id bigint references public.categories(id) on delete restrict;

-- 2) Category picture column
alter table public.categories
  add column if not exists image_url text;

-- 3) Order column
alter table public.categories
  add column if not exists sort_order integer not null default 0;

-- 4) Number the existing categories by their current order (id) (10, 20, 30... within each parent)
update public.categories c
set sort_order = s.rn * 10
from (
  select id, row_number() over (partition by parent_id order by id) as rn
  from public.categories
) s
where c.id = s.id
  and c.sort_order = 0;

-- 5) Index for faster loading
create index if not exists categories_parent_id_idx on public.categories(parent_id);
create index if not exists categories_sort_order_idx on public.categories(parent_id, sort_order);

-- 6) Make Supabase pick up the new column immediately
notify pgrst, 'reload schema';
