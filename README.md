# Lobb

**A hyperlocal, student-to-student marketplace for UW housing.** Need a Coke, a charger or a TI-84 at midnight? A neighbor in your building brings it to your door in under 10 minutes.

Students request sealed everyday items (snacks, drinks, toiletries, chargers) or **borrow** non-food items. The request goes only to verified `@uw.edu` neighbors in the same building, and the first to accept delivers it. Handoff is confirmed by scanning the buyer's QR code.

> Status: in active development. Phase 1 (real backend) is built; remote push notifications are wired up; next up are payments and TestFlight. See [ROADMAP.md](ROADMAP.md).

## Features

- **Buy · Rent · Sell** in one app. Every student is both a buyer and a seller.
- **2-tap requests** with a live status screen: a "searching" radar, then a 10-minute countdown ring, then the QR handoff.
- **Rentals** with a duration picker, a card hold for the item's value, a return-by timer and a return QR.
- **List an item by scanning its barcode.** Name, photo and category fill in automatically from the Open Food Facts databases, and duplicates are caught by barcode.
- **AI pricing.** Claude searches current retail prices and checks each item against the marketplace rules (no alcohol, meds or opened food). Sellers can adjust ±5%.
- **Trust and safety:** seal verification (barcode match + photo), a handoff photo, UW-only sign-in and ratings.
- **Push notifications** for new shout-outs (everyone in the building with alerts on) and new orders (neighbors who list the item), even when the app is closed. A Supabase Edge Function picks recipients in SQL and batches them to Expo's push API; payloads never include room numbers.
- Dark-first design system: violet for actions, lime for money, coral for urgency.

## Tech stack

| Layer | Tech |
|---|---|
| App | React Native · Expo SDK 57 · Expo Router · TypeScript (strict) · React Compiler |
| Backend | Supabase: Postgres, Auth (email OTP), Realtime, Storage, pg_cron, Edge Functions (push) |
| Server routes | Expo Router API routes (`/api/price`, `/api/barcode`) |
| AI | Claude (Anthropic API) with web search + structured outputs |
| Device | expo-camera (barcode/QR scanning), expo-image-picker, haptics |
| Testing | PGlite (Postgres in WASM) test suite for the database rules |

## How it's secured

The app is treated as untrusted, so every rule that matters lives in Postgres:

- **Row-level security on every table**, with table access granted explicitly. Neighbors in other buildings can't see your requests.
- **Prices are computed server-side.** New items can only be created from a server-issued AI price quote, so a modified app can't set its own prices.
- **First-come-first-serve accept** is a single conditional `UPDATE`, so two neighbors can never both win a request.
- **Handoff codes are readable only by the buyer.** The deliverer must scan them in person, and five wrong guesses lock the code. (The test suite caught that the original lockout was silently rolled back by an exception, and it was fixed.)
- A **listed-seller priority window**: neighbors who listed the item see requests first; everyone else after 20 seconds.
- Sign-ups are restricted to allowed email domains (`uw.edu`) by a database trigger.

`npm run test:db` runs the migrations in PGlite and plays three students through the buy, rental and listing flows, plus the abuse cases (cross-building access, double accepts, code brute-forcing, price tampering).

## Project structure

```
src/app/               screens (Expo Router) + API routes (*+api.ts)
src/store/             app state, Supabase reads/writes, realtime
src/components/        UI kit, live status components, barcode/QR scanner
src/data/              catalog photos, pricing rules (mirrored in SQL)
supabase/migrations/   schema, RLS policies, database functions
supabase/functions/    Edge Functions (push notifications)
supabase/tests/        PGlite flow + security tests
```

## Running it

```bash
npm install
cp .env.example .env      # then fill in; see SUPABASE_SETUP.md
npx expo start            # i = iOS Simulator, w = web
npm run test:db           # database rule tests (no Supabase needed)
```

**Push notifications need a development build** (or TestFlight) on a real phone. Expo Go and the Simulator can't receive remote push, so there the app falls back to local notifications, which only fire while Lobb is open or was just backgrounded:

```bash
npx eas build --profile development --platform ios
```

Then `npx expo start` and open the dev build. Server setup (Edge Function + webhooks) is in [SUPABASE_SETUP.md](SUPABASE_SETUP.md#6-push-notifications).

---

Built by Hritvik Hooda (UW Allen School).
