-- Run this once in the Supabase SQL editor if you already ran schema.sql earlier.
-- It adds dish photo uploads and gives Fried rice its photo.

-- ---------- dish photo uploads ----------
insert into storage.buckets (id, name, public) values ('dish-photos', 'dish-photos', true) on conflict (id) do nothing;

drop policy if exists dish_photos_read on storage.objects;
create policy dish_photos_read on storage.objects for select using (bucket_id = 'dish-photos');
drop policy if exists dish_photos_insert on storage.objects;
create policy dish_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dish-photos' and public.my_role() in ('kitchen', 'admin'));
drop policy if exists dish_photos_update on storage.objects;
create policy dish_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'dish-photos' and public.my_role() in ('kitchen', 'admin'));
drop policy if exists dish_photos_delete on storage.objects;
create policy dish_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dish-photos' and public.my_role() in ('kitchen', 'admin'));

update public.menu_items set img_url = 'assets/img/fried-rice-chicken.jpg' where name = 'Fried rice and chicken' and img_url = '';
