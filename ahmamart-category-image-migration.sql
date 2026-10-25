-- AhmaMart category picture support
-- Run this once in Supabase Dashboard > SQL Editor.
-- This adds a nullable field only; it does not delete or modify existing categories/products.
ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS image_url text;
