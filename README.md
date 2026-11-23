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
