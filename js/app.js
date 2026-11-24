/* Himaayah Foods: one eatery, one menu, one kitchen.
   Data lives in localStorage so the whole order flow works with no backend.
   Sign-in is per tab, so one browser can be customer, kitchen and rider at once and orders move between tabs live.
   Live mode: fill in js/config.js and js/remote.js swaps the same functions for Supabase (see supabase/schema.sql and README). */
(() => {
  'use strict';

  const CITY = 'Ado-Ekiti';
  const VERSION = '1.1';
  const TOWN = { lat: 7.6210, lng: 5.2214 };   // Ado-Ekiti centre, used until the kitchen sets its own pin
  const KEY = 'hf_db_v9', SKEY = 'hf_session_v1', CKEY = 'hf_cart_v2';
  const REDEEM = 300;          // loyalty points needed for free delivery
  const IMG = n => 'assets/img/' + n + '.jpg';
  const PROMOS = {
    FIRST10: { label: '10% off your first order', test: (u, sub) => !getDB().orders.some(o => o.customerId === u.id && o.status !== 'cancelled' && o.status !== 'rejected'), off: sub => Math.min(1000, Math.round(sub * 0.1)) },
    FREEDEL: { label: 'Free delivery on orders over ₦5,000', test: (u, sub) => sub >= 5000, off: (sub, fee) => fee }
  };

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Shrinks a photo in the browser so uploads are fast on mobile data (max 900px, JPEG).
  const shrink = file => new Promise((ok, no) => {
    if (!file || !/^image\//.test(file.type)) return no(new Error('Choose an image file.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(b) : no(new Error('Could not read that image.')), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('Could not read that image.')); };
    img.src = url;
  });
  const blobToUrl = b => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
  // Live mode uploads to Supabase Storage; demo mode keeps a small copy in this browser.
  const savePhoto = async file => { const b = await shrink(file); return R ? R.uploadImage(b) : blobToUrl(b); };
  const naira = n => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
  const uid = p => p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const oid = o => o.id.slice(-6).toUpperCase();
  const first = n => String(n || '').split(' ')[0];
  const ago = t => {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    return new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  };
  const clock = t => new Date(t).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

  const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#FFBB00"/><g transform="translate(8 8) scale(.75)"><path fill="#0F0F11" d="M32 3 56 11.5V30c0 14.2-9.8 25-24 31C17.8 55 8 44.2 8 30V11.5z"/><path fill="none" stroke="#FFBB00" stroke-width="3" stroke-linecap="round" d="M25 26c-3-4 3-7 0-12M32 26c-3-4 3-7 0-12M39 26c-3-4 3-7 0-12"/><rect x="14.5" y="29" width="35" height="3.6" rx="1.8" fill="#FFBB00"/><path fill="#FFBB00" d="M17.5 33.6h29c0 8.6-6.4 13.8-14.5 13.8S17.5 42.2 17.5 33.6z"/><rect x="25.5" y="48.6" width="13" height="3" rx="1.5" fill="#FFBB00"/></g></svg>`;
  const svg = d => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    bag: svg('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    heart: svg('<path d="M12 20s-7-4.4-9-9.2C1.8 7.6 4 5 6.8 5c1.8 0 3.2 1 5.2 3 2-2 3.4-3 5.2-3C20 5 22.2 7.6 21 10.8 19 15.6 12 20 12 20z"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    flame: svg('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.2 1.2.8 2 1.6 2.4C10.2 8.6 10.6 5.6 12 3z"/>'),
    bike: svg('<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="m6 17 4-8h5l3 8M10 9 8 6H6M14 9l-2.5 8"/>'),
    shield: svg('<path d="M12 3l7 2.5V12c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V5.5z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
    home: svg('<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>'),
    grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
    gift: svg('<rect x="3" y="9" width="18" height="5" rx="1"/><path d="M5 14v6h14v-6M12 9v11M12 9C9 9 7.5 8 7.5 6.5S9.5 4 12 9zM12 9c3 0 4.5-1 4.5-2.5S14.5 4 12 9z"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
    out: svg('<path d="M9 21H5V3h4M16 17l5-5-5-5M21 12H9"/>'),
    pin: svg('<path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    medal: svg('<circle cx="12" cy="14" r="6"/><path d="m9 3 3 5 3-5M12 11.5v5M10 14h4"/>'),
    bell: svg('<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>'),
    trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    chef: svg('<path d="M7 14a4 4 0 1 1 1-7.8A4 4 0 0 1 16 6a4 4 0 0 1 1 8v5H7z"/><path d="M7 17h10"/>'),
    menu: svg('<path d="M5 4v7a2 2 0 0 0 2 2v7M9 4v7M7 4v9M17 20V4c-2 1-3.5 3.500-3.500 7 0 1.700 1 2 3.500 2"/>'),
    chev: svg('<path d="m9 6 6 6-6 6"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.100.8-1.100 1.600M12 17h.01"/>'),
    doc: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>'),
    target: svg('<circle cx="12" cy="12" r="6.500"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    card: svg('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10.500h18"/>')
  };
  const TILES = [['#FFF0C2', '#8A5F00'], ['#ECE6D6', '#4A4A52'], ['#F6EBCB', '#8A5F00'], ['#E8E4DA', '#17171A']];
  const tileStyle = id => { const t = TILES[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % TILES.length]; return `--tile:${t[0]};--tile-ink:${t[1]}`; };
  const thumb = (src, label, id, size = '') => src
    ? `<span class="thumb ${size}"><img src="${esc(src)}" alt="" loading="lazy"></span>`
    : `<span class="thumb ${size}" style="${tileStyle(id)}" aria-hidden="true">${esc((label || '?')[0])}</span>`;

  const STATUS = { placed: 'Order placed', preparing: 'Cooking', ready: 'Ready for pickup', on_the_way: 'On the way', delivered: 'Delivered', rejected: 'Rejected', cancelled: 'Cancelled' };
  const ACTIVE = ['placed', 'preparing', 'ready', 'on_the_way'];

  /* ---------- store ---------- */
  function seed() {
    const now = Date.now(), D = 86400000;
    const users = [
      { id: 'u_admin', role: 'admin', name: 'Admin', email: 'admin@demo.com', pass: 'demo123' },
      { id: 'u_amina', role: 'customer', name: 'Amina Yusuf', email: 'amina@demo.com', pass: 'demo123', phone: '0800 000 0001', address: '12 Example Street, ' + CITY, favs: [], addresses: [{ id: 'a1', label: 'Home', text: '12 Example Street, ' + CITY, def: true, lat: 7.6285, lng: 5.2260 }, { id: 'a2', label: 'Work', text: '5 Market Road, ' + CITY, def: false, lat: 7.6150, lng: 5.2150 }], cards: [{ id: 'c1', brand: 'Visa', last4: '4242' }] },
      { id: 'u_kitchen', role: 'kitchen', name: 'Kitchen', email: 'kitchen@demo.com', pass: 'demo123' },
      { id: 'u_rider', role: 'rider', name: 'Tunde Rider', email: 'rider@demo.com', pass: 'demo123', phone: '0800 000 0002', online: true }
    ];
    const store = { name: 'Himaayah Foods', open: true, fee: 500, eta: 30, address: CITY, base: 4.7, ratingSum: 0, ratingCount: 0, lat: TOWN.lat, lng: TOWN.lng };
    const menu = [];
    const M = rows => rows.forEach(([name, desc, price, cat, img]) => menu.push({ id: uid('m'), name, desc, price, cat, img: img ? IMG(img) : '', available: true }));
    M([
      ['Jollof rice and chicken', 'Smoky party jollof with grilled chicken.', 3800, 'Rice', 'jollof'],
      ['Fried rice and chicken', 'Mixed veg, with a side of plantain.', 4000, 'Rice', 'fried-rice-chicken'],
      ['Coconut rice', 'Fragrant coconut rice with fish stew.', 3500, 'Rice', 'fried-rice'],
      ['Ofada rice and stew', 'With ayamase sauce and egg.', 3500, 'Rice', 'ofada'],
      ['Jollof rice (small)', 'Plain portion.', 1800, 'Rice', 'jollof'],
      ['Amala, ewedu and gbegiri', 'Served with assorted meat.', 2500, 'Swallow & Soups', 'amala'],
      ['Amala and ogbono', 'Ogbono soup with beef and ponmo.', 2800, 'Swallow & Soups', 'ogbono'],
      ['Pounded yam and egusi', 'Rich egusi with goat meat.', 3200, 'Swallow & Soups', 'egusi'],
      ['Iyan and efo riro', 'Pounded yam with spinach stew.', 3000, 'Swallow & Soups', 'soup-pot'],
      ['Goat pepper soup', 'Hot and fragrant.', 3000, 'Swallow & Soups', 'pepper-soup'],
      ['Ewedu soup (extra)', 'Fresh, silky ewedu by the bowl.', 800, 'Swallow & Soups', 'ewedu'],
      ['Beef suya', 'Pack with onions and yaji.', 2000, 'Grill', 'suya-beef'],
      ['Chicken suya', 'Spiced chicken skewers, grilled to order.', 3000, 'Grill', 'suya-chicken'],
      ['Ram suya', 'Tender ram, extra spicy.', 3500, 'Grill', 'suya-ram'],
      ['Suya wrap', 'Suya, cabbage and sauce in flatbread.', 2500, 'Grill', 'suya'],
      ['Assorted cookies', 'Box of six, baked this morning.', 2500, 'Bakery', 'cookies'],
      ['Meat pie', 'Flaky pastry, spiced beef filling.', 1000, 'Bakery', 'meat-pie'],
      ['Chicken pie', 'Creamy chicken and peas.', 1200, 'Bakery', 'chicken-pie'],
      ['Sausage roll', 'Warm, buttery.', 800, 'Bakery', 'sausage-roll'],
      ['Cake slice', 'Vanilla or chocolate.', 1500, 'Bakery', 'cake'],
      ['Zobo', 'Chilled, 50cl.', 500, 'Drinks', 'zobo'],
      ['Fresh juice', 'Pineapple or orange, 40cl.', 1200, 'Drinks', 'juice'],
      ['Bottled water', '75cl', 300, 'Drinks', 'water'],
      ['Fried plantain', 'Sweet, golden.', 700, 'Sides', 'plantain'],
      ['Moi moi', 'Steamed bean pudding.', 800, 'Sides', 'moimoi'],
      ['Fries', 'Crispy, lightly salted.', 1500, 'Sides', 'fries'],
      ['Extra assorted meat', 'Beef, shaki and ponmo.', 700, 'Sides', 'shaki']
    ]);
    const item = name => menu.find(m => m.name === name);
    const mk = (id, rows, status, ageMs) => {
      const items = rows.map(([n, q]) => { const m = item(n); return { id: m.id, name: m.name, price: m.price, qty: q, img: m.img }; });
      const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0), t = now - ageMs;
      return { id, customerId: 'u_amina', items, subtotal, fee: store.fee, discount: 0, promo: '', total: subtotal + store.fee, address: '12 Example Street, ' + CITY, phone: '0800 000 0001', note: '', pay: 'cod', destLat: 7.6285, destLng: 5.2260, status, riderId: status === 'delivered' ? 'u_rider' : null, rating: status === 'delivered' ? 5 : 0, pointsUsed: 0, createdAt: t, history: [{ s: 'placed', t }, { s: status, t: t + 20 * 60000 }] };
    };
    const orders = [
      mk('o_h4d1x9', [['Jollof rice and chicken', 1]], 'delivered', 2 * D),
      mk('o_h4d2x9', [['Beef suya', 2]], 'delivered', 5 * D),
      mk('o_h4d3x9', [['Assorted cookies', 1], ['Meat pie', 2]], 'delivered', 8 * D),
      mk('o_h4d4x9', [['Amala and ogbono', 1]], 'delivered', 12 * D),
      mk('o_act1x9', [['Amala, ewedu and gbegiri', 1], ['Ewedu soup (extra)', 1]], 'preparing', 8 * 60000)
    ];
    users[1].favs = [item('Jollof rice and chicken').id, item('Beef suya').id, item('Pounded yam and egusi').id];
    return { store, users, menu, orders };
  }
  const R = window.HF_REMOTE || null;          // set by js/remote.js when Supabase is configured
  let remoteDB = { store: { name: 'Himaayah Foods', open: true, fee: 500, eta: 30, address: CITY, base: 4.7, ratingSum: 0, ratingCount: 0, lat: TOWN.lat, lng: TOWN.lng }, menu: [], users: [], orders: [] };
  let remoteUid = null;
  let cache = null, cacheRaw = null, lastStatus = {};
  function getDB() {
    if (R) return remoteDB;
    const raw = localStorage.getItem(KEY);
    if (!raw) { const s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); cacheRaw = localStorage.getItem(KEY); return (cache = s); }
    if (raw !== cacheRaw) { cache = JSON.parse(raw); cacheRaw = raw; }
    return cache;
  }
  function mutate(fn) {
    if (R) {
      const before = remoteDB, d = JSON.parse(JSON.stringify(before));
      fn(d); remoteDB = d; lastStatus = snapshot(); render(true);
      R.persist(before, d, remoteUid).catch(e => toast(e.message)).then(() => R.load()).then(db => { remoteDB = db; lastStatus = snapshot(); render(true); }).catch(() => {});
      return;
    }
    const d = JSON.parse(JSON.stringify(getDB()));
    fn(d);
    localStorage.setItem(KEY, JSON.stringify(d));
    cacheRaw = null;
    lastStatus = snapshot();
    render(true);
  }
  // Sign-in is per tab (sessionStorage) so one browser can be customer, kitchen and rider at once.
  const session = () => R ? remoteUid : sessionStorage.getItem(SKEY);
  const me = () => { const id = session(); return id ? getDB().users.find(u => u.id === id) || null : null; };
  const getCart = () => { try { const c = JSON.parse(localStorage.getItem(CKEY)); return c && c.items ? c : { items: {} }; } catch (e) { return { items: {} }; } };
  const setCart = c => { localStorage.setItem(CKEY, JSON.stringify(c)); };
  const cartCount = () => Object.values(getCart().items).reduce((a, b) => a + b, 0);
  const storeLoc = () => { const s = getDB().store; return { lat: Number(s.lat) || TOWN.lat, lng: Number(s.lng) || TOWN.lng }; };
  const rating = () => { const s = getDB().store; return s.ratingCount ? ((s.base * 10 + s.ratingSum) / (10 + s.ratingCount)) : s.base; };
  const homeFor = u => !u ? '/' : ({ customer: '/', kitchen: '/kitchen', rider: '/rider', admin: '/admin' }[u.role] || '/');
  const itemImg = o => (o.items.find(i => i.img) || {}).img || '';
  function points(u) {
    const os = getDB().orders.filter(o => o.customerId === u.id);
    const earned = os.filter(o => o.status === 'delivered').reduce((a, o) => a + Math.floor(o.total / 100), 0);
    const spent = os.filter(o => o.status !== 'cancelled' && o.status !== 'rejected').reduce((a, o) => a + (o.pointsUsed || 0), 0);
    return { earned, balance: earned - spent, tier: earned >= 1000 ? 'Gold' : earned >= 500 ? 'Silver' : 'Bronze' };
  }


  /* ---------- maps and live location ---------- */
  // Leaflet is bundled in assets/vendor. Map tiles come from OpenStreetMap.
  const hasMap = () => typeof window.L !== 'undefined';
  const maps = new Map();
  const km = (a, b) => { const r = x => x * Math.PI / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)); };
  const dist = k => k < 1 ? Math.max(10, Math.round(k * 100) * 10) + ' m' : k.toFixed(1) + ' km';
  const geoMsg = err => err && err.code === 1 ? 'Location is blocked. Allow it for this site in your browser settings.' : err && err.code === 3 ? 'Could not get your location in time. Try again near a window or outside.' : 'Could not find your location.';
  const mkIcon = (cls, icon) => L.divIcon({ className: 'mk ' + cls, html: '<span>' + icon + '</span>', iconSize: cls.includes('pin') ? [38, 48] : [38, 38], iconAnchor: cls.includes('pin') ? [19, 48] : [19, 19] });
  const killMaps = () => { maps.forEach(m => { try { m.map.remove(); } catch (e) { /* already gone */ } }); maps.clear(); };
  const editing = () => $('form[data-form="checkout"], form[data-form="add-address"], form[data-form="store-settings"], form[data-form="profile"]');

  function mountMaps() {
    killMaps();
    const els = document.querySelectorAll('[data-map]'); if (!els.length) return;
    if (!hasMap()) { els.forEach(el => { el.innerHTML = '<p class="muted small" style="padding:18px">The map could not load. Check your connection and refresh.</p>'; }); return; }
    els.forEach(el => {
      const map = L.map(el, { scrollWheelZoom: false });
      map.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      const e = { map, el, kind: el.dataset.map, layers: {} };
      maps.set(el.id, e);
      if (e.kind === 'pick') initPick(e); else initTrack(e);
      setTimeout(() => { try { map.invalidateSize(); } catch (x) { /* removed */ } }, 60);
    });
  }

  // A map the customer or kitchen taps to drop a pin. The pin is written into hidden lat/lng fields of the form.
  function initPick(e) {
    const form = e.el.closest('form'), latI = form.querySelector('[name=lat]'), lngI = form.querySelector('[name=lng]');
    const start = e.el.dataset.lat ? { lat: Number(e.el.dataset.lat), lng: Number(e.el.dataset.lng) } : null, c = start || storeLoc();
    e.map.setView([c.lat, c.lng], start ? 17 : 14);
    e.set = (lat, lng, move, ask) => {
      if (!e.marker) { e.marker = L.marker([lat, lng], { icon: mkIcon('pin', I.pin), draggable: true, title: 'Delivery pin' }).addTo(e.map); e.marker.on('dragend', () => { const p = e.marker.getLatLng(); e.set(p.lat, p.lng, false, true); }); }
      else e.marker.setLatLng([lat, lng]);
      latI.value = lat.toFixed(6); lngI.value = lng.toFixed(6);
      if (move) e.map.setView([lat, lng], Math.max(e.map.getZoom(), 17));
      const msg = form.querySelector('.pinmsg'); if (msg) msg.textContent = 'Pin placed. Drag it to fine-tune.';
      if (ask) reverseFill(form, lat, lng);
    };
    e.map.on('click', ev => e.set(ev.latlng.lat, ev.latlng.lng, false, true));
    if (start) { e.set(start.lat, start.lng, false, false); const m = form.querySelector('.pinmsg'); if (m) m.textContent = 'Pin placed. Drag it to fine-tune.'; }
  }
  // Suggests an address from the pin, but only fills the box when it is empty.
  let revT = null;
  function reverseFill(form, lat, lng) {
    const box = form.querySelector('[data-addrtext]'); if (!box || box.value.trim()) return;
    clearTimeout(revT);
    revT = setTimeout(() => {
      fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=' + lat + '&lon=' + lng, { headers: { 'Accept-Language': 'en' } })
        .then(r => r.json()).then(j => { if (j && j.display_name && !box.value.trim()) box.value = j.display_name.split(', ').slice(0, 4).join(', '); }).catch(() => {});
    }, 600);
  }
  function locateInto(mapId, btn) {
    const e = maps.get(mapId);
    if (!navigator.geolocation) return toast('This device cannot share its location.');
    if (btn) btn.disabled = true;
    navigator.geolocation.getCurrentPosition(p => { if (btn) btn.disabled = false; if (e && e.set) e.set(p.coords.latitude, p.coords.longitude, true, true); },
      err => { if (btn) btn.disabled = false; toast(geoMsg(err)); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
  }
  async function findOnMap(mapId, btn) {
    const e = maps.get(mapId), form = e && e.el.closest('form'), box = form && form.querySelector('[data-addrtext]'), text = box ? box.value.trim() : '';
    if (!text) return toast('Type the address first, then search.');
    btn.disabled = true;
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ng&q=' + encodeURIComponent(text + ', ' + CITY + ', Ekiti'), { headers: { 'Accept-Language': 'en' } });
      const j = await r.json();
      if (!j.length) toast('Could not find that address. Tap the map to drop a pin instead.'); else e.set(Number(j[0].lat), Number(j[0].lon), true, false);
    } catch (x) { toast('Address search is unavailable. Tap the map to drop a pin.'); }
    btn.disabled = false;
  }

  // Order maps: kitchen, delivery pin and the rider, moved in place as new locations arrive.
  const ORDER_PTS = o => ({
    store: storeLoc(),
    dest: o.destLat != null && o.destLng != null ? { lat: Number(o.destLat), lng: Number(o.destLng) } : null,
    rider: o.status === 'on_the_way' && o.riderLat != null ? { lat: Number(o.riderLat), lng: Number(o.riderLng) } : null
  });
  function trackText(o) {
    const p = ORDER_PTS(o);
    if (o.status === 'on_the_way') {
      if (!p.rider) return 'Waiting for the rider’s location…';
      const old = o.riderSeen ? Math.round((Date.now() - o.riderSeen) / 60000) : 0, stale = old >= 3 ? ' Last updated ' + old + ' min ago.' : '';
      if (!p.dest) return 'Your rider is on the way.' + stale;
      const k = km(p.rider, p.dest);
      return k < 0.05 ? 'Your rider has arrived.' + stale : 'Rider is about ' + dist(k) + ' away, roughly ' + Math.max(1, Math.round(k / 20 * 60)) + ' min.' + stale;
    }
    return p.dest ? 'Delivering to the spot you pinned.' : '';
  }
  function initTrack(e) { e.orderId = e.el.dataset.order; updateTrack(e, true); }
  function updateTrack(e, fit) {
    const o = getDB().orders.find(x => x.id === e.orderId); if (!o) return;
    const p = ORDER_PTS(o), L_ = e.layers;
    const put = (k, ll, icon, title) => {
      if (!ll) { if (L_[k]) { L_[k].remove(); delete L_[k]; } return; }
      if (L_[k]) L_[k].setLatLng([ll.lat, ll.lng]); else L_[k] = L.marker([ll.lat, ll.lng], { icon, title, keyboard: false }).addTo(e.map);
    };
    put('store', p.store, mkIcon('store', I.menu), 'Kitchen');
    put('dest', p.dest, mkIcon('pin', I.pin), 'Delivery location');
    put('rider', p.rider, mkIcon('rider', I.bike), 'Rider');
    if (L_.line) { L_.line.remove(); delete L_.line; }
    if (p.rider && p.dest) L_.line = L.polyline([[p.rider.lat, p.rider.lng], [p.dest.lat, p.dest.lng]], { color: '#0F0F11', weight: 3, dashArray: '2 8', opacity: .7 }).addTo(e.map);
    const pts = [p.store, p.dest, p.rider].filter(Boolean).map(x => [x.lat, x.lng]);
    if (fit || (p.rider && !e.map.getBounds().contains([p.rider.lat, p.rider.lng]))) { if (pts.length > 1) e.map.fitBounds(L.latLngBounds(pts).pad(.3), { maxZoom: 17 }); else e.map.setView(pts[0], 15); }
    const info = document.getElementById('trackInfo-' + o.id); if (info) info.textContent = trackText(o);
  }
  // Moves markers and the distance text without rebuilding the page.
  function refreshLive() { maps.forEach(e => { if (e.kind === 'track') updateTrack(e, false); }); }

  // Rider phone: share GPS with the order while a delivery is on the way (checked every 10 seconds).
  const share = { timer: null, sentAt: 0, last: null, gps: 'idle', net: true, at: 0, sim: null, busy: false };
  const hhmm = t => new Date(t).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  function paintShare() {
    const el = document.getElementById('shareState'); if (!el) return;
    el.textContent = share.sim ? 'Demo ride running. The customer map is moving.'
      : share.gps === 'denied' ? 'Location is blocked, so the customer cannot see you. Allow location for this site in your browser settings.'
      : share.gps === 'unavailable' ? 'This device cannot share its location.'
      : !share.net ? 'Could not send your location. Check your connection.'
      : share.gps === 'weak' ? 'Waiting for a GPS signal…'
      : share.gps === 'live' ? 'Sharing your live location with the customer. Last sent ' + hhmm(share.at) + '. Keep this page open.'
      : 'Getting your location…';
  }
  function pushLocation(o, lat, lng) {
    share.at = Date.now(); share.sentAt = share.at; share.last = { lat, lng };
    if (R) {
      const x = remoteDB.orders.find(z => z.id === o.id); if (x) { x.riderLat = lat; x.riderLng = lng; x.riderSeen = share.at; }
      R.sendLocation(o.id, lat, lng).then(() => { if (!share.net) { share.net = true; paintShare(); } }).catch(() => { share.net = false; paintShare(); });
    } else {
      try { const raw = JSON.parse(localStorage.getItem(KEY)), x = raw.orders.find(z => z.id === o.id); if (x) { x.riderLat = lat; x.riderLng = lng; x.riderSeen = share.at; localStorage.setItem(KEY, JSON.stringify(raw)); cacheRaw = null; } } catch (e) { /* storage full */ }
    }
    refreshLive();
  }
  const myActive = () => { const u = me(); return u && u.role === 'rider' ? getDB().orders.filter(o => o.riderId === u.id && o.status === 'on_the_way') : []; };
  function onPos(p) {
    const lat = p.coords.latitude, lng = p.coords.longitude, now = Date.now(), moved = share.last ? km(share.last, { lat, lng }) * 1000 : 999;
    share.gps = 'live';
    if (!share.sentAt || moved > 15 || now - share.sentAt >= 30000) myActive().forEach(o => pushLocation(o, lat, lng));
    paintShare();
  }
  function poll() {
    if (share.sim || share.busy || !myActive().length || !navigator.geolocation) return;
    share.busy = true;
    navigator.geolocation.getCurrentPosition(p => { share.busy = false; onPos(p); }, err => { share.busy = false; share.gps = err && err.code === 1 ? 'denied' : 'weak'; paintShare(); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
  }
  function syncSharing() {
    if (!myActive().length) { stopSharing(); return; }
    if (!navigator.geolocation) { share.gps = 'unavailable'; paintShare(); return; }
    if (!share.timer && !share.sim) { share.gps = 'idle'; share.sentAt = 0; share.last = null; share.timer = setInterval(poll, 10000); poll(); }
    paintShare();
  }
  function stopSharing() {
    if (share.timer) { clearInterval(share.timer); share.timer = null; }
    if (share.sim && !myActive().length) { clearInterval(share.sim); share.sim = null; }
    if (!share.sim) { share.gps = 'idle'; share.last = null; share.sentAt = 0; share.net = true; }
  }
  // Demo mode only: walks a pretend rider from the kitchen to the customer so tracking can be tried without driving anywhere.
  function toggleSim() {
    if (share.sim) { clearInterval(share.sim); share.sim = null; syncSharing(); render(true); return; }
    const o = myActive()[0]; if (!o) return;
    const a = storeLoc(), b = o.destLat != null ? { lat: Number(o.destLat), lng: Number(o.destLng) } : { lat: a.lat + 0.008, lng: a.lng + 0.006 };
    if (share.timer) { clearInterval(share.timer); share.timer = null; }
    let i = 0; const N = 24;
    const step = () => { const t = Math.min(1, i / N), wob = Math.sin(i) * 0.0002; pushLocation(o, a.lat + (b.lat - a.lat) * t + wob, a.lng + (b.lng - a.lng) * t - wob); if (i++ >= N) { clearInterval(share.sim); share.sim = null; syncSharing(); render(true); } };
    share.sim = setInterval(step, 2000); step(); render(true);
  }

  /* ---------- ui state ---------- */
  const ui = { q: '', cat: 'All', cheap: false, favs: false, sort: 'rec', promo: '', editAddr: '' };
  const go = p => { location.hash = '#' + p; };
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  /* ---------- layout ---------- */
  function nav(role) {
    const u = me(), act = u ? getDB().orders.filter(o => o.customerId === u.id && ACTIVE.includes(o.status)).length : 0;
    if (role === 'customer') return [['/', 'Dashboard', I.grid], ['/menu', 'Menu', I.menu], ['/orders', 'My orders', I.receipt, act], ['/favorites', 'Favorites', I.heart], ['/rewards', 'Rewards', I.gift], ['/account', 'Profile', I.user]];
    if (role === 'kitchen') return [['/kitchen', 'Orders', I.receipt], ['/kitchen/menu', 'Menu manager', I.menu], ['/kitchen/settings', 'Settings', I.gear]];
    if (role === 'rider') return [['/rider', 'Deliveries', I.bike]];
    if (role === 'admin') return [['/admin', 'Dashboard', I.grid]];
    return [['/menu', 'Menu', I.menu], ['/login', 'Sign in', I.user], ['/register', 'Create account', I.gift]];
  }
  const isOn = (path, href) => href === '/' ? path === '/' : href === '/kitchen' ? path === '/kitchen' : (path === href || path.startsWith(href + '/'));
  function app(path, body) {
    const u = me(), role = u ? u.role : 'guest', n = cartCount(), items = nav(role);
    const customerish = role === 'customer' || role === 'guest';
    const links = items.map(l => `<a href="#${l[0]}"${isOn(path, l[0]) ? ' class="on"' : ''}>${l[2]}<span>${l[1]}</span>${l[3] ? `<span class="count">${l[3]}</span>` : ''}</a>`).join('');
    const act = role === 'customer' ? items.find(l => l[1] === 'My orders')[3] : 0;
    const tabs = role === 'customer' || role === 'guest' ? `<nav class="tabbar" aria-label="Quick navigation">
      ${[['/', 'Home', I.grid, path === '/' && u], ['/menu', 'Menu', I.menu, path === '/menu'], ['/cart', 'Cart', I.bag, path === '/cart' || path === '/checkout', n], u ? ['/orders', 'Orders', I.receipt, path.startsWith('/order'), act] : ['/login', 'Sign in', I.user, false], u ? ['/account', 'Profile', I.user, path.startsWith('/account') || ['/favorites', '/rewards'].includes(path)] : ['/register', 'Join', I.gift, false]].map(t => `<a href="#${t[0]}"${t[3] ? ' class="on"' : ''}>${t[2]}<span>${t[1]}</span>${t[4] ? `<span class="dot">${t[4]}</span>` : ''}</a>`).join('')}</nav>` : '';
    const search = customerish ? `<form class="search" data-form="search" role="search"><span aria-hidden="true">${I.search}</span><input class="input" id="q" type="search" placeholder="Search the menu" aria-label="Search the menu" value="${esc(ui.q)}" autocomplete="off"></form>` : '';
    const tools = customerish
      ? `<a class="iconbtn" href="${u ? '#/orders' : '#/login'}" aria-label="Orders">${I.bell}${act ? `<span class="dot">${act}</span>` : ''}</a><a class="iconbtn" href="#/cart" aria-label="Cart${n ? ', ' + n + ' items' : ''}">${I.bag}${n ? `<span class="dot">${n}</span>` : ''}</a>`
      : '';
    const who = u ? `<a class="who" href="${u.role === 'customer' ? '#/account' : '#' + homeFor(u)}"><span class="av">${esc(u.name[0])}</span><div><b>${esc(u.name)}</b><span>${{ customer: 'Customer', kitchen: 'Kitchen', rider: 'Rider', admin: 'Owner' }[u.role]}</span></div></a>` : `<a class="btn sm" href="#/login">Sign in</a>`;
    const cartbar = path === '/menu' && n ? `<div class="cartbar has"><a class="btn yellow" href="#/cart"><span>View cart (${n})</span><span>${naira(cartLines().total)}</span></a></div>` : '';
    return `<div class="app"><aside class="sb"><a class="brand" href="#${esc(homeFor(u))}" aria-label="Himaayah Foods home">${LOGO}<span class="w">Himaayah <b>Foods</b></span></a>
      <nav aria-label="Main">${links}</nav>
      <div class="bottom">${u ? `<button data-act="logout">${I.out}<span>Log out</span></button>` : ''}</div></aside>
      <div class="mn"><header class="tb"><a class="brand" href="#${esc(homeFor(u))}" aria-label="Himaayah Foods home">${LOGO}<span class="w">Himaayah <b>Foods</b></span></a>${search}<div class="tools">${tools}${who}</div></header>
      <div class="pg">${body}</div></div></div>${cartbar}${tabs}`;
  }
  function site(path, body) {
    const u = me(), year = new Date().getFullYear();
    return `<header class="site-head"><div class="container"><a class="brand" href="#/" aria-label="Himaayah Foods home">${LOGO}<span class="w">Himaayah <b>Foods</b></span></a>
      <nav aria-label="Main"><a class="hide-sm" href="#/menu">Menu</a><a class="hide-sm" href="#/" data-act="scroll" data-v="how">How it works</a><a class="hide-sm" href="#/" data-act="scroll" data-v="faq">FAQs</a>${u ? `<a class="btn sm" href="#${homeFor(u)}">Open app</a>` : `<a class="hide-sm" href="#/login">Sign in</a><a class="btn sm yellow" href="#/menu">Order now</a>`}</nav></div></header>
      ${body}
      <footer class="site-foot"><div class="container"><div class="foot-grid">
        <div class="foot-brand"><a class="brand" href="#/" aria-label="Himaayah Foods home">${LOGO}<span class="w">Himaayah <b>Foods</b></span></a><p>Hot, home-style meals cooked fresh and delivered across ${CITY}.</p></div>
        <nav aria-label="Explore"><h4>Explore</h4><a href="#/menu">Menu</a><a href="#/login">Sign in</a><a href="#/register">Create account</a></nav>
        <nav aria-label="Work with us"><h4>Work with us</h4><a href="#/register">Ride with us</a></nav>
        <div><h4>Contact</h4><p class="l">${CITY}, Ekiti State</p><p class="l">Open daily for delivery</p></div></div>
        <div class="foot-base"><span>© ${year} Himaayah Foods. All rights reserved.</span><span>Cooked fresh, delivered honest.${R ? '' : ' <button data-act="reset-demo">Reset demo data</button>'}</span></div></div></footer>`;
  }

  /* ---------- views: public ---------- */
  function dishCardSmall(m) {
    return `<div class="dish"><div class="ph-img" style="${tileStyle(m.id)}">${m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy">` : esc(m.name[0])}</div><h3>${esc(m.name)}</h3><div class="foot"><span class="price">${naira(m.price)}</span><a class="btn sm outline" href="#/menu">Order</a></div></div>`;
  }
  function viewLanding() {
    const db = getDB(), s = db.store, picks = db.menu.filter(m => m.img && m.available).filter((m, i, a) => a.findIndex(x => x.img === m.img) === i).slice(0, 6);
    return `<div class="container"><section class="hero"><div><h1>Ṣé o ti jẹun?<span>Have you eaten?</span></h1>
      <p class="lead">Amala, jollof, suya, soups and fresh bakes from our kitchen in ${CITY}, cooked after you order and brought to your door.</p>
      <div class="cta"><a class="btn yellow" href="#/menu">Order now</a><a class="btn ghost" href="#/" data-act="scroll" data-v="how">How it works</a><span class="muted small"><span class="star">★ ${rating().toFixed(1)}</span> · about ${s.eta} min to cook</span></div></div>
      <div class="mosaic" aria-hidden="true"><div><img src="${IMG('jollof')}" alt=""></div><div><img src="${IMG('egusi')}" alt=""></div><div><img src="${IMG('cookies')}" alt=""></div></div></section>
      <section class="sec" id="how"><h2>Get started in 3</h2><p class="muted">From craving to doorstep, without the stress.</p>
        <div class="steps"><div class="step"><span class="no">1</span><h3>Pick your meal</h3><p class="muted">Browse the menu by category and add what you like.</p></div><div class="step"><span class="no">2</span><h3>Place your order</h3><p class="muted">Enter your address, choose how to pay and confirm.</p></div><div class="step"><span class="no">3</span><h3>Track and enjoy</h3><p class="muted">Follow it from our kitchen to your door, then eat while it’s hot.</p></div></div></section>
      <section class="sec"><div class="row between wrap" style="margin-bottom:16px"><div><h2>Today’s favourites</h2><p class="muted">Most-loved dishes from the kitchen.</p></div><a class="btn outline sm" href="#/menu">See full menu</a></div><div class="dishes six">${picks.map(dishCardSmall).join('')}</div></section>
      <section class="sec"><div class="live"><div><h2>You’ll always know where your food is.</h2><p style="margin-top:10px">Live updates at every step, from the moment the kitchen accepts your order to the moment the rider arrives.</p><div style="margin-top:20px"><a class="btn yellow" href="#/menu">Start an order</a></div></div>${tracker({ status: 'on_the_way' })}</div></section>
      <section class="sec"><div class="promo-strip"><div><h3 style="font-size:22px">First order?</h3><p>Create an account and use <code>FIRST10</code> for 10% off.</p></div><a class="btn" href="#/register">Create account</a></div></section>
      <section class="sec faq" id="faq"><h2>Questions</h2>
        <details><summary>Where do you deliver?</summary><p>We deliver within ${CITY}. You’ll enter your address at checkout.</p></details>
        <details><summary>How long does an order take?</summary><p>Every order is cooked after you place it, which takes about ${s.eta} minutes, plus the ride to you. You’ll see an arrival time on your order.</p></details>
        <details><summary>How do I pay?</summary><p>Pay on delivery, or use a saved card. Online card payments are coming soon.</p></details>
        <details><summary>Can I follow my order?</summary><p>Yes. Your order page updates as the kitchen cooks it and the rider brings it.</p></details></section></div>`;
  }
  function viewLogin() {
    const demos = [['Customer', 'amina@demo.com'], ['Kitchen', 'kitchen@demo.com'], ['Rider', 'rider@demo.com'], ['Owner', 'admin@demo.com']];
    return `<div class="container auth-wrap"><div class="stack" style="width:min(460px,100%)">
      <h1>Welcome back</h1>
      <form class="form" data-form="login" novalidate>
        <div class="field"><label for="le">Email</label><input class="input" id="le" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="lp">Password</label><input class="input" id="lp" name="pass" type="password" autocomplete="current-password" required></div>
        <p class="notice bad" id="lerr" hidden></p>
        <button class="btn block" type="submit">Sign in</button>
      </form>
      <p class="muted">New here? <a href="#/register"><b>Create an account</b></a></p>
      ${R ? '' : `<div class="card stack"><div><h3>Try a demo account</h3><p class="muted small">Password for all demo accounts is <b>demo123</b>. Open the app in separate tabs to watch an order move between customer, kitchen and rider.</p></div>
        <div class="row wrap">${demos.map(d => `<button class="btn ghost sm" data-act="quick" data-email="${d[1]}">${d[0]}</button>`).join('')}</div></div>`}</div></div>`;
  }
  function viewRegister() {
    return `<div class="container auth-wrap"><div class="stack" style="width:min(460px,100%)">
      <h1>Create your account</h1>
      <form class="form" data-form="register" novalidate>
        <div class="field"><label for="rr">I am a</label><select class="input" id="rr" name="role"><option value="customer">Customer</option><option value="rider">Delivery rider</option></select></div>
        <div class="field"><label for="rn">Full name</label><input class="input" id="rn" name="name" required autocomplete="name"></div>
        <div class="field"><label for="re">Email</label><input class="input" id="re" name="email" type="email" required autocomplete="username"></div>
        <div class="field"><label for="rph">Phone</label><input class="input" id="rph" name="phone" type="tel" autocomplete="tel"></div>
        <div class="field"><label for="rp">Password</label><input class="input" id="rp" name="pass" type="password" minlength="6" required autocomplete="new-password"></div>
        <p class="notice bad" id="rerr" hidden></p>
        <button class="btn block" type="submit">Create account</button>
      </form>
      <p class="muted">Already registered? <a href="#/login"><b>Sign in</b></a></p></div></div>`;
  }

  /* ---------- views: menu + cart ---------- */
  function popularity() { const m = {}; getDB().orders.forEach(o => o.items.forEach(i => { m[i.id] = (m[i.id] || 0) + i.qty; })); return m; }
  function filteredMenu() {
    const db = getDB(), u = me(), q = ui.q.trim().toLowerCase(), favs = (u && u.favs) || [];
    let list = db.menu.slice();
    if (ui.cat !== 'All') list = list.filter(m => m.cat === ui.cat);
    if (ui.cheap) list = list.filter(m => m.price <= 3000);
    if (ui.favs) list = list.filter(m => favs.includes(m.id));
    if (q) list = list.filter(m => (m.name + ' ' + m.desc + ' ' + m.cat).toLowerCase().includes(q));
    if (ui.sort === 'pop') { const p = popularity(); list.sort((a, b) => (p[b.id] || 0) - (p[a.id] || 0)); }
    if (ui.sort === 'low') list.sort((a, b) => a.price - b.price);
    if (ui.sort === 'high') list.sort((a, b) => b.price - a.price);
    return list;
  }
  function dishCard(m) {
    const u = me(), s = getDB().store, favs = (u && u.favs) || [], q = getCart().items[m.id] || 0, can = s.open && m.available, hon = favs.includes(m.id);
    const ctl = !can ? `<span class="badge">${s.open ? 'Sold out' : 'Closed'}</span>` : q
      ? `<div class="qty"><button data-act="dec" data-id="${m.id}" aria-label="Remove one ${esc(m.name)}">−</button><span>${q}</span><button data-act="add" data-id="${m.id}" aria-label="Add one ${esc(m.name)}">+</button></div>`
      : `<button class="btn sm outline" data-act="add" data-id="${m.id}">Order</button>`;
    return `<div class="dish${can ? '' : ' off'}"><div class="ph-img" style="${tileStyle(m.id)}">${m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy">` : esc(m.name[0])}</div>
      <button class="heart${hon ? ' on' : ''}" data-act="fav" data-id="${m.id}" aria-label="${hon ? 'Remove from' : 'Add to'} favorites: ${esc(m.name)}" aria-pressed="${hon}">${I.heart}</button>
      <h3>${esc(m.name)}</h3><p class="d">${esc(m.desc)}</p><div class="foot"><span class="price">${naira(m.price)}</span>${ctl}</div></div>`;
  }
  function dishGrid() {
    const list = filteredMenu();
    return list.length ? `<div class="dishes">${list.map(dishCard).join('')}</div>` : `<div class="empty">${I.menu}<p>Nothing matches. Try another category or clear a filter.</p></div>`;
  }
  function cartPanel() {
    const c = cartLines(), s = getDB().store;
    if (!c.lines.length) return `<aside class="cartp" aria-label="Your order"><h2>Your order</h2><div class="empty" style="padding:24px 8px">${I.bag}<p>Your cart is empty. Tap Order on a dish to add it.</p></div></aside>`;
    return `<aside class="cartp" aria-label="Your order"><div class="row between"><h2>Your order</h2><button class="btn ghost sm" data-act="clear-cart">Clear</button></div>
      ${c.lines.map(l => `<div class="cl">${thumb(l.img, l.name, l.id)}<div><p>${esc(l.name)}</p><p class="muted small">${naira(l.price)}</p></div>
        <div class="ctl"><div class="qty"><button data-act="dec" data-id="${l.id}" aria-label="Remove one ${esc(l.name)}">−</button><span>${l.qty}</span><button data-act="add" data-id="${l.id}" aria-label="Add one ${esc(l.name)}">+</button></div><span class="price">${naira(l.price * l.qty)}</span><button class="rm" data-act="rm" data-id="${l.id}" aria-label="Remove ${esc(l.name)}">${I.trash}</button></div></div>`).join('')}
      ${summary(c)}${s.open ? `<a class="btn yellow block" href="#/checkout">Checkout ${naira(c.total)}</a>` : '<p class="notice bad">We’re closed right now, so ordering is paused.</p>'}</aside>`;
  }
  function viewMenu() {
    const db = getDB(), s = db.store, cats = ['All', ...new Set(db.menu.map(m => m.cat))];
    const cnt = c => c === 'All' ? db.menu.length : db.menu.filter(m => m.cat === c).length;
    const tog = (k, label) => `<button class="chip${ui[k] ? ' on' : ''}" data-act="toggle" data-v="${k}" aria-pressed="${!!ui[k]}">${label}</button>`;
    return `<div class="menu-grid"><section class="stack">
      <div class="ph"><div><h1>What are you craving?</h1><p class="muted">${s.open ? `Cooked fresh · about ${s.eta} min · ${naira(s.fee)} delivery` : 'We’re closed right now. You can browse, but ordering is paused.'}</p></div></div>
      <div class="cats" role="group" aria-label="Category">${cats.map(c => `<button class="cat${c === ui.cat ? ' on' : ''}" data-act="cat" data-v="${esc(c)}">${esc(c === 'All' ? 'All menu' : c)} <span class="n">${cnt(c)}</span></button>`).join('')}</div>
      <div class="filters">${tog('cheap', 'Under ₦3,000')}${me() ? tog('favs', 'My favorites') : ''}
        <select class="select" data-act="sort" aria-label="Sort by"><option value="rec"${ui.sort === 'rec' ? ' selected' : ''}>Recommended</option><option value="pop"${ui.sort === 'pop' ? ' selected' : ''}>Most ordered</option><option value="low"${ui.sort === 'low' ? ' selected' : ''}>Price: low to high</option><option value="high"${ui.sort === 'high' ? ' selected' : ''}>Price: high to low</option></select></div>
      <div id="dishes">${dishGrid()}</div></section>${cartPanel()}</div>`;
  }
  function cartLines(redeem, code) {
    const db = getDB(), cart = getCart(), s = db.store, u = me();
    const lines = Object.entries(cart.items).map(([id, qty]) => { const m = db.menu.find(x => x.id === id); return m ? { ...m, qty } : null; }).filter(Boolean);
    const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0), base = lines.length ? s.fee : 0;
    let fee = redeem ? 0 : base, discount = 0, promo = '';
    const P = code && PROMOS[code];
    if (P && u && P.test(u, subtotal)) { promo = code; discount = Math.min(subtotal + fee, P.off(subtotal, fee)); }
    return { lines, subtotal, fee, base, discount, promo, total: subtotal + fee - discount };
  }
  const summary = c => `<div class="sum" id="sumBox"><div class="row between"><span>Subtotal</span><span>${naira(c.subtotal)}</span></div><div class="row between"><span>Delivery</span><span id="sumFee">${c.fee ? naira(c.fee) : 'Free'}</span></div>${c.discount ? `<div class="row between"><span>Discount${c.promo ? ' (' + esc(c.promo) + ')' : ''}</span><span>−${naira(c.discount)}</span></div>` : ''}<div class="row between total"><span>Total</span><span id="sumTotal">${naira(c.total)}</span></div></div>`;
  function viewCart() {
    const c = cartLines();
    if (!c.lines.length) return `<div class="empty">${I.bag}<h2>Your cart is empty</h2><p>Pick something tasty from the menu.</p><a class="btn yellow" href="#/menu">Browse the menu</a></div>`;
    return `<h1>Your cart</h1><div class="split"><div class="card">
      ${c.lines.map(l => `<div class="item">${thumb(l.img, l.name, l.id)}<div class="grow"><h3 style="font-size:15.5px">${esc(l.name)}</h3><p class="price">${naira(l.price)}</p></div><div class="qty"><button data-act="dec" data-id="${l.id}" aria-label="Remove one ${esc(l.name)}">−</button><span>${l.qty}</span><button data-act="add" data-id="${l.id}" aria-label="Add one ${esc(l.name)}">+</button></div></div>`).join('')}
      <button class="btn ghost sm" data-act="clear-cart" style="margin-top:12px">Clear cart</button></div>
      <div class="card stack">${summary(c)}<a class="btn yellow block" href="#/checkout">Go to checkout</a></div></div>`;
  }
  function refreshSum() {
    const red = $('input[name=redeem]'), c = cartLines(red && red.checked, ui.promo);
    const box = $('#sumBox'); if (box) box.outerHTML = summary(c);
    const b = $('#placeBtn'); if (b) b.textContent = 'Place order · ' + naira(c.total);
    const m = $('#promoMsg'); if (m) { const P = ui.promo && PROMOS[ui.promo]; m.hidden = !ui.promo; m.textContent = !ui.promo ? '' : c.promo ? PROMOS[c.promo].label + ' applied.' : P ? 'This code doesn’t apply to this order.' : 'That code isn’t valid.'; }
  }
  function viewCheckout() {
    const u = me(), c = cartLines(false, ui.promo), p = points(u), addrs = u.addresses || [], cards = u.cards || [];
    if (!c.lines.length) return viewCart();
    const canRedeem = p.balance >= REDEEM && c.base > 0, def = addrs.find(a => a.def) || addrs[0];
    return `<h1>Checkout</h1><div class="split"><form class="form" style="max-width:none" id="checkoutForm" data-form="checkout" novalidate>
      <div class="card stack"><h3>Delivery details</h3>
        <div class="two"><div class="field"><label for="cn">Name</label><input class="input" id="cn" name="name" required value="${esc(u.name)}"></div>
        <div class="field"><label for="cp">Phone</label><input class="input" id="cp" name="phone" type="tel" required value="${esc(u.phone || '')}"></div></div>
        ${addrs.length ? `<div class="field"><label for="cs">Saved addresses</label><select class="input" id="cs" data-act="use-addr">${addrs.map(x => `<option value="${x.id}"${def && x.id === def.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label for="ca">Delivery address</label><textarea class="input" id="ca" name="address" data-addrtext required placeholder="House number, street, landmark">${esc(def ? def.text : (u.address || ''))}</textarea></div>
        <div class="field"><label for="cno">Note for the kitchen (optional)</label><input class="input" id="cno" name="note" placeholder="e.g. no pepper"></div></div>
      <div class="card stack"><div><h3>Pin your location</h3><p class="muted small">A pin helps the rider find you fast, and lets you follow the ride on a map.</p></div>${mapBox('map-co', def && def.lat != null ? def.lat : null, def && def.lng != null ? def.lng : null)}</div>
      <div class="card stack"><h3>Payment</h3>
        <label class="radio"><input type="radio" name="pay" value="cod" checked><span><b>Pay on delivery</b><br><span class="muted small">Cash or transfer to the rider when your food arrives.</span></span></label>
        ${cards.map(k => `<label class="radio"><input type="radio" name="pay" value="card"><span><b>${esc(k.brand)} ending ${esc(k.last4)}</b><br><span class="muted small">Simulated payment for testing.</span></span></label>`).join('')}
        ${cards.length ? '' : `<label class="radio"><input type="radio" name="pay" value="card"><span><b>Card (demo)</b><br><span class="muted small">Simulated payment. Real card payments need a provider such as Paystack.</span></span></label>`}</div>
      <div class="card stack"><h3>Offers</h3><div class="promo"><input class="input" id="promoIn" placeholder="Promo code" aria-label="Promo code" value="${esc(ui.promo)}" autocomplete="off"><button class="btn ghost" type="button" data-act="promo">Apply</button></div><p id="promoMsg" class="small muted" hidden></p>
      ${canRedeem ? `<label class="radio"><input type="checkbox" name="redeem" value="1" data-act="redeem"><span><b>Use ${REDEEM} points for free delivery</b><br><span class="muted small">You have ${p.balance} points.</span></span></label>` : ''}</div>
      <p class="notice bad" id="cerr" hidden></p></form>
      <div class="card stack"><h3>Your order</h3>${c.lines.map(l => `<div class="row between small"><span>${l.qty} × ${esc(l.name)}</span><span>${naira(l.price * l.qty)}</span></div>`).join('')}${summary(c)}
      <button class="btn yellow block" type="submit" form="checkoutForm" id="placeBtn">Place order · ${naira(c.total)}</button></div></div>`;
  }


  const mapBox = (id, lat, lng, extra = '') => `<div class="map" id="${id}" data-map="pick"${lat != null ? ` data-lat="${lat}" data-lng="${lng}"` : ''} role="application" aria-label="Map. Tap to drop a pin."></div>
    <input type="hidden" name="lat" value="${lat ?? ''}"><input type="hidden" name="lng" value="${lng ?? ''}">
    <div class="row wrap" style="margin-top:10px"><button class="btn ghost sm" type="button" data-act="locate" data-target="${id}">${I.target}Use my current location</button><button class="btn ghost sm" type="button" data-act="findmap" data-target="${id}">${I.search}Find address on map</button></div>
    <p class="pinmsg small muted" style="margin-top:8px">${lat != null ? 'Pin placed. Drag it to fine-tune.' : 'Tap the map to drop a pin on your door or gate.'}</p>${extra}`;

  /* ---------- views: customer ---------- */
  function tracker(o) {
    if (o.status === 'rejected' || o.status === 'cancelled') return `<p class="notice bad">This order was ${o.status}.</p>`;
    const cur = { placed: 0, preparing: 1, ready: 1, on_the_way: 2, delivered: 3 }[o.status];
    const steps = [['Placed', I.check], ['Cooking', I.flame], ['On the way', I.bike], ['Delivered', I.shield]];
    return `<ol class="track">${steps.map((s, i) => `<li class="tstep ${o.status === 'delivered' || i < cur ? 'done' : i === cur ? 'now' : ''}"><span class="dot">${s[1]}</span>${s[0]}</li>`).join('')}</ol>${o.status === 'ready' ? '<p class="muted small" style="text-align:center;margin-top:12px">Ready. Waiting for a rider to pick it up.</p>' : ''}`;
  }
  const orderTitle = o => o.items[0].name + (o.items.length > 1 ? ` + ${o.items.length - 1} more` : '');
  function viewDashboard() {
    const db = getDB(), u = me(), p = points(u);
    const mine = db.orders.filter(o => o.customerId === u.id).sort((a, b) => b.createdAt - a.createdAt);
    const act = mine.find(o => ACTIVE.includes(o.status)), last = mine.find(o => o.status === 'delivered');
    const favs = (u.favs || []).map(id => db.menu.find(m => m.id === id)).filter(Boolean);
    const h = new Date().getHours(), hi = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening', toNext = Math.max(0, REDEEM - p.balance);
    const stat = (icon, n, label) => `<div class="stat"><span class="ic">${icon}</span><div><b>${n}</b><span>${label}</span></div></div>`;
    return `<div class="ph"><div><h1>Good ${hi}, ${esc(first(u.name))}.</h1><p class="muted">${new Date().toLocaleDateString('en-NG', { weekday: 'long', month: 'long', day: 'numeric' })}</p></div><a class="btn yellow" href="#/menu">Order something new</a></div>
      <div class="stats">${stat(I.medal, p.balance.toLocaleString('en-NG'), 'Reward points')}${stat(I.bag, mine.filter(o => ACTIVE.includes(o.status)).length, 'Active orders')}${stat(I.bike, mine.length, 'Total orders')}${stat(I.heart, favs.length, 'Favorite dishes')}</div>
      <div class="card">${act ? `<div class="row" style="margin-bottom:8px">${thumb(itemImg(act), act.items[0].name, act.id, 'lg')}<div class="grow"><h3>Order #${oid(act)} · ${esc(orderTitle(act))}</h3><p class="muted small">Placed at ${clock(act.createdAt)}</p></div><span class="badge s-${act.status}">${STATUS[act.status]}</span></div>${tracker(act)}<a class="btn block" style="margin-top:20px" href="#/order/${act.id}">Track order live</a>`
        : `<div class="empty" style="padding:20px">${I.bag}<h3>No active orders</h3><p>When you order, you can follow it here.</p><a class="btn yellow" href="#/menu">Browse the menu</a></div>`}</div>
      ${last ? `<div class="card again">${thumb(itemImg(last), last.items[0].name, last.id, 'lg')}<div class="grow"><h3>Order again</h3><p class="muted small">${esc(orderTitle(last))} · ${naira(last.total)}</p></div><button class="btn yellow" data-act="reorder" data-id="${last.id}">Reorder</button></div>` : ''}
      <div class="two-col">
        <div class="card"><div class="sec-head"><h3>Recent orders</h3><a href="#/orders">View all</a></div>${mine.length ? mine.slice(0, 4).map(o => `<a class="list-row" href="#/order/${o.id}">${thumb(itemImg(o), o.items[0].name, o.id)}<div class="grow"><p class="t">${esc(orderTitle(o))}</p><p class="muted small">${ago(o.createdAt)}</p></div><span class="price">${naira(o.total)}</span></a>`).join('') : '<p class="muted">No orders yet.</p>'}</div>
        <div class="card"><div class="sec-head"><h3>Favorite dishes</h3><a href="#/favorites">See all</a></div>${favs.length ? favs.slice(0, 4).map(m => `<a class="list-row" href="#/menu">${thumb(m.img, m.name, m.id)}<div class="grow"><p class="t">${esc(m.name)}</p><p class="muted small">${naira(m.price)}</p></div></a>`).join('') : '<p class="muted">Tap the heart on a dish to save it here.</p>'}</div></div>
      <div class="banner"><div><h3>${toNext ? `You’re ${toNext} points from free delivery.` : 'You’ve unlocked free delivery.'}</h3><p>${toNext ? 'Keep ordering to unlock your next reward.' : 'Use your points at checkout on your next order.'}</p></div><a class="btn yellow" href="#/menu">Browse menu</a></div>`;
  }
  function viewOrders() {
    const db = getDB(), u = me(), list = db.orders.filter(o => o.customerId === u.id).sort((a, b) => b.createdAt - a.createdAt);
    if (!list.length) return `<div class="empty">${I.bag}<h2>No orders yet</h2><a class="btn yellow" href="#/menu">Find something to eat</a></div>`;
    return `<h1>My orders</h1><div class="card">${list.map(o => `<div class="list-row"><a class="row grow" style="text-decoration:none;gap:14px;min-width:0" href="#/order/${o.id}">${thumb(itemImg(o), o.items[0].name, o.id, 'lg')}<span class="grow" style="min-width:0"><p class="t">Order #${oid(o)}</p><p class="muted small">${o.items.map(i => i.qty + ' × ' + esc(i.name)).join(', ')}</p><p class="muted small">${ago(o.createdAt)}</p></span></a><div class="right"><span class="badge s-${o.status}">${STATUS[o.status]}</span><p class="price" style="margin:6px 0">${naira(o.total)}</p>${ACTIVE.includes(o.status) ? '' : `<button class="btn sm outline" data-act="reorder" data-id="${o.id}">Reorder</button>`}</div></div>`).join('')}</div>`;
  }
  function viewOrder(id) {
    const db = getDB(), u = me(), o = db.orders.find(x => x.id === id && x.customerId === u.id), s = db.store;
    if (!o) return `<div class="empty"><h2>Order not found</h2><a class="btn yellow" href="#/orders">My orders</a></div>`;
    const rider = o.riderId && db.users.find(x => x.id === o.riderId);
    return `<div class="row between wrap"><div><p class="muted small">Order #${oid(o)} · ${ago(o.createdAt)}</p><h1>${esc(orderTitle(o))}</h1></div><span class="badge s-${o.status}">${STATUS[o.status]}</span></div>
      <div class="card stack">${ACTIVE.includes(o.status) ? `<p><span class="eta">${I.bike}Arriving around ${clock(o.createdAt + (s.eta + 10) * 60000)}</span></p>` : ''}${tracker(o)}
        ${o.status === 'on_the_way' && rider ? `<p><b>${esc(rider.name)}</b> is bringing your order.${rider.phone ? ` Call ${esc(rider.phone)}.` : ''}</p>` : ''}
        ${o.status === 'placed' ? `<p class="muted small">Waiting for the kitchen to accept your order.</p>` : ''}</div>
      ${o.status === 'on_the_way' || (ACTIVE.includes(o.status) && o.destLat != null) ? `<div class="card flat"><div class="map" id="map-${o.id}" data-map="track" data-order="${o.id}" role="img" aria-label="Map showing the kitchen, your delivery pin and the rider"></div>
        <div class="mapinfo"><span class="mi">${I.pin}</span><p id="trackInfo-${o.id}" class="grow">${esc(trackText(o))}</p></div>
        <div class="legend"><span><i class="lg store"></i>Kitchen</span><span><i class="lg pin"></i>Your pin</span><span><i class="lg rider"></i>Rider</span></div></div>` : ''}
      <div class="split"><div class="card stack"><h3>Items</h3>${o.items.map(i => `<div class="row between"><span class="row">${thumb(i.img, i.name, i.id)}<span>${i.qty} × ${esc(i.name)}</span></span><span>${naira(i.price * i.qty)}</span></div>`).join('')}${summary(o)}</div>
      <div class="card stack"><h3>Delivery</h3><p>${esc(o.address)}</p><p class="muted small">${esc(o.phone)}${o.note ? '<br>Note: ' + esc(o.note) : ''}</p><p class="small"><b>Payment:</b> ${o.pay === 'card' ? 'Card (paid, demo)' : 'Pay on delivery'}</p>${o.pointsUsed ? `<p class="small"><b>Points used:</b> ${o.pointsUsed}</p>` : ''}
        ${o.status === 'placed' ? `<button class="btn danger sm" data-act="cancel-order" data-id="${o.id}">Cancel order</button>` : ''}${ACTIVE.includes(o.status) ? '' : `<button class="btn yellow sm" data-act="reorder" data-id="${o.id}">Order this again</button>`}</div></div>
      ${o.status === 'delivered' ? `<div class="card stack"><h3>${o.rating ? 'Thanks for rating!' : 'How was your meal?'}</h3><div class="stars" role="group" aria-label="Rate this order">${[1, 2, 3, 4, 5].map(n => `<button class="${o.rating >= n ? 'on' : ''}" data-act="rate" data-id="${o.id}" data-v="${n}" aria-label="${n} star${n > 1 ? 's' : ''}" ${o.rating ? 'disabled' : ''}>★</button>`).join('')}</div></div>` : ''}`;
  }
  function viewFavorites() {
    const db = getDB(), u = me(), favs = (u.favs || []).map(id => db.menu.find(m => m.id === id)).filter(Boolean);
    if (!favs.length) return `<div class="empty">${I.heart}<h2>No favorites yet</h2><p>Tap the heart on any dish to save it here.</p><a class="btn yellow" href="#/menu">Browse the menu</a></div>`;
    return `<h1>Favorites</h1><div class="dishes">${favs.map(dishCard).join('')}</div>`;
  }
  function viewRewards() {
    const u = me(), p = points(u), pct = Math.min(100, Math.round((p.balance / REDEEM) * 100));
    return `<h1>Rewards</h1><div class="card stack"><div class="row between wrap"><div><p class="muted small">Points balance</p><h2 style="font-size:40px">${p.balance}</h2></div><span class="tier">${I.medal}${p.tier} tier</span></div>
      <div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${REDEEM}" aria-valuenow="${Math.min(p.balance, REDEEM)}"><i style="width:${pct}%"></i></div><p class="muted small" style="margin-top:8px">${p.balance >= REDEEM ? 'You can use your points for free delivery at checkout.' : `${REDEEM - p.balance} more points for free delivery.`}</p></div></div>
      <div class="card stack"><h3>Offers for you</h3><div class="offers">${Object.entries(PROMOS).map(([k, v]) => `<div class="offer"><code>${k}</code><b>${esc(v.label)}</b><p class="muted small">${v.test(u, 5000) ? 'Enter this code at checkout.' : 'Not available on your account right now.'}</p></div>`).join('')}</div></div>
      <div class="card stack"><h3>How it works</h3><p>You earn 1 point for every ₦100 on delivered orders. ${REDEEM} points gives you free delivery on one order, applied at checkout. Tiers are based on all points you have earned: Silver from 500, Gold from 1,000.</p></div>`;
  }
  /* ---------- views: profile hub ---------- */
  const mrow = (href, icon, title, sub, badge) => `<a class="mrow" href="#${href}"><span class="mi">${icon}</span><span class="grow"><b>${title}</b>${sub ? `<span class="sub">${sub}</span>` : ''}</span>${badge != null ? `<span class="pill-n">${badge}</span>` : ''}<span class="chev">${I.chev}</span></a>`;
  const back = (title, sub) => `<a class="back" href="#/account"><span class="chev flip">${I.chev}</span>Profile</a><h1 style="margin:6px 0 ${sub ? '4px' : '16px'}">${title}</h1>${sub ? `<p class="muted" style="margin-bottom:16px">${sub}</p>` : ''}`;
  function viewAccount(sub) {
    if (sub === 'details') return viewDetails();
    if (sub === 'addresses') return viewAddresses();
    if (sub === 'payments') return viewPayments();
    if (sub === 'help') return viewHelp();
    if (sub === 'legal') return viewLegal();
    const db = getDB(), u = me(), p = points(u), mine = db.orders.filter(o => o.customerId === u.id).sort((a, b) => b.createdAt - a.createdAt);
    const act = mine.find(o => ACTIVE.includes(o.status)), toNext = Math.max(0, REDEEM - p.balance);
    return `<div class="prof">
      <div class="prof-top"><span class="avatar" aria-hidden="true">${esc((u.name || '?')[0].toUpperCase())}</span><h1>${esc(u.name)}</h1><p class="muted">${esc(u.email)}</p>
        <div class="chips"><span class="chip">${I.medal}${p.balance} points</span><span class="chip dark">${I.flame}${p.tier} tier</span></div>
        ${act ? `<a class="statepill" href="#/order/${act.id}"><span>Order #${oid(act)} · ${STATUS[act.status]}</span><b>Track</b></a>` : `<a class="statepill" href="#/rewards"><span>${toNext ? `${toNext} points to free delivery` : 'Free delivery unlocked'}</span><b>Rewards</b></a>`}</div>
      <h2 class="band">Personal</h2>
      <div class="mlist">${mrow('/account/details', I.user, 'Profile details')}${mrow('/account/addresses', I.pin, 'Addresses', '', (u.addresses || []).length)}${mrow('/rewards', I.gift, 'Free delivery with points', `You have ${p.balance} points. ${REDEEM} unlocks free delivery.`)}${mrow('/account/payments', I.card, 'Payment methods')}${mrow('/orders', I.receipt, 'Order history')}</div>
      <h2 class="band">Food</h2>
      <div class="mlist">${mrow('/favorites', I.heart, 'Favorites', '', (u.favs || []).length)}${mrow('/rewards', I.medal, 'Offers and vouchers')}${mrow('/menu', I.menu, 'Menu')}</div>
      <h2 class="band">More</h2>
      <div class="mlist">${mrow('/account/help', I.help, 'Help and FAQs')}${mrow('/account/legal', I.doc, 'Privacy and terms')}</div>
      <p class="ver">Himaayah Foods v${VERSION}</p>
      <div class="row wrap" style="justify-content:center;margin-bottom:12px"><button class="btn ghost" data-act="logout">${I.out}Log out</button>${R ? '' : '<button class="btn ghost" data-act="reset-demo">Reset demo data</button>'}</div></div>`;
  }
  function viewDetails() {
    const u = me();
    return `<div class="prof">${back('Profile details')}<form class="card stack" data-form="profile" novalidate>
      <div class="field"><label for="pn">Full name</label><input class="input" id="pn" name="name" value="${esc(u.name)}" autocomplete="name" required></div>
      <div class="field"><label for="ap">Phone</label><input class="input" id="ap" name="phone" type="tel" value="${esc(u.phone || '')}" autocomplete="tel"></div>
      <div class="field"><label for="pe">Email</label><input class="input" id="pe" value="${esc(u.email)}" disabled><p class="muted small">Your email is your sign-in and cannot be changed here.</p></div>
      <p class="notice bad" id="perr" hidden></p><div class="row"><button class="btn yellow" type="submit">Save changes</button></div></form></div>`;
  }
  function viewAddresses() {
    const u = me(), addrs = u.addresses || [], ed = ui.editAddr && addrs.find(x => x.id === ui.editAddr), cur = ed || {};
    return `<div class="prof">${back('Addresses', 'Pin each address on the map so riders can find you.')}
      <div class="card">${addrs.length ? addrs.map(x => `<div class="addr"><span style="color:var(--amber)">${I.pin}</span><div class="grow"><p><b>${esc(x.label)}</b>${x.def ? ' <span class="badge s-delivered">Default</span>' : ''}</p><p class="muted small">${esc(x.text)}</p><p class="small ${x.lat != null ? 'okc' : 'muted'}">${x.lat != null ? 'Pinned on map' : 'No map pin yet'}</p></div><div class="row wrap" style="justify-content:flex-end"><button class="btn ghost sm" data-act="addr-edit" data-id="${x.id}">${x.lat != null ? 'Edit' : 'Add pin'}</button>${x.def ? '' : `<button class="btn ghost sm" data-act="addr-default" data-id="${x.id}">Make default</button>`}<button class="btn ghost sm" data-act="addr-del" data-id="${x.id}" aria-label="Remove ${esc(x.label)}">Remove</button></div></div>`).join('') : '<p class="muted">No saved addresses yet.</p>'}</div>
      <form class="card stack" data-form="add-address" novalidate><h3>${ed ? 'Edit address' : 'Add an address'}</h3><input type="hidden" name="id" value="${esc(ed ? ed.id : '')}">
        <div class="two"><div class="field"><label for="al">Label</label><input class="input" id="al" name="label" placeholder="Home, Work…" required value="${esc(cur.label || '')}"></div>
        <div class="field"><label for="at">Address</label><input class="input" id="at" name="text" data-addrtext placeholder="House number, street, landmark" required value="${esc(cur.text || '')}"></div></div>
        ${mapBox('map-addr', cur.lat != null ? cur.lat : null, cur.lng != null ? cur.lng : null)}
        <div class="row wrap"><button class="btn yellow" type="submit">${ed ? 'Save changes' : 'Save address'}</button>${ed ? '<button class="btn ghost" type="button" data-act="addr-cancel">Cancel</button>' : ''}</div></form></div>`;
  }
  function viewPayments() {
    const u = me(), cards = u.cards || [];
    return `<div class="prof">${back('Payment methods')}<div class="card">${cards.length ? cards.map(k => `<div class="addr"><span style="color:var(--amber)">${I.card}</span><div class="grow"><p><b>${esc(k.brand)} ending ${esc(k.last4)}</b></p><p class="muted small">Demo card</p></div><button class="btn ghost sm" data-act="card-del" data-id="${k.id}" aria-label="Remove ${esc(k.brand)} ${esc(k.last4)}">Remove</button></div>`).join('') : '<p class="muted">No saved cards. Pay on delivery is always available.</p>'}</div>
      <form class="card stack" data-form="add-card" novalidate><h3>Add a card</h3><div class="two"><div class="field"><label for="kb">Card type</label><select class="input" id="kb" name="brand"><option>Visa</option><option>Mastercard</option><option>Verve</option></select></div><div class="field"><label for="k4">Last 4 digits</label><input class="input" id="k4" name="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required></div></div><p class="muted small">We only keep the card type and last 4 digits for this demo. Never enter a full card number.</p><div class="row"><button class="btn yellow" type="submit">Save card</button></div></form></div>`;
  }
  function viewHelp() {
    const e = getDB().store.eta;
    return `<div class="prof">${back('Help and FAQs')}<div class="card faq" style="padding:6px 20px">
      <details><summary>Where do you deliver?</summary><p>We deliver within ${CITY}. Pin your location at checkout so the rider can find you.</p></details>
      <details><summary>How long does an order take?</summary><p>Every order is cooked after you place it, about ${e} minutes, plus the ride to you.</p></details>
      <details><summary>How do I follow my order?</summary><p>Open Orders, then pick your order. When the rider is on the way, a live map shows where they are and about how far away.</p></details>
      <details><summary>Why can’t I see the rider on the map?</summary><p>The map appears once a rider picks up your order. If you did not pin your location at checkout you will see the rider but not the distance to you.</p></details>
      <details><summary>Can I cancel an order?</summary><p>Yes, until the kitchen accepts it. Open the order and choose Cancel order.</p></details>
      <details><summary>How do I pay?</summary><p>Pay on delivery, or use a saved card. Online card payments are coming soon.</p></details>
      <details><summary>How do points work?</summary><p>You earn 1 point for every ₦100 on delivered orders. ${REDEEM} points gives you free delivery on one order.</p></details></div></div>`;
  }
  function viewLegal() {
    return `<div class="prof">${back('Privacy and terms')}<div class="card stack legal">
      <h3>What we keep</h3><p>Your name, email, phone number, saved addresses (including map pins), your orders and your favourite dishes. Saved cards keep only the card type and last 4 digits.</p>
      <h3>Location</h3><p>We only use your location when you tap “Use my current location” or place a pin. Riders share their live location only while they are delivering an order, and only the customer of that order and our kitchen can see it.</p>
      <h3>Orders</h3><p>The kitchen cooks after you order. Prices and delivery fees are worked out by our system at the time you order. You can cancel until the kitchen accepts.</p>
      <h3>Payment</h3><p>Pay on delivery is always available. Card payments in this version are for testing only.</p></div></div>`;
  }

  /* ---------- views: kitchen ---------- */
  function orderCard(o, db, actions) {
    const cu = db.users.find(x => x.id === o.customerId);
    return `<div class="ocard"><div class="row between"><b>#${oid(o)}</b><span class="small muted">${ago(o.createdAt)}</span></div>
      <ul>${o.items.map(i => `<li>${i.qty} × ${esc(i.name)}</li>`).join('')}</ul>
      ${o.note ? `<p class="small"><b>Note:</b> ${esc(o.note)}</p>` : ''}
      <p class="small muted">${esc(cu?.name || 'Customer')} · ${naira(o.total)} · ${o.pay === 'card' ? 'Paid by card' : 'Pay on delivery'}</p>${actions ? `<div class="row wrap">${actions}</div>` : ''}</div>`;
  }
  function viewKitchenOrders() {
    const db = getDB(), s = db.store, os = db.orders.slice().sort((a, b) => b.createdAt - a.createdAt);
    const by = st => os.filter(o => o.status === st);
    const col = (title, list, fn) => `<div class="col"><h3>${title} <span class="count">${list.length}</span></h3>${list.length ? list.map(fn).join('') : '<p class="muted small">Nothing here.</p>'}</div>`;
    const recent = os.filter(o => ['on_the_way', 'delivered', 'rejected', 'cancelled'].includes(o.status)).slice(0, 8);
    return `<div class="ph"><div><h1>Kitchen orders</h1><p class="muted">New orders appear here live.</p></div>
      <label class="switch"><input type="checkbox" data-act="toggle-open" ${s.open ? 'checked' : ''}><span>${s.open ? 'Open for orders' : 'Closed'}</span></label></div>
      <div class="board">${col('New orders', by('placed'), o => orderCard(o, db, `<button class="btn yellow sm" data-act="r-accept" data-id="${o.id}">Accept</button><button class="btn ghost sm" data-act="r-reject" data-id="${o.id}">Reject</button>`))}
      ${col('Cooking', by('preparing'), o => orderCard(o, db, `<button class="btn yellow sm" data-act="r-ready" data-id="${o.id}">Mark ready</button>`))}
      ${col('Ready for pickup', by('ready'), o => orderCard(o, db, ''))}</div>
      <div class="card"><h3 style="margin-bottom:8px">Recent</h3>${recent.length ? `<div class="scroll"><table class="table"><thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>${recent.map(o => `<tr><td>#${oid(o)}</td><td>${o.items.map(i => i.qty + '× ' + esc(i.name)).join(', ')}</td><td>${naira(o.total)}</td><td><span class="badge s-${o.status}">${STATUS[o.status]}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No completed orders yet.</p>'}</div>`;
  }
  function viewKitchenMenu() {
    const db = getDB(), items = db.menu, cats = [...new Set(items.map(m => m.cat))];
    return `<h1>Menu manager</h1><div class="split"><div class="card">${items.length ? items.map(m => `<div class="item${m.available ? '' : ' off'}">${thumb(m.img, m.name, m.id)}<div class="grow"><h3 style="font-size:15.5px">${esc(m.name)}</h3><p class="muted small">${esc(m.cat)} · ${esc(m.desc)}</p><p class="price">${naira(m.price)}</p></div>
      <div class="row wrap mi-actions"><label class="switch"><input type="checkbox" data-act="m-toggle" data-id="${m.id}" ${m.available ? 'checked' : ''} aria-label="Available: ${esc(m.name)}"><span class="small">${m.available ? 'Available' : 'Sold out'}</span></label>
      <button class="btn ghost sm" data-act="m-price" data-id="${m.id}">Price</button><label class="btn ghost sm filebtn">${m.img ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" hidden data-act="m-photo" data-id="${m.id}" aria-label="Photo for ${esc(m.name)}"></label><button class="btn ghost sm" data-act="m-delete" data-id="${m.id}">Delete</button></div></div>`).join('') : '<p class="muted">No items yet. Add your first dish.</p>'}</div>
      <form class="card stack" data-form="add-item" novalidate><h3>Add a dish</h3>
        <div class="field"><label for="mn">Name</label><input class="input" id="mn" name="name" required></div>
        <div class="field"><label for="md">Description</label><input class="input" id="md" name="desc"></div>
        <div class="two"><div class="field"><label for="mp">Price (₦)</label><input class="input" id="mp" name="price" type="number" min="0" step="50" required></div>
        <div class="field"><label for="mc">Category</label><input class="input" id="mc" name="cat" list="catlist" value="${esc(cats[0] || 'Rice')}"><datalist id="catlist">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div></div>
        <div class="field"><label for="mph">Photo (optional)</label><input class="input" id="mph" name="photo" type="file" accept="image/*"></div>
        <p class="notice bad" id="merr" hidden></p>
        <button class="btn yellow" type="submit">Add to menu</button></form></div>`;
  }
  function viewKitchenSettings() {
    const s = getDB().store;
    return `<h1>Settings</h1><form class="card stack" style="max-width:560px" data-form="store-settings" novalidate>
      <div class="field"><label for="sd">Delivery fee (₦)</label><input class="input" id="sd" name="fee" type="number" min="0" step="50" value="${s.fee}"></div>
      <div class="field"><label for="se">Cooking time (minutes)</label><input class="input" id="se" name="eta" type="number" min="5" step="5" value="${s.eta}"></div>
      <div><h3>Kitchen location</h3><p class="muted small" style="margin-bottom:10px">Riders and customers see this on the map. Drop the pin on your kitchen door.</p>${mapBox('map-store', Number(s.lat) || TOWN.lat, Number(s.lng) || TOWN.lng)}</div>
      <button class="btn yellow" type="submit">Save changes</button></form>`;
  }

  /* ---------- views: rider + admin ---------- */
  function viewRider() {
    const u = me(), db = getDB(), s = db.store;
    const avail = db.orders.filter(o => o.status === 'ready' && !o.riderId), mine = db.orders.filter(o => o.riderId === u.id && o.status === 'on_the_way');
    const done = db.orders.filter(o => o.riderId === u.id && o.status === 'delivered'), earned = done.reduce((a, o) => a + (o.fee || 0), 0);
    const card = (o, btn) => { const cu = db.users.find(x => x.id === o.customerId);
      return `<div class="ocard"><div class="row between"><b>#${oid(o)}</b><span class="small muted">${o.fee ? naira(o.fee) + ' fee' : 'Free delivery'}</span></div><p class="small"><b>Pick up:</b> ${esc(s.name)}, ${esc(s.address)}</p><p class="small"><b>Deliver to:</b> ${esc(o.address)}<br>${esc(cu?.name || '')} · ${esc(o.phone)}</p><p class="small muted">${o.pay === 'card' ? 'Already paid by card' : 'Collect ' + naira(o.total) + ' on delivery'}</p>${o.destLat != null ? '<p class="small"><b>Map pin:</b> customer pinned the spot.</p>' : ''}${nav_(o)}${btn}</div>`; };
    const nav_ = o => o.status !== 'on_the_way' ? '' : `${hasMap() ? `<div class="map sm" id="map-${o.id}" data-map="track" data-order="${o.id}" role="img" aria-label="Map of this delivery"></div>` : ''}<p class="row wrap" style="margin:8px 0"><a class="btn ghost sm" target="_blank" rel="noopener" href="${o.destLat != null ? 'https://www.google.com/maps/dir/?api=1&destination=' + o.destLat + ',' + o.destLng : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address + ', ' + CITY)}">${I.pin}Open in Google Maps</a></p>`;
    return `<div class="ph"><div><h1>Deliveries</h1><p class="muted">Hi ${esc(first(u.name))}</p></div>
      <label class="switch"><input type="checkbox" data-act="rider-online" ${u.online ? 'checked' : ''}><span>${u.online ? 'Online' : 'Offline'}</span></label></div>
      <div class="sstats"><div class="sstat"><span class="muted small">Delivered</span><b>${done.length}</b></div><div class="sstat"><span class="muted small">Delivery fees earned</span><b>${naira(earned)}</b></div></div>
      ${mine.length ? `<div class="card sharebar"><span class="mi">${I.target}</span><p id="shareState" class="grow small"></p>${R ? '' : `<button class="btn ghost sm" data-act="sim">${share.sim ? 'Stop demo ride' : 'Demo ride'}</button>`}</div>` : ''}
      <div class="board">
        <div class="col"><h3>Ready for pickup <span class="count">${u.online ? avail.length : 0}</span></h3>${!u.online ? '<p class="muted small">Go online to see available orders.</p>' : avail.length ? avail.map(o => card(o, `<button class="btn yellow sm" data-act="rd-pick" data-id="${o.id}">Pick up order</button>`)).join('') : '<p class="muted small">No orders waiting. New ones appear here live.</p>'}</div>
        <div class="col"><h3>On the way <span class="count">${mine.length}</span></h3>${mine.length ? mine.map(o => card(o, `<button class="btn yellow sm" data-act="rd-deliver" data-id="${o.id}">Mark delivered</button>`)).join('') : '<p class="muted small">No active deliveries.</p>'}</div></div>`;
  }
  function viewAdmin() {
    const db = getDB(), delivered = db.orders.filter(o => o.status === 'delivered'), active = db.orders.filter(o => ACTIVE.includes(o.status));
    const gmv = delivered.reduce((a, o) => a + o.total, 0), cnt = r => db.users.filter(u => u.role === r).length;
    const latest = db.orders.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 15);
    const s = (l, v) => `<div class="sstat"><span class="muted small">${l}</span><b>${v}</b></div>`;
    return `<h1>Owner dashboard</h1><div class="sstats">${s('Orders', db.orders.length)}${s('In progress', active.length)}${s('Delivered value', naira(gmv))}${s('Customers', cnt('customer'))}${s('Riders', cnt('rider'))}${s('Rating', '★ ' + rating().toFixed(1))}</div>
      <div class="card"><h3 style="margin-bottom:8px">Latest orders</h3>${latest.length ? `<div class="scroll"><table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>When</th></tr></thead><tbody>${latest.map(o => `<tr><td>#${oid(o)}</td><td>${esc(db.users.find(u => u.id === o.customerId)?.name)}</td><td>${naira(o.total)}</td><td><span class="badge s-${o.status}">${STATUS[o.status]}</span></td><td>${ago(o.createdAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No orders yet.</p>'}</div>
      <div class="card"><h3 style="margin-bottom:8px">People</h3><div class="scroll"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${db.users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  /* ---------- router ---------- */
  function route() {
    const path = '/' + (location.hash.replace(/^#\/?/, '').split('?')[0]);
    const parts = path.split('/').filter(Boolean), u = me();
    const guard = role => !u ? (sessionStorage.setItem('hf_next', path), go('/login'), true) : (u.role !== role ? (go(homeFor(u)), true) : false);
    const A = body => app(path, body);
    switch (parts[0]) {
      case undefined: if (u && u.role !== 'customer') { go(homeFor(u)); return null; } return u ? A(viewDashboard()) : site('/', viewLanding());
      case 'menu': if (u && u.role !== 'customer') { go(homeFor(u)); return null; } return A(viewMenu());
      case 'cart': if (u && u.role !== 'customer') { go(homeFor(u)); return null; } return A(viewCart());
      case 'checkout': if (guard('customer')) return null; return A(viewCheckout());
      case 'orders': if (guard('customer')) return null; return A(viewOrders());
      case 'order': if (guard('customer')) return null; return A(viewOrder(parts[1]));
      case 'favorites': if (guard('customer')) return null; return A(viewFavorites());
      case 'rewards': if (guard('customer')) return null; return A(viewRewards());
      case 'account': if (guard('customer')) return null; return A(viewAccount(parts[1]));
      case 'login': return site(path, viewLogin());
      case 'register': return site(path, viewRegister());
      case 'kitchen': if (guard('kitchen')) return null; return A(parts[1] === 'menu' ? viewKitchenMenu() : parts[1] === 'settings' ? viewKitchenSettings() : viewKitchenOrders());
      case 'rider': if (guard('rider')) return null; return A(viewRider());
      case 'admin': if (guard('admin')) return null; return A(viewAdmin());
      default: return site(path, `<div class="container empty"><h2>Page not found</h2><a class="btn yellow" href="#/">Go home</a></div>`);
    }
  }
  function render(keepScroll) {
    const html = route();
    if (html === null) return;
    const y = window.scrollY, active = document.activeElement && document.activeElement.id;
    killMaps();
    $('#app').innerHTML = html;
    mountMaps(); syncSharing();
    if (keepScroll) window.scrollTo(0, y);
    if (active && $('#' + active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes($('#' + active).tagName)) $('#' + active).focus();
  }

  /* ---------- actions ---------- */
  const setStatus = (d, id, status, extra = {}) => { const o = d.orders.find(x => x.id === id); if (!o) return; o.status = status; Object.assign(o, extra); o.history.push({ s: status, t: Date.now() }); };
  function addToCart(id) {
    const m = getDB().menu.find(x => x.id === id); if (!m) return;
    const c = getCart(); c.items[id] = (c.items[id] || 0) + 1; setCart(c); render(true);
  }
  function decFromCart(id) {
    const c = getCart(); if (!c.items[id]) return;
    c.items[id]--; if (c.items[id] <= 0) delete c.items[id];
    setCart(c); render(true);
  }
  function afterLogin(u) {
    if (R) remoteUid = u.id; else sessionStorage.setItem(SKEY, u.id);
    const next = sessionStorage.getItem('hf_next'); sessionStorage.removeItem('hf_next');
    go(next && u.role === 'customer' ? next : homeFor(u));
    render();
  }
  const showErr = (id, msg) => { const e = $('#' + id); if (e) { e.textContent = msg; e.hidden = false; } };

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act, id = t.dataset.id;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    switch (act) {
      case 'scroll': { const el = document.getElementById(t.dataset.v); if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); } break; }
      case 'cat': ui.cat = t.dataset.v; render(true); break;
      case 'toggle': ui[t.dataset.v] = !ui[t.dataset.v]; render(true); break;
      case 'add': addToCart(id); break;
      case 'dec': decFromCart(id); break;
      case 'rm': { const c = getCart(); delete c.items[id]; setCart(c); render(true); break; }
      case 'promo': ui.promo = ($('#promoIn').value || '').trim().toUpperCase(); refreshSum(); break;
      case 'reorder': {
        const db = getDB(), o = db.orders.find(x => x.id === id); if (!o) break;
        if (!db.store.open) { toast('We’re closed right now.'); break; }
        const c = { items: {} }; let miss = 0;
        o.items.forEach(i => { const m = db.menu.find(x => x.id === i.id); if (m && m.available) c.items[m.id] = i.qty; else miss++; });
        if (!Object.keys(c.items).length) { toast('Those dishes are no longer available.'); break; }
        setCart(c); go('/cart'); if (miss) toast('Some items are unavailable and were left out.'); break;
      }
      case 'locate': locateInto(t.dataset.target, t); break;
      case 'findmap': findOnMap(t.dataset.target, t); break;
      case 'addr-edit': ui.editAddr = id; render(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); break;
      case 'addr-cancel': ui.editAddr = ''; render(); break;
      case 'sim': toggleSim(); break;
      case 'addr-default': mutate(d => { const u = d.users.find(x => x.id === session()); u.addresses.forEach(x => { x.def = x.id === id; }); u.address = u.addresses.find(x => x.def).text; }); break;
      case 'addr-del': if (ui.editAddr === id) ui.editAddr = ''; mutate(d => { const u = d.users.find(x => x.id === session()); u.addresses = (u.addresses || []).filter(x => x.id !== id); if (u.addresses.length && !u.addresses.some(x => x.def)) u.addresses[0].def = true; }); break;
      case 'card-del': mutate(d => { const u = d.users.find(x => x.id === session()); u.cards = (u.cards || []).filter(x => x.id !== id); }); break;
      case 'fav': {
        if (!me()) { sessionStorage.setItem('hf_next', '/menu'); go('/login'); break; }
        mutate(d => { const u = d.users.find(x => x.id === session()); u.favs = u.favs || []; const i = u.favs.indexOf(id); if (i >= 0) u.favs.splice(i, 1); else u.favs.push(id); });
        break;
      }
      case 'clear-cart': setCart({ items: {} }); render(true); break;
      case 'quick': { const u = getDB().users.find(x => x.email === t.dataset.email); if (u) afterLogin(u); break; }
      case 'logout': if (R) { R.signOut().finally(() => { remoteUid = null; remoteDB = { ...remoteDB, users: [], orders: [] }; go('/'); render(); }); break; } sessionStorage.removeItem(SKEY); go('/'); render(); break;
      case 'reset-demo': if (!R && confirm('Reset all demo data in this browser?')) { localStorage.removeItem(KEY); localStorage.removeItem(CKEY); sessionStorage.removeItem(SKEY); cacheRaw = null; go('/'); render(); toast('Demo data reset.'); } break;
      case 'cancel-order': mutate(d => { const o = d.orders.find(x => x.id === id); if (o && o.status === 'placed') setStatus(d, id, 'cancelled'); }); break;
      case 'rate': mutate(d => { const o = d.orders.find(x => x.id === id); if (!o || o.rating) return; o.rating = Number(t.dataset.v); d.store.ratingSum += o.rating; d.store.ratingCount += 1; }); toast('Thanks for your rating!'); break;
      case 'r-accept': mutate(d => setStatus(d, id, 'preparing')); break;
      case 'r-reject': if (confirm('Reject this order?')) mutate(d => setStatus(d, id, 'rejected')); break;
      case 'r-ready': mutate(d => setStatus(d, id, 'ready')); break;
      case 'm-delete': if (confirm('Delete this dish?')) mutate(d => { d.menu = d.menu.filter(m => m.id !== id); }); break;
      case 'm-price': { const m = getDB().menu.find(x => x.id === id); const v = prompt('New price in naira for ' + m.name, m.price); if (v !== null && v.trim() !== '' && Number(v) >= 0) mutate(d => { d.menu.find(x => x.id === id).price = Number(v); }); break; }
      case 'rd-pick': mutate(d => { const o = d.orders.find(x => x.id === id); if (o && o.status === 'ready' && !o.riderId) setStatus(d, id, 'on_the_way', { riderId: session() }); }); break;
      case 'rd-deliver': mutate(d => setStatus(d, id, 'delivered')); toast('Delivery completed.'); break;
    }
  });
  document.addEventListener('change', e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act, id = t.dataset.id;
    if (act === 'sort') { ui.sort = t.value; render(true); }
    if (act === 'toggle-open') mutate(d => { d.store.open = t.checked; });
    if (act === 'm-photo') {
      const file = t.files && t.files[0]; if (!file) return; toast('Uploading photo…');
      savePhoto(file).then(url => { mutate(d => { d.menu.find(x => x.id === id).img = url; }); toast('Photo saved.'); }).catch(err => toast(err.message || 'Upload failed.'));
    }
    if (act === 'm-toggle') mutate(d => { d.menu.find(x => x.id === id).available = t.checked; });
    if (act === 'rider-online') mutate(d => { d.users.find(x => x.id === session()).online = t.checked; });
    if (act === 'redeem') refreshSum();
    if (act === 'use-addr') { const x = (me().addresses || []).find(z => z.id === t.value); if (x) { $('#ca').value = x.text; const e = maps.get('map-co'); if (e && e.set && x.lat != null) e.set(x.lat, x.lng, true, false); } }
  });
  document.addEventListener('input', e => {
    if (e.target.id !== 'q') return;
    ui.q = e.target.value;
    const g = $('#dishes'); if (g) g.innerHTML = dishGrid();
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f).entries()), kind = f.dataset.form, db = getDB();
    if (kind === 'search') { if (location.hash !== '#/menu') { go('/menu'); render(); } }
    if (kind === 'login' && R) {
      R.signIn((fd.email || '').trim(), fd.pass || '').then(async id => { remoteUid = id; remoteDB = await R.load(); afterLogin(remoteDB.users.find(x => x.id === id)); })
        .catch(() => showErr('lerr', 'That email and password don’t match. Check them and try again.'));
      return;
    }
    if (kind === 'login') {
      const u = db.users.find(x => x.email.toLowerCase() === (fd.email || '').trim().toLowerCase() && x.pass === fd.pass);
      if (!u) return showErr('lerr', 'That email and password don’t match. Check them and try again.');
      afterLogin(u);
    }
    if (kind === 'register' && R) {
      const email = (fd.email || '').trim().toLowerCase();
      if (!fd.name.trim() || !email || (fd.pass || '').length < 6) return showErr('rerr', 'Enter your name, email and a password of at least 6 characters.');
      R.signUp({ name: fd.name.trim(), email, pass: fd.pass, phone: fd.phone || '', role: fd.role === 'rider' ? 'rider' : 'customer' }).then(async id => {
        if (!id) return showErr('rerr', 'Check your email to confirm your account, then sign in.');
        remoteUid = id; remoteDB = await R.load(); afterLogin(remoteDB.users.find(x => x.id === id));
      }).catch(err => showErr('rerr', err.message));
      return;
    }
    if (kind === 'register') {
      const email = (fd.email || '').trim().toLowerCase();
      if (!fd.name.trim() || !email || (fd.pass || '').length < 6) return showErr('rerr', 'Enter your name, email and a password of at least 6 characters.');
      if (db.users.some(x => x.email.toLowerCase() === email)) return showErr('rerr', 'An account with that email already exists. Try signing in.');
      const user = { id: uid('u'), role: fd.role === 'rider' ? 'rider' : 'customer', name: fd.name.trim(), email, pass: fd.pass, phone: fd.phone || '', online: false, favs: [], addresses: [], cards: [] };
      mutate(d => { d.users.push(user); });
      afterLogin(user);
    }
    if (kind === 'profile') {
      const nm = (fd.name || '').trim(); if (!nm) return showErr('perr', 'Enter your name.');
      mutate(d => { const u = d.users.find(x => x.id === session()); u.name = nm; u.phone = (fd.phone || '').trim(); }); toast('Saved.'); go('/account');
    }
    if (kind === 'add-address') {
      if (!fd.label.trim() || !fd.text.trim()) return toast('Add a label and an address.');
      const lat = fd.lat !== '' && fd.lat != null ? Number(fd.lat) : null, lng = fd.lng !== '' && fd.lng != null ? Number(fd.lng) : null, pin = lat != null && lng != null && isFinite(lat) && isFinite(lng) ? { lat, lng } : {};
      mutate(d => {
        const u = d.users.find(x => x.id === session()); u.addresses = u.addresses || [];
        const old = fd.id && u.addresses.find(x => x.id === fd.id);
        if (old) { old.label = fd.label.trim(); old.text = fd.text.trim(); delete old.lat; delete old.lng; Object.assign(old, pin); if (old.def) u.address = old.text; }
        else { const def = !u.addresses.length; u.addresses.push({ id: uid('a'), label: fd.label.trim(), text: fd.text.trim(), def, ...pin }); if (def) u.address = fd.text.trim(); }
      });
      ui.editAddr = ''; toast('Address saved.'); render();
    }
    if (kind === 'add-card') { if (!/^[0-9]{4}$/.test(fd.last4 || '')) return toast('Enter exactly 4 digits.'); mutate(d => { const u = d.users.find(x => x.id === session()); u.cards = u.cards || []; u.cards.push({ id: uid('c'), brand: fd.brand, last4: fd.last4 }); }); toast('Card saved.'); }
    if (kind === 'checkout') {
      const u = me(), redeem = fd.redeem === '1' && points(u).balance >= REDEEM, c = cartLines(redeem, ui.promo);
      if (!c.lines.length) return;
      if (!db.store.open) return showErr('cerr', 'We’ve just closed. Try again later.');
      if (!fd.phone.trim() || !fd.address.trim()) return showErr('cerr', 'Add a phone number and delivery address so the rider can find you.');
      const pinLat = fd.lat !== '' && fd.lat != null ? Number(fd.lat) : null, pinLng = fd.lng !== '' && fd.lng != null ? Number(fd.lng) : null, hasPin = pinLat != null && pinLng != null && isFinite(pinLat) && isFinite(pinLng);
      if (R) {
        const btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
        R.placeOrder({ items: c.lines.map(l => ({ id: l.id, qty: l.qty })), address: fd.address, phone: fd.phone, note: fd.note || '', pay: fd.pay === 'card' ? 'card' : 'cod', promo: ui.promo, usePoints: redeem, lat: hasPin ? pinLat : null, lng: hasPin ? pinLng : null })
          .then(async id => { setCart({ items: {} }); ui.promo = ''; remoteDB = await R.load(); lastStatus = snapshot(); go('/order/' + id); toast('Order placed. The kitchen will confirm shortly.'); })
          .catch(err => { if (btn) btn.disabled = false; showErr('cerr', err.message); });
        return;
      }
      const order = { id: uid('o'), customerId: u.id, items: c.lines.map(l => ({ id: l.id, name: l.name, price: l.price, qty: l.qty, img: l.img || '' })), subtotal: c.subtotal, fee: c.fee, discount: c.discount, promo: c.promo, total: c.total, address: fd.address.trim(), phone: fd.phone.trim(), note: (fd.note || '').trim(), pay: fd.pay, status: 'placed', riderId: null, rating: 0, pointsUsed: redeem ? REDEEM : 0, createdAt: Date.now(), history: [{ s: 'placed', t: Date.now() }], destLat: hasPin ? pinLat : null, destLng: hasPin ? pinLng : null };
      setCart({ items: {} }); ui.promo = '';
      mutate(d => { d.orders.push(order); const cu = d.users.find(x => x.id === u.id); cu.phone = fd.phone.trim(); cu.address = fd.address.trim(); cu.addresses = cu.addresses || []; if (!cu.addresses.length) cu.addresses.push({ id: uid('a'), label: 'Home', text: fd.address.trim(), def: true, ...(hasPin ? { lat: pinLat, lng: pinLng } : {}) }); });
      go('/order/' + order.id); toast('Order placed. The kitchen will confirm shortly.');
    }
    if (kind === 'add-item') {
      if (!fd.name.trim() || fd.price === '') return;
      const add = img => mutate(d => d.menu.push({ id: uid('m'), name: fd.name.trim(), desc: (fd.desc || '').trim(), price: Number(fd.price), cat: (fd.cat || 'Rice').trim() || 'Rice', img, available: true }));
      const file = fd.photo && fd.photo.size ? fd.photo : null;
      if (!file) add('');
      else savePhoto(file).then(add).catch(err => showErr('merr', err.message || 'Upload failed.'));
    }
    if (kind === 'store-settings') { const la = Number(fd.lat), ln = Number(fd.lng), ok = fd.lat !== '' && isFinite(la) && isFinite(ln); mutate(d => { d.store.fee = Number(fd.fee) || 0; d.store.eta = Number(fd.eta) || 30; if (ok) { d.store.lat = la; d.store.lng = ln; } }); toast('Settings saved.'); }
  });

  /* ---------- live updates across tabs ---------- */
  function snapshot() { const m = {}; getDB().orders.forEach(o => { m[o.id] = o.status; }); return m; }
  function notifyDiff(prev, db, u) {
    if (!u) return;
    db.orders.forEach(o => {
      const before = prev[o.id], now = o.status;
      if (before === now) return;
      if (u.role === 'customer' && o.customerId === u.id && before) toast(`Order #${oid(o)}: ${STATUS[now].toLowerCase()}.`);
      if (u.role === 'kitchen' && !before && now === 'placed') toast('New order received.');
      if (u.role === 'rider' && u.online && now === 'ready' && !o.riderId) toast('An order is ready for pickup.');
    });
  }
  window.addEventListener('storage', e => {
    if (R) return;
    if (e.key === KEY || e.key === CKEY || e.key === null) {
      cacheRaw = null; const db = getDB(), prev = lastStatus; notifyDiff(prev, db, me()); lastStatus = snapshot();
      if (editing()) return;
      if (maps.size && JSON.stringify(prev) === JSON.stringify(lastStatus)) refreshLive(); else render(true);
    }
  });
  window.addEventListener('hashchange', () => { if (location.hash.indexOf('#/account/addresses') !== 0) ui.editAddr = ''; window.scrollTo(0, 0); render(); $('#app').focus({ preventScroll: true }); });
  setInterval(() => { if (document.hidden || editing()) return; if (maps.size) refreshLive(); else render(true); }, 60000);

  if (R) {
    // Live mode: restore the sign-in, load everything, then listen for changes from other devices.
    $('#app').innerHTML = '<div class="container" style="padding:60px 0"><p class="muted">Loading…</p></div>';
    R.init().then(async id => { remoteUid = id; remoteDB = await R.load(); }).catch(() => { toast('Can’t reach the server. Check your connection.'); })
      .finally(() => { lastStatus = snapshot(); render(); });
    R.subscribe(async () => {
      try {
        const db = await R.load(), prev = lastStatus; remoteDB = db; notifyDiff(prev, db, me()); lastStatus = snapshot();
        if (editing()) return;
        if (maps.size && JSON.stringify(prev) === JSON.stringify(lastStatus)) refreshLive(); else render(true);
      } catch (e) { /* keep showing what we have */ }
    });
  } else { getDB(); lastStatus = snapshot(); render(); }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
