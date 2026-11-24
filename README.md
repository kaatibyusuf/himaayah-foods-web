# Himaayah Foods

One eatery, one menu, one kitchen, with delivery across Ado-Ekiti. Static web app, no build step.

## Run locally (PowerShell, from this folder)

    npx serve .

Demo accounts (password `demo123`): amina@demo.com (customer), kitchen@demo.com, rider@demo.com, admin@demo.com (owner).
Open several tabs signed in as different roles to watch an order move live.

## Features

- Landing page, menu with category pills, filters and sorting, live cart panel
- Dashboard, order history with live tracking, reorder, favourites
- Saved addresses and cards (demo), rewards points, promo codes `FIRST10` and `FREEDEL`
- Kitchen: accept and cook orders, manage menu and prices, open or close the eatery, set delivery fee
- Rider and owner dashboards

## Structure

- `index.html`, `css/style.css`, `js/app.js`
- `assets/img/`: food photos (dishes without a photo show a letter tile); `assets/logo.svg` and icons
- `manifest.webmanifest`, `sw.js`: installable PWA
- `supabase/schema.sql`: older multi-restaurant starter schema, to be updated when the backend is wired

## Going live

Data is in localStorage for now. Replace `getDB` / `mutate` / sign-in in `js/app.js` with Supabase calls, and add Paystack for card payments. Use photos you own or have licences for before launch.

## Going live with Supabase

The app runs in demo mode until `js/config.js` has your keys. Then accounts, menu, orders and live updates are shared across every device.

1. Create a free project at supabase.com.
2. Open **SQL Editor > New query**, paste all of `supabase/schema.sql`, and run it. This creates the tables, security rules, order functions and the starting menu.
3. Open **Authentication > Providers > Email** and turn **Confirm email** off while testing (otherwise new users must click an email link before signing in).
4. Open **Project Settings > API**. Copy the **Project URL** and the **anon public** key into `js/config.js`. Never use the `service_role` key.
5. Sign up in the app as yourself, then in the SQL Editor make staff accounts:
   `update public.profiles set role = 'admin' where email = 'you@example.com';`
   `update public.profiles set role = 'kitchen' where email = 'kitchen@example.com';`
   Riders and customers choose their role when they register.
6. Commit and push. Vercel redeploys.

How it stays safe: browsers can only use the public key. Row level security limits who can read what, and orders are created and changed only through server functions that work out prices, fees, discounts and points themselves.

Dish photos: in the SQL Editor also run `supabase/photos.sql` once (it is already inside `schema.sql` for new projects). Then the kitchen can add or change a dish photo from Menu manager.

Not included yet: real card payments (Paystack).

## Profile and maps (v1.1)

**Profile hub.** `#/account` is now a phone-style profile: points and tier, a live "Track" pill when an order is active, and rows for Profile details, Addresses, Free delivery with points, Payment methods, Order history, Favorites, Offers, Help and FAQs, and Privacy and terms.

**Maps.** Leaflet is bundled in `assets/vendor/` and map tiles come from OpenStreetMap (free, with attribution shown on every map). OpenStreetMap's public tile server is meant for light use; if the app grows, switch the tile URL in `js/app.js` (search for `tile.openstreetmap.org`) to a paid tile provider.

- Customers drop a pin on each saved address and at checkout (tap the map, drag the pin, "Use my current location", or "Find address on map").
- The kitchen sets its own pin in Kitchen > Settings.
- When a rider picks up an order, their phone shares its location every few seconds while the page stays open. The customer's order page shows the kitchen, their pin and the rider moving, with distance and a rough arrival time (straight-line distance at about 20 km/h).
- Riders get an "Open in Google Maps" button for turn-by-turn directions.
- Demo mode has a "Demo ride" button on the rider screen that moves a pretend rider, so tracking can be tried on a laptop.

**Upgrading a project that is already live.** Open the Supabase SQL editor, paste all of `supabase/tracking.sql` and run it once. It adds the location columns and replaces `place_order`. New projects get this from `schema.sql`.

**Limits to know.** Location sharing needs HTTPS (Vercel is fine) and the rider's browser must stay open on the page, because phones pause web pages when the screen locks. Tracking is a web page, not a background app.
