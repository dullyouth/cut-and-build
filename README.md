# Cut & Build — Fitness Tracker

A single-page fitness tracker for the 195→175 cut: macro/calorie logging, body-weight
trend, strength progression, the 8-week run/walk plan, and a shopping list. **Standalone
PWA — Node + on-device storage, zero npm dependencies.** Data lives in your browser
(IndexedDB); the Node piece is just a static file server so you can load it and push it
to your phone.

Design language: **"Instrument"** — a WHOOP-inspired gunmetal system with layered depth,
glowing per-metric rings (ember calories / green protein / cyan carbs / violet fat),
big SF Pro tabular numerals, and inline-SVG textures. 100% self-contained/offline.

## Run it

```bash
cd ~/work/fitness
npm start
```

- **On this Mac:** http://localhost:4173
- **On your phone (same WiFi):** the start command prints your LAN URL, e.g. `http://10.0.1.11:4173`

Change the port with `PORT=8080 npm start`. Regenerate app icons with `npm run icons`.

## Put it on your iPhone (installable, offline)

The app is a standalone PWA — no App Store, no Xcode. You want an **HTTPS** URL so the
service worker installs (iOS requires a secure context for offline caching):

1. `npm start` on your Mac.
2. Expose it over HTTPS with Tailscale (you already run it):
   `tailscale serve --bg 4173` → gives a `https://<machine>.<tailnet>.ts.net` URL.
3. On the iPhone (Tailscale installed + logged in), open that HTTPS URL in **Safari** →
   Share → **Add to Home Screen**.

It now launches fullscreen like a native app, works at the gym with no signal, and keeps
all data on the phone. The Mac only needs to be up when you want to load a fresh version.

**Fully independent of your Mac:** the app is 100% static + client-side, so you can also
drop the `public/` folder on any static host (Cloudflare Pages, Netlify) over HTTPS and
install from there — then it never depends on your Mac at all.

## What's inside

| View | What it does |
|------|--------------|
| **Dashboard** | Today's macro rings, weight trend + progress, day's session, one-tap meal logging |
| **Nutrition** | Macro bars vs targets, protein-first daily meals with **ingredients + prep steps**, one-tap logging, custom food, daily log, checkable weekly shopping list |
| **Weight** | Log weigh-ins, 7-day average, trend chart, history with deltas |
| **Training** | Phase-aware sessions (Cut = 3-day Full Body / Bulk = 4-day Upper/Lower). **Per-set logging** (weight × reps each set, ✓ to complete, add/remove sets, edit in place, "previous session" column), verified form-video links, **rest timer** (presets + auto-start after a set, beeps/vibrates at zero) |
| **Running** | 8-week run/walk progression, tap dots to log the 3 weekly runs |
| **The Plan** | **Cut / Bulk phase toggle** (flips the program, weekly schedule, and macro targets), editable targets, strength + meal-plan reference |

**Two phases, one toggle** (in *The Plan*):
- **Cut** (active) — 3-day Full Body, high frequency to build/retain muscle in a slight deficit. Targets 2,300 kcal · 220g protein.
- **Bulk** (from 175) — 4-day Upper/Lower, higher volume ceiling on a surplus. Targets 2,900 kcal · 200g protein.

Switching phases swaps the whole training block, the weekly schedule, and the macro targets in one tap.

Use the date picker (top right) to log or review any day. Theme toggle (bottom-left,
desktop) for dark/light — dark is the showpiece.

## Stack / files

- `server.js` — zero-dep static file server on `node:http`
- `public/plan.js` — the program blueprint (workouts, verified video links, run weeks, meals, shopping list)
- `public/store.js` — on-device storage (IndexedDB) behind a small REST-shaped API
- `public/app.js` — the SPA (vanilla, no framework, no build step)
- `public/styles.css` — the "Instrument" gunmetal design system
- `public/sw.js` + `manifest.webmanifest` — PWA offline shell + install metadata
- `scripts/gen-icons.mjs` — dependency-free PNG app-icon generator

## Targets (editable in-app under The Plan)

2,200 kcal · 200g protein · 175g carbs · 75g fat · 195 → 175 lb
