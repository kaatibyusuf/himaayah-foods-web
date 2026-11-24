-- Himaayah Foods: map + live rider tracking.
-- Run this ONCE in the Supabase SQL editor if your project already has the older schema.
-- (New projects get all of this from schema.sql, so they do not need this file.)

alter table public.store  add column if not exists lat double precision not null default 7.6210;
alter table public.store  add column if not exists lng double precision not null default 5.2214;
alter table public.orders add column if not exists dest_lat  double precision;
alter table public.orders add column if not exists dest_lng  double precision;
alter table public.orders add column if not exists rider_lat double precision;
alter table public.orders add column if not exists rider_lng double precision;
alter table public.orders add column if not exists rider_seen timestamptz;

-- the old 7-argument place_order is replaced by one that also takes the pinned location
drop function if exists public.place_order(jsonb, text, text, text, pay_method, text, boolean);

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
