-- Himaayah Foods v1.2: alerts, distance fees, promo codes, wallet + referrals, opening hours,
-- sold-out-today, scheduled orders.
-- Run this ONCE in the Supabase SQL editor. It works whether or not you already ran tracking.sql.
-- (New projects get all of this from schema.sql.) Safe to run twice.

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
