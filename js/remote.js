/* Himaayah Foods: Supabase data adapter.
   Loads only when js/config.js has a URL and key. It turns database rows into the same
   shape the app already uses, and turns the app's changes back into database writes.
   Prices, fees, discounts and loyalty points are always worked out on the server (place_order). */
(() => {
  'use strict';
  const cfg = window.HF_CONFIG || {};
  const sb = window.HF_TEST_CLIENT || (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null);
  if (!sb) return;

  const must = r => { if (r.error) throw new Error(r.error.message || 'Something went wrong'); return r.data; };
  const T = s => (s ? new Date(s).getTime() : Date.now());
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const mapOrder = r => {
    const created = T(r.created_at), updated = T(r.updated_at);
    const history = [{ s: 'placed', t: created }];
    if (r.status !== 'placed') history.push({ s: r.status, t: updated });
    return {
      id: r.id, customerId: r.customer_id, customerName: r.customer_name, riderId: r.rider_id, riderName: r.rider_name, riderPhone: r.rider_phone,
      items: (r.order_items || []).map(i => ({ id: i.menu_item_id, name: i.name, price: i.price, qty: i.qty, img: i.img_url || '' })),
      subtotal: r.subtotal, fee: r.fee, discount: r.discount, promo: r.promo, total: r.total, pointsUsed: r.points_used,
      address: r.address, phone: r.phone, note: r.note, pay: r.pay, status: r.status, rating: r.rating, createdAt: created, history,
      destLat: r.dest_lat, destLng: r.dest_lng, riderLat: r.rider_lat, riderLng: r.rider_lng, riderSeen: r.rider_seen ? T(r.rider_seen) : 0
    };
  };

  async function load() {
    const [st, mn, pf, od] = await Promise.all([
      sb.from('store').select('*').eq('id', 1).single(),
      sb.from('menu_items').select('*').order('sort', { ascending: true }),
      sb.from('profiles').select('*'),
      sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false })
    ]);
    const s = must(st), menu = must(mn), profiles = must(pf), orders = must(od).map(mapOrder);
    const users = profiles.map(p => {
      const addresses = p.addresses || [], def = addresses.find(a => a.def) || addresses[0];
      return { id: p.id, role: p.role, name: p.name, email: p.email, phone: p.phone, online: p.online, favs: p.favs || [], addresses, cards: p.cards || [], address: def ? def.text : '' };
    });
    // Riders can't read customer profiles and customers can't read rider profiles, so fill in names from the orders themselves.
    orders.forEach(o => {
      if (!users.some(u => u.id === o.customerId)) users.push({ id: o.customerId, role: 'customer', name: o.customerName || 'Customer', email: '', phone: o.phone, favs: [], addresses: [], cards: [] });
      if (o.riderId && !users.some(u => u.id === o.riderId)) users.push({ id: o.riderId, role: 'rider', name: o.riderName || 'Rider', email: '', phone: o.riderPhone || '', favs: [], addresses: [], cards: [] });
    });
    return {
      store: { name: s.name, open: s.open, fee: s.fee, eta: s.eta, address: s.address, base: Number(s.base_rating), ratingSum: s.rating_sum, ratingCount: s.rating_count, lat: s.lat, lng: s.lng },
      menu: menu.map(m => ({ id: m.id, name: m.name, desc: m.description, price: m.price, cat: m.category, img: m.img_url || '', available: m.available })),
      users, orders
    };
  }

  async function persist(before, after, myId) {
    const bs = before.store, as = after.store;
    if (bs.open !== as.open || bs.fee !== as.fee || bs.eta !== as.eta || bs.lat !== as.lat || bs.lng !== as.lng) must(await sb.from('store').update({ open: as.open, fee: as.fee, eta: as.eta, lat: as.lat, lng: as.lng }).eq('id', 1));

    const bm = new Map(before.menu.map(m => [m.id, m])), am = new Map(after.menu.map(m => [m.id, m]));
    let sort = before.menu.length;
    for (const m of after.menu) {
      const old = bm.get(m.id);
      if (!old) must(await sb.from('menu_items').insert({ name: m.name, description: m.desc, price: m.price, category: m.cat, img_url: m.img || '', available: m.available, sort: ++sort }));
      else if (old.price !== m.price || old.available !== m.available || old.img !== m.img) must(await sb.from('menu_items').update({ price: m.price, available: m.available, img_url: m.img || '' }).eq('id', m.id));
    }
    for (const m of before.menu) if (!am.has(m.id)) must(await sb.from('menu_items').delete().eq('id', m.id));

    const bu = before.users.find(u => u.id === myId), au = after.users.find(u => u.id === myId);
    if (bu && au) {
      const pick = u => ({ name: u.name || '', phone: u.phone || '', online: !!u.online, addresses: u.addresses || [], cards: u.cards || [], favs: u.favs || [] });
      if (!same(pick(bu), pick(au))) must(await sb.from('profiles').update(pick(au)).eq('id', myId));
    }

    const bo = new Map(before.orders.map(o => [o.id, o]));
    for (const o of after.orders) {
      const old = bo.get(o.id); if (!old) continue;
      if (old.status !== o.status) must(await sb.rpc('set_order_status', { p_order: o.id, p_status: o.status }));
      if (!old.rating && o.rating) must(await sb.rpc('rate_order', { p_order: o.id, p_rating: o.rating }));
    }
  }

  window.HF_REMOTE = {
    load, persist,
    async init() { const { data } = await sb.auth.getSession(); return data && data.session ? data.session.user.id : null; },
    async signIn(email, password) { const d = must(await sb.auth.signInWithPassword({ email, password })); return d.user.id; },
    async signUp({ name, email, pass, phone, role }) {
      const d = must(await sb.auth.signUp({ email, password: pass, options: { data: { name, phone, role } } }));
      return d.session ? d.user.id : null; // null means the project wants the email confirmed first
    },
    async uploadImage(blob) {
      const path = 'menu/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
      const up = await sb.storage.from('dish-photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
      if (up.error) throw new Error(up.error.message || 'Upload failed');
      return sb.storage.from('dish-photos').getPublicUrl(path).data.publicUrl;
    },
    async signOut() { await sb.auth.signOut(); },
    // Called every few seconds by the rider's phone while a delivery is on the way.
    async sendLocation(orderId, lat, lng) { must(await sb.rpc('update_rider_location', { p_order: orderId, p_lat: lat, p_lng: lng })); },
    async placeOrder(o) {
      return must(await sb.rpc('place_order', { p_items: o.items, p_address: o.address, p_phone: o.phone, p_note: o.note, p_pay: o.pay, p_promo: o.promo || '', p_use_points: !!o.usePoints, p_lat: o.lat == null ? null : o.lat, p_lng: o.lng == null ? null : o.lng }));
    },
    subscribe(cb) {
      let t = null; const ping = () => { clearTimeout(t); t = setTimeout(cb, 250); };
      sb.channel('hf-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, ping)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, ping)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'store' }, ping)
        .subscribe();
    }
  };
})();
