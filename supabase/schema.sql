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
  rating_count  int not null default 0,
  lat           double precision not null default 7.6210,   -- kitchen location on the map
  lng           double precision not null default 5.2214
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
  dest_lat       double precision,                        -- where the customer pinned their delivery
  dest_lng       double precision,
  rider_lat      double precision,                        -- live rider position while on the way
  rider_lng      double precision,
  rider_seen     timestamptz,
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
  p_items jsonb, p_address text, p_phone text, p_note text, p_pay pay_method, p_promo text, p_use_points boolean,
  p_lat double precision default null, p_lng double precision default null
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

  if p_lat is not null and p_lng is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    p_lat := null; p_lng := null;
  end if;

  insert into public.orders (customer_id, customer_name, subtotal, fee, discount, promo, total, points_used, address, phone, note, pay, dest_lat, dest_lng)
  values (uid, prof.name, sub, fee, disc, used_promo, tot, pts, trim(p_address), trim(p_phone), coalesce(trim(p_note), ''), p_pay, p_lat, p_lng)
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

create or replace function public.update_rider_location(p_order uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid location'; end if;
  update public.orders set rider_lat = p_lat, rider_lng = p_lng, rider_seen = now()
  where id = p_order and rider_id = auth.uid() and status = 'on_the_way';
  if not found then raise exception 'Not your active delivery'; end if;
end $$;

grant execute on function public.place_order(jsonb, text, text, text, pay_method, text, boolean, double precision, double precision) to authenticated;
grant execute on function public.update_rider_location(uuid, double precision, double precision) to authenticated;
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

-- ---------- v1.2 additions (alerts, fees, promos, wallet, hours, schedule) ----------
-- ---------- v1.1 pieces (map + rider tracking), included so this one file is enough ----------
alter table public.store  add column if not exists lat double precision not null default 7.6210;
alter table public.store  add column if not exists lng double precision not null default 5.2214;
alter table public.orders add column if not exists dest_lat  double precision;
alter table public.orders add column if not exists dest_lng  double precision;
alter table public.orders add column if not exists rider_lat double precision;
alter table public.orders add column if not exists rider_lng double precision;
alter table public.orders add column if not exists rider_seen timestamptz;
drop function if exists public.place_order(jsonb, text, text, text, pay_method, text, boolean);

create or replace function public.update_rider_location(p_order uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid location'; end if;
  update public.orders set rider_lat = p_lat, rider_lng = p_lng, rider_seen = now()
  where id = p_order and rider_id = auth.uid() and status = 'on_the_way';
  if not found then raise exception 'Not your active delivery'; end if;
end $$;

grant execute on function public.update_rider_location(uuid, double precision, double precision) to authenticated;

 ---------- v1.1 pieces (map + rider tracking), included so this one file is enough ----------
alter table public.store  add column if not exists lat double precision not null default 7.6210;
alter table public.store  add column if not exists lng double precision not null default 5.2214;
alter table public.orders add column if not exists dest_lat  double precision;
alter table public.orders add column if not exists dest_lng  double precision;
alter table public.orders add column if not exists rider_lat double precision;
alter table public.orders add column if not exists rider_lng double precision;
alter table public.orders add column if not exists rider_seen timestamptz;
drop function if exists public.place_order(jsonb, text, text, text, pay_method, text, boolean);

create or replace function public.update_rider_location(p_order uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid location'; end if;
  update public.orders set rider_lat = p_lat, rider_lng = p_lng, rider_seen = now()
  where id = p_order and rider_id = auth.uid() and status = 'on_the_way';
  if not found then raise exception 'Not your active delivery'; end if;
end $$;

grant execute on function public.update_rider_location(uuid, double precision, double precision) to authenticated;

-- ---------- store: contact, distance fee, hours, bank, referral ----------
alter table public.store add column if not exists whatsapp      text    not null default '';
alter table public.store add column if not exists fee_per_km    int     not null default 0;      -- naira per km after free_km
alter table public.store add column if not exists free_km       numeric not null default 2;      -- km covered by the base fee
alter table public.store add column if not exists max_km        numeric not null default 0;      -- 0 = no limit
alter table public.store add column if not exists auto_hours    boolean not null default false;  -- follow opening hours below
alter table public.store add column if not exists hours         jsonb   not null default '{"open":"08:00","close":"21:00","days":[1,2,3,4,5,6,0]}'::jsonb;
alter table public.store add column if not exists bank_name     text    not null default '';
alter table public.store add column if not exists bank_account  text    not null default '';
alter table public.store add column if not exists bank_holder   text    not null default '';
alter table public.store add column if not exists referral_bonus int    not null default 500;

-- ---------- menu: sold out for today only ----------
alter table public.menu_items add column if not exists sold_date date;

-- ---------- orders: wallet, schedule ----------
alter table public.orders add column if not exists wallet_used   int not null default 0;
alter table public.orders add column if not exists scheduled_for timestamptz;

-- ---------- profiles: referral ----------
alter table public.profiles add column if not exists ref_code    text;
alter table public.profiles add column if not exists referred_by uuid references public.profiles (id);
update public.profiles set ref_code = 'HF' || upper(substr(md5(id::text), 1, 6)) where ref_code is null;
create unique index if not exists profiles_ref_code_idx on public.profiles (ref_code);

-- Customers may edit their own profile, but never their role, referral code or who referred them.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid() and role = public.my_role()
    and ref_code is not distinct from (select p.ref_code from public.profiles p where p.id = auth.uid())
    and referred_by is not distinct from (select p.referred_by from public.profiles p where p.id = auth.uid())
  );

-- New sign-ups get a referral code, and can enter a friend's code.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare ref uuid;
begin
  select id into ref from public.profiles where ref_code = upper(trim(coalesce(new.raw_user_meta_data ->> 'ref', ''))) limit 1;
  insert into public.profiles (id, email, name, phone, role, ref_code, referred_by)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    case when new.raw_user_meta_data ->> 'role' = 'rider' then 'rider'::user_role else 'customer'::user_role end,
    'HF' || upper(substr(md5(new.id::text), 1, 6)),
    ref
  );
  return new;
end $$;

-- ---------- promo codes ----------
create table if not exists public.promos (
  code       text primary key,
  label      text not null default '',
  kind       text not null check (kind in ('percent', 'amount', 'freedel')),
  value      int  not null default 0,        -- percent (1-100) or naira amount; ignored for freedel
  min_order  int  not null default 0,
  max_off    int  not null default 0,        -- cap in naira, 0 = no cap
  first_only boolean not null default false, -- only for a customer's first order
  active     boolean not null default true,
  expires_at timestamptz,
  max_uses   int  not null default 0,        -- 0 = unlimited
  uses       int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.promos enable row level security;
drop policy if exists promos_select on public.promos;
create policy promos_select on public.promos for select using (true);
drop policy if exists promos_write on public.promos;
create policy promos_write on public.promos for all
  using (public.my_role() in ('kitchen', 'admin')) with check (public.my_role() in ('kitchen', 'admin'));

insert into public.promos (code, label, kind, value, min_order, max_off, first_only) values
  ('FIRST10', '10% off your first order (up to ₦1,000)', 'percent', 10, 0, 1000, true),
  ('FREEDEL', 'Free delivery on orders over ₦5,000', 'freedel', 0, 5000, 0, false)
on conflict (code) do nothing;

-- ---------- wallet ----------
create table if not exists public.wallet_txns (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  amount     int  not null,                  -- positive = money in, negative = money out
  kind       text not null check (kind in ('topup', 'spend', 'refund', 'referral')),
  note       text not null default '',
  order_id   uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wallet_txns_user_idx on public.wallet_txns (user_id, created_at desc);
alter table public.wallet_txns enable row level security;
drop policy if exists wallet_select on public.wallet_txns;
create policy wallet_select on public.wallet_txns for select
  using (user_id = auth.uid() or public.my_role() in ('kitchen', 'admin'));
-- no insert/update/delete policies: the wallet only changes through the functions below

create or replace function public.wallet_balance(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from public.wallet_txns where user_id = p_user
$$;

-- Kitchen or admin adds money after a customer has paid by transfer.
create or replace function public.credit_wallet(p_user uuid, p_amount int, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() not in ('kitchen', 'admin') then raise exception 'Not allowed'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 500000 then raise exception 'Enter an amount between 1 and 500,000'; end if;
  if not exists (select 1 from public.profiles where id = p_user and role = 'customer') then raise exception 'Customer not found'; end if;
  insert into public.wallet_txns (user_id, amount, kind, note) values (p_user, p_amount, 'topup', coalesce(trim(p_note), 'Top-up'));
end $$;

-- ---------- place_order v1.2 ----------
drop function if exists public.place_order(jsonb, text, text, text, pay_method, text, boolean, double precision, double precision);

create or replace function public.place_order(
  p_items jsonb, p_address text, p_phone text, p_note text, p_pay pay_method, p_promo text, p_use_points boolean,
  p_lat double precision default null, p_lng double precision default null,
  p_use_wallet boolean default false, p_when timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.profiles;
  s public.store;
  pr public.promos;
  sub int := 0; fee int; disc int := 0; pts int := 0; tot int; wal int := 0; bal int;
  v_code text := upper(trim(coalesce(p_promo, '')));
  earned int; spent int; used_code text := '';
  oid uuid; r record; n int := 0;
  km numeric; lagos timestamp := (now() at time zone 'Africa/Lagos');
  today date := (now() at time zone 'Africa/Lagos')::date;
  open_now boolean := true; hh_open time; hh_close time; w timestamp;
begin
  if uid is null then raise exception 'Sign in to place an order'; end if;
  select * into prof from public.profiles where id = uid;
  if prof.role <> 'customer' then raise exception 'Only customers can place orders'; end if;
  select * into s from public.store where id = 1;
  if not s.open then raise exception 'Ordering is paused right now'; end if;
  if coalesce(trim(p_address), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'Add a phone number and delivery address';
  end if;

  hh_open := (s.hours ->> 'open')::time; hh_close := (s.hours ->> 'close')::time;
  if s.auto_hours then
    open_now := (s.hours -> 'days') @> to_jsonb(extract(dow from lagos)::int) and lagos::time >= hh_open and lagos::time < hh_close;
  end if;

  if p_when is not null then
    if p_when < now() + make_interval(mins => s.eta + 15) then raise exception 'Pick a later time. We need about % minutes to prepare.', s.eta + 15; end if;
    if p_when > now() + interval '3 days' then raise exception 'You can schedule up to 3 days ahead'; end if;
    if s.auto_hours then
      w := p_when at time zone 'Africa/Lagos';
      if not ((s.hours -> 'days') @> to_jsonb(extract(dow from w)::int) and w::time >= hh_open and w::time < hh_close) then
        raise exception 'That time is outside our opening hours';
      end if;
    end if;
  elsif not open_now then
    raise exception 'We are closed right now. Schedule your order for later instead';
  end if;

  for r in
    select m.id, m.name, m.price, m.img_url, (i ->> 'qty')::int as qty
    from jsonb_array_elements(p_items) i
    join public.menu_items m on m.id = (i ->> 'id')::uuid
    where m.available and (m.sold_date is distinct from today) and (i ->> 'qty')::int > 0
  loop
    sub := sub + r.price * r.qty; n := n + 1;
  end loop;
  if n = 0 then raise exception 'Your cart is empty or items are sold out'; end if;

  -- delivery fee: base fee covers free_km, then fee_per_km for each extra km (rounded to 50)
  fee := s.fee;
  if p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180 then
    km := 6371 * 2 * asin(sqrt(power(sin(radians(p_lat - s.lat) / 2), 2) + cos(radians(s.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - s.lng) / 2), 2)));
    if s.max_km > 0 and km > s.max_km then raise exception 'Sorry, that spot is outside our delivery area (% km max)', s.max_km; end if;
    if s.fee_per_km > 0 and km > s.free_km then fee := s.fee + (round((km - s.free_km) * s.fee_per_km / 50.0) * 50)::int; end if;
  else
    p_lat := null; p_lng := null;
  end if;

  if p_use_points then
    select coalesce(sum(floor(total / 100.0)), 0)::int into earned from public.orders where customer_id = uid and status = 'delivered';
    select coalesce(sum(points_used), 0)::int into spent from public.orders where customer_id = uid and status not in ('cancelled', 'rejected');
    if earned - spent >= 300 then fee := 0; pts := 300; end if;
  end if;

  if v_code <> '' then
    select * into pr from public.promos where promos.code = v_code and promos.active
      and (promos.expires_at is null or promos.expires_at > now()) and (promos.max_uses = 0 or promos.uses < promos.max_uses);
    if found and sub >= pr.min_order
       and (not pr.first_only or not exists (select 1 from public.orders where customer_id = uid and status not in ('cancelled', 'rejected'))) then
      disc := case pr.kind when 'percent' then round(sub * pr.value / 100.0)::int when 'amount' then pr.value else fee end;
      if pr.max_off > 0 then disc := least(disc, pr.max_off); end if;
      used_code := pr.code;
      update public.promos set uses = uses + 1 where promos.code = pr.code;
    end if;
  end if;
  disc := least(disc, sub + fee);
  tot := sub + fee - disc;

  if p_use_wallet then
    bal := public.wallet_balance(uid);
    wal := least(bal, tot);
  end if;

  insert into public.orders (customer_id, customer_name, subtotal, fee, discount, promo, total, points_used, address, phone, note, pay, dest_lat, dest_lng, wallet_used, scheduled_for)
  values (uid, prof.name, sub, fee, disc, used_code, tot, pts, trim(p_address), trim(p_phone), coalesce(trim(p_note), ''), p_pay, p_lat, p_lng, wal, p_when)
  returning id into oid;

  insert into public.order_items (order_id, menu_item_id, name, price, qty, img_url)
  select oid, m.id, m.name, m.price, (i ->> 'qty')::int, m.img_url
  from jsonb_array_elements(p_items) i
  join public.menu_items m on m.id = (i ->> 'id')::uuid
  where m.available and (m.sold_date is distinct from today) and (i ->> 'qty')::int > 0;

  if wal > 0 then
    insert into public.wallet_txns (user_id, amount, kind, note, order_id) values (uid, -wal, 'spend', 'Order payment', oid);
  end if;

  update public.profiles set phone = trim(p_phone) where id = uid;
  return oid;
end $$;

-- ---------- set_order_status v1.2: refund the wallet on reject/cancel, referral bonus on first delivery ----------
create or replace function public.set_order_status(p_order uuid, p_status order_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  role_ user_role := public.my_role();
  o public.orders;
  prof public.profiles;
  cust public.profiles;
  bonus int;
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

  -- money back to the wallet when an order that used the wallet is rejected or cancelled
  if p_status in ('rejected', 'cancelled') and o.wallet_used > 0 then
    insert into public.wallet_txns (user_id, amount, kind, note, order_id)
    values (o.customer_id, o.wallet_used, 'refund', 'Refund for order ' || upper(right(o.id::text, 6)), o.id);
  end if;

  -- referral: when a referred customer's first order is delivered, both people get the bonus
  if p_status = 'delivered' then
    select * into cust from public.profiles where id = o.customer_id;
    select referral_bonus into bonus from public.store where id = 1;
    if cust.referred_by is not null and bonus > 0
       and not exists (select 1 from public.wallet_txns where user_id = cust.id and kind = 'referral')
       and (select count(*) from public.orders where customer_id = cust.id and status = 'delivered') = 1 then
      insert into public.wallet_txns (user_id, amount, kind, note, order_id) values
        (cust.id, bonus, 'referral', 'Welcome bonus from a friend''s invite', o.id),
        (cust.referred_by, bonus, 'referral', 'A friend you invited got their first order', o.id);
    end if;
  end if;
end $$;

grant execute on function public.place_order(jsonb, text, text, text, pay_method, text, boolean, double precision, double precision, boolean, timestamptz) to authenticated;
grant execute on function public.set_order_status(uuid, order_status) to authenticated;
grant execute on function public.credit_wallet(uuid, int, text) to authenticated;
grant execute on function public.wallet_balance(uuid) to authenticated;

-- ---------- realtime ----------
do $$ begin alter publication supabase_realtime add table public.wallet_txns; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.promos;      exception when duplicate_object then null; end $$;


-- ---------- starting data ----------
insert into public.store (id) values (1) on conflict (id) do nothing;

insert into public.menu_items (name, description, price, category, img_url, sort)
select * from (values
  ('Jollof rice and chicken', 'Smoky party jollof with grilled chicken.', 3800, 'Rice', 'assets/img/jollof.jpg', 1),
  ('Fried rice and chicken', 'Mixed veg, with a side of plantain.', 4000, 'Rice', 'assets/img/fried-rice-chicken.jpg', 2),
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
