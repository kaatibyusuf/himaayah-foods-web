-- Himaayah Foods: starter schema for Supabase (Postgres).
-- Run in the Supabase SQL editor. This is a starting point: review the policies before going live.

create type user_role as enum ('customer', 'restaurant', 'rider', 'admin');
create type order_status as enum ('placed', 'preparing', 'ready', 'on_the_way', 'delivered', 'rejected', 'cancelled');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  role user_role not null default 'customer',
  full_name text,
  phone text,
  address text,
  online boolean not null default false,
  created_at timestamptz not null default now()
);

create table restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  cuisine text,
  description text,
  address text,
  delivery_fee integer not null default 0,
  eta_min integer not null default 30,
  is_open boolean not null default true,
  approved boolean not null default false,
  rating_sum integer not null default 0,
  rating_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name text not null,
  description text,
  category text not null default 'Mains',
  price integer not null check (price >= 0),
  available boolean not null default true
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id),
  restaurant_id uuid not null references restaurants(id),
  rider_id uuid references profiles(id),
  status order_status not null default 'placed',
  subtotal integer not null,
  delivery_fee integer not null,
  total integer not null,
  address text not null,
  phone text not null,
  note text,
  pay_method text not null default 'cod',
  rating integer check (rating between 1 and 5),
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,
  name text not null,
  price integer not null,
  qty integer not null check (qty > 0)
);

-- Helpers
create function current_role_is(r user_role) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from profiles where id = auth.uid() and role = r) $$;

create function owns_restaurant(rid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from restaurants where id = rid and owner_id = auth.uid()) $$;

-- Create a profile row automatically when someone signs up
create function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  insert into profiles (id, role, full_name)
  values (new.id, 'customer', coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Row level security
alter table profiles enable row level security;
alter table restaurants enable row level security;
alter table menu_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create policy "own profile" on profiles for select using (id = auth.uid() or current_role_is('admin'));
create policy "update own profile" on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));
create policy "admin manages profiles" on profiles for all using (current_role_is('admin'));

create policy "public sees approved restaurants" on restaurants for select
  using (approved or owner_id = auth.uid() or current_role_is('admin'));
create policy "owner edits restaurant" on restaurants for update using (owner_id = auth.uid());
create policy "admin manages restaurants" on restaurants for all using (current_role_is('admin'));

create policy "public sees menu of approved restaurants" on menu_items for select
  using (owns_restaurant(restaurant_id) or current_role_is('admin')
    or exists (select 1 from restaurants r where r.id = restaurant_id and r.approved));
create policy "owner manages menu" on menu_items for all
  using (owns_restaurant(restaurant_id)) with check (owns_restaurant(restaurant_id));

create policy "customer reads own orders" on orders for select using (customer_id = auth.uid());
create policy "customer places order" on orders for insert with check (customer_id = auth.uid() and status = 'placed');
create policy "customer cancels or rates" on orders for update using (customer_id = auth.uid());
create policy "restaurant sees its orders" on orders for select using (owns_restaurant(restaurant_id));
create policy "restaurant updates its orders" on orders for update using (owns_restaurant(restaurant_id));
create policy "rider sees ready and own orders" on orders for select
  using (current_role_is('rider') and (status = 'ready' or rider_id = auth.uid()));
create policy "rider updates deliveries" on orders for update
  using (current_role_is('rider') and (status = 'ready' or rider_id = auth.uid()));
create policy "admin manages orders" on orders for all using (current_role_is('admin'));

create policy "items follow order access" on order_items for select
  using (exists (select 1 from orders o where o.id = order_id));
create policy "customer adds items" on order_items for insert
  with check (exists (select 1 from orders o where o.id = order_id and o.customer_id = auth.uid()));

-- Realtime: lets dashboards update live
alter publication supabase_realtime add table orders;
