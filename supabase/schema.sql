-- Himaayah Foods: Supabase schema (single eatery)
-- Run this whole file once in the Supabase SQL editor (Dashboard > SQL Editor > New query).
-- It is safe to re-run on an empty project; on a project that already has these objects, drop them first.

create extension if not exists pgcrypto;

-- ---------- types ----------
do $$ begin
  create type user_role as enum ('customer', 'kitchen', 'rider', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type order_status as enum ('placed', 'preparing', 'ready', 'on_the_way', 'delivered', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type pay_method as enum ('cod', 'card');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        user_role not null default 'customer',
  name        text not null default '',
  email       text,
  phone       text not null default '',
  online      boolean not null default false,
  addresses   jsonb not null default '[]'::jsonb,
  cards       jsonb not null default '[]'::jsonb,   -- demo only: card type and last 4 digits, never full numbers
  favs        jsonb not null default '[]'::jsonb,   -- array of menu item ids
  created_at  timestamptz not null default now()
);

create table if not exists public.store (
  id            int primary key default 1 check (id = 1),
  name          text not null default 'Himaayah Foods',
  open          boolean not null default true,
  fee           int not null default 500,
  eta           int not null default 30,
  address       text not null default 'Ado-Ekiti',
  base_rating   numeric not null default 4.7,
  rating_sum    int not null default 0,
  rating_count  int not null default 0
);

create table if not exists public.menu_items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text not null default '',
  price        int not null check (price >= 0),
  category     text not null default 'Rice',
  img_url      text not null default '',
  available    boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.profiles (id),
  customer_name  text not null default '',
  rider_id       uuid references public.profiles (id),
  rider_name     text,
  rider_phone    text,
  status         order_status not null default 'placed',
  subtotal       int not null,
  fee            int not null,
  discount       int not null default 0,
  promo          text not null default '',
  total          int not null,
  points_used    int not null default 0,
  address        text not null,
  phone          text not null,
  note           text not null default '',
  pay            pay_method not null default 'cod',
  rating         int not null default 0 check (rating between 0 and 5),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status);

create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  name         text not null,
  price        int not null,
  qty          int not null check (qty > 0),
  img_url      text not null default ''
);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- ---------- helpers ----------
create or replace function public.my_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- New sign-ups become profiles. Only 'customer' and 'rider' can be chosen at sign-up.
-- Kitchen and admin accounts are promoted by the owner in SQL (see the end of this file).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    case when new.raw_user_meta_data ->> 'role' = 'rider' then 'rider'::user_role else 'customer'::user_role end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- row level security ----------
alter table public.profiles    enable row level security;
alter table public.store       enable row level security;
alter table public.menu_items  enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- profiles: read your own (kitchen and admin can read all); edit your own but never your role
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.my_role() in ('kitchen', 'admin'));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

-- store and menu: anyone can read; only kitchen and admin can change
drop policy if exists store_select on public.store;
create policy store_select on public.store for select using (true);
drop policy if exists store_update on public.store;
create policy store_update on public.store for update
  using (public.my_role() in ('kitchen', 'admin')) with check (public.my_role() in ('kitchen', 'admin'));

drop policy if exists menu_select on public.menu_items;
create policy menu_select on public.menu_items for select using (true);
drop policy if exists menu_insert on public.menu_items;
create policy menu_insert on public.menu_items for insert with check (public.my_role() in ('kitchen', 'admin'));
drop policy if exists menu_update on public.menu_items;
create policy menu_update on public.menu_items for update
  using (public.my_role() in ('kitchen', 'admin')) with check (public.my_role() in ('kitchen', 'admin'));
drop policy if exists menu_delete on public.menu_items;
create policy menu_delete on public.menu_items for delete using (public.my_role() in ('kitchen', 'admin'));

-- orders: customers see their own, kitchen and admin see all, riders see ready orders and their own.
-- There are no insert/update policies: orders change only through the functions below.
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select using (
  customer_id = auth.uid()
  or public.my_role() in ('kitchen', 'admin')
  or (public.my_role() = 'rider' and (status = 'ready' or rider_id = auth.uid()))
);
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id)
);

-- ---------- order functions ----------
-- Prices, fees, discounts and points are all calculated here on the server, never trusted from the browser.
create or replace function public.place_order(
  p_items jsonb, p_address text, p_phone text, p_note text, p_pay pay_method, p_promo text, p_use_points boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.profiles;
  s public.store;
  sub int := 0; fee int; disc int := 0; pts int := 0; tot int;
  promo text := upper(coalesce(p_promo, ''));
  earned int; spent int; used_promo text := '';
  oid uuid; r record; n int := 0;
begin
  if uid is null then raise exception 'Sign in to place an order'; end if;
  select * into prof from public.profiles where id = uid;
  if prof.role <> 'customer' then raise exception 'Only customers can place orders'; end if;
  select * into s from public.store where id = 1;
  if not s.open then raise exception 'We are closed right now'; end if;
  if coalesce(trim(p_address), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'Add a phone number and delivery address';
  end if;

  for r in
    select m.id, m.name, m.price, m.img_url, (i ->> 'qty')::int as qty
    from jsonb_array_elements(p_items) i
    join public.menu_items m on m.id = (i ->> 'id')::uuid
    where m.available and (i ->> 'qty')::int > 0
  loop
    sub := sub + r.price * r.qty; n := n + 1;
  end loop;
  if n = 0 then raise exception 'Your cart is empty or items are unavailable'; end if;

  fee := s.fee;
  if p_use_points then
    select coalesce(sum(floor(total / 100.0)), 0)::int into earned from public.orders where customer_id = uid and status = 'delivered';
    select coalesce(sum(points_used), 0)::int into spent from public.orders where customer_id = uid and status not in ('cancelled', 'rejected');
    if earned - spent >= 300 then fee := 0; pts := 300; end if;
  end if;

  if promo = 'FIRST10' and not exists (select 1 from public.orders where customer_id = uid and status not in ('cancelled', 'rejected')) then
    disc := least(1000, round(sub * 0.1)::int); used_promo := 'FIRST10';
  elsif promo = 'FREEDEL' and sub >= 5000 then
    disc := fee; used_promo := 'FREEDEL';
  end if;
  disc := least(disc, sub + fee);
  tot := sub + fee - disc;

  insert into public.orders (customer_id, customer_name, subtotal, fee, discount, promo, total, points_used, address, phone, note, pay)
  values (uid, prof.name, sub, fee, disc, used_promo, tot, pts, trim(p_address), trim(p_phone), coalesce(trim(p_note), ''), p_pay)
  returning id into oid;

  insert into public.order_items (order_id, menu_item_id, name, price, qty, img_url)
  select oid, m.id, m.name, m.price, (i ->> 'qty')::int, m.img_url
  from jsonb_array_elements(p_items) i
  join public.menu_items m on m.id = (i ->> 'id')::uuid
  where m.available and (i ->> 'qty')::int > 0;

  update public.profiles set phone = trim(p_phone) where id = uid;
  return oid;
end $$;

create or replace function public.set_order_status(p_order uuid, p_status order_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  role_ user_role := public.my_role();
  o public.orders;
  prof public.profiles;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  select * into prof from public.profiles where id = uid;

  if role_ in ('kitchen', 'admin') then
    if (o.status = 'placed' and p_status in ('preparing', 'rejected'))
       or (o.status = 'preparing' and p_status = 'ready') then
      update public.orders set status = p_status, updated_at = now() where id = p_order;
    else raise exception 'That change is not allowed'; end if;

  elsif role_ = 'rider' then
    if o.status = 'ready' and o.rider_id is null and p_status = 'on_the_way' then
      if not prof.online then raise exception 'Go online to pick up orders'; end if;
      update public.orders set status = 'on_the_way', rider_id = uid, rider_name = prof.name, rider_phone = prof.phone, updated_at = now() where id = p_order;
    elsif o.status = 'on_the_way' and o.rider_id = uid and p_status = 'delivered' then
      update public.orders set status = 'delivered', updated_at = now() where id = p_order;
    else raise exception 'That change is not allowed'; end if;

  elsif role_ = 'customer' then
    if o.customer_id = uid and o.status = 'placed' and p_status = 'cancelled' then
      update public.orders set status = 'cancelled', updated_at = now() where id = p_order;
    else raise exception 'That change is not allowed'; end if;

  else raise exception 'Not allowed'; end if;
end $$;

create or replace function public.rate_order(p_order uuid, p_rating int)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1 to 5'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found or o.customer_id <> auth.uid() or o.status <> 'delivered' or o.rating <> 0 then
    raise exception 'You can only rate your own delivered orders once';
  end if;
  update public.orders set rating = p_rating where id = p_order;
  update public.store set rating_sum = rating_sum + p_rating, rating_count = rating_count + 1 where id = 1;
end $$;

grant execute on function public.place_order(jsonb, text, text, text, pay_method, text, boolean) to authenticated;
grant execute on function public.set_order_status(uuid, order_status) to authenticated;
grant execute on function public.rate_order(uuid, int) to authenticated;

-- ---------- realtime ----------
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.menu_items;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.store;
exception when duplicate_object then null; end $$;

-- ---------- starting data ----------
insert into public.store (id) values (1) on conflict (id) do nothing;

insert into public.menu_items (name, description, price, category, img_url, sort)
select * from (values
  ('Jollof rice and chicken', 'Smoky party jollof with grilled chicken.', 3800, 'Rice', 'assets/img/jollof.jpg', 1),
  ('Fried rice and chicken', 'Mixed veg, with a side of plantain.', 4000, 'Rice', '', 2),
  ('Coconut rice', 'Fragrant coconut rice with fish stew.', 3500, 'Rice', 'assets/img/fried-rice.jpg', 3),
  ('Ofada rice and stew', 'With ayamase sauce and egg.', 3500, 'Rice', 'assets/img/ofada.jpg', 4),
  ('Jollof rice (small)', 'Plain portion.', 1800, 'Rice', 'assets/img/jollof.jpg', 5),
  ('Amala, ewedu and gbegiri', 'Served with assorted meat.', 2500, 'Swallow & Soups', 'assets/img/amala.jpg', 6),
  ('Amala and ogbono', 'Ogbono soup with beef and ponmo.', 2800, 'Swallow & Soups', 'assets/img/ogbono.jpg', 7),
  ('Pounded yam and egusi', 'Rich egusi with goat meat.', 3200, 'Swallow & Soups', 'assets/img/egusi.jpg', 8),
  ('Iyan and efo riro', 'Pounded yam with spinach stew.', 3000, 'Swallow & Soups', 'assets/img/soup-pot.jpg', 9),
  ('Goat pepper soup', 'Hot and fragrant.', 3000, 'Swallow & Soups', 'assets/img/pepper-soup.jpg', 10),
  ('Ewedu soup (extra)', 'Fresh, silky ewedu by the bowl.', 800, 'Swallow & Soups', 'assets/img/ewedu.jpg', 11),
  ('Beef suya', 'Pack with onions and yaji.', 2000, 'Grill', 'assets/img/suya-beef.jpg', 12),
  ('Chicken suya', 'Spiced chicken skewers, grilled to order.', 3000, 'Grill', 'assets/img/suya-chicken.jpg', 13),
  ('Ram suya', 'Tender ram, extra spicy.', 3500, 'Grill', 'assets/img/suya-ram.jpg', 14),
  ('Suya wrap', 'Suya, cabbage and sauce in flatbread.', 2500, 'Grill', 'assets/img/suya.jpg', 15),
  ('Assorted cookies', 'Box of six, baked this morning.', 2500, 'Bakery', 'assets/img/cookies.jpg', 16),
  ('Meat pie', 'Flaky pastry, spiced beef filling.', 1000, 'Bakery', 'assets/img/meat-pie.jpg', 17),
  ('Chicken pie', 'Creamy chicken and peas.', 1200, 'Bakery', 'assets/img/chicken-pie.jpg', 18),
  ('Sausage roll', 'Warm, buttery.', 800, 'Bakery', 'assets/img/sausage-roll.jpg', 19),
  ('Cake slice', 'Vanilla or chocolate.', 1500, 'Bakery', 'assets/img/cake.jpg', 20),
  ('Zobo', 'Chilled, 50cl.', 500, 'Drinks', 'assets/img/zobo.jpg', 21),
  ('Fresh juice', 'Pineapple or orange, 40cl.', 1200, 'Drinks', 'assets/img/juice.jpg', 22),
  ('Bottled water', '75cl', 300, 'Drinks', 'assets/img/water.jpg', 23),
  ('Fried plantain', 'Sweet, golden.', 700, 'Sides', 'assets/img/plantain.jpg', 24),
  ('Moi moi', 'Steamed bean pudding.', 800, 'Sides', 'assets/img/moimoi.jpg', 25),
  ('Fries', 'Crispy, lightly salted.', 1500, 'Sides', 'assets/img/fries.jpg', 26),
  ('Extra assorted meat', 'Beef, shaki and ponmo.', 700, 'Sides', 'assets/img/shaki.jpg', 27)
) as v(name, description, price, category, img_url, sort)
where not exists (select 1 from public.menu_items);

-- ---------- make staff accounts (run AFTER those people have signed up) ----------
-- update public.profiles set role = 'kitchen' where email = 'kitchen@yourdomain.com';
-- update public.profiles set role = 'admin'   where email = 'you@yourdomain.com';
