# Lobb — Road to the App Store

## Stack (decided)
| Layer | Choice | Why |
|---|---|---|
| App | **Expo (React Native) + TypeScript + Expo Router** | One codebase for iOS + Android, builds and App Store submission in the cloud via EAS |
| Backend | **Supabase** (Postgres, Auth, Realtime, Storage, Edge Functions) | Email OTP for @uw.edu sign-in, realtime for live request status, storage for seal photos, row-level security |
| Payments | **Stripe Connect (Express accounts)** | Marketplace payouts to students, handles 1099-K reporting. Physical goods/services are allowed outside Apple's in-app purchase (guideline 3.1.3(e)) |
| Push | **Expo Notifications** | "Someone in your building wants a Coke" |
| Camera | **expo-camera** | Barcode scan, seal photo, QR handoff scan |

## Founder decisions (2026-10-14)
These override PRODUCT_CONTEXT.md where they conflict.
- **Name:** Lobb.
- **Pricing:** Lobb still sets every price (Claude + web search, `src/app/api/price+api.ts`), but sellers can nudge their own listing **±5%**.
- **Rentals are in scope** for non-food items (no toiletries). Renter gets a card hold for the item's value, released on return. Lender takes a condition photo first.
- **Duplicate items:** listing an item that already exists adds stock to the existing item (same photo, same price).
- **Handoff photo:** after scanning the buyer's QR, the deliverer must snap a photo before payout.
- **Alcohol: not in the peer-to-peer app.** Illegal P2P in WA without a liquor license and would risk App Store rejection. Revisit only as the licensed-partner-store model (PRODUCT_CONTEXT §12) with legal sign-off.

## Phase 0 — Prototype ✅ (done)
- Design system (dark-first violet / lime), all core screens, buyer + seller flows, mocked data.
- Request flow is 2 taps from home (rule: ≤ 3).
- Real product photos (bundled, credits in `assets/items/CREDITS.md`), Rent mode, list-an-item flow with AI pricing, handoff photos.

## Phase 1 — Real backend
- [ ] Supabase project; tables from PRODUCT_CONTEXT §16 with row-level security
- [ ] @uw.edu email OTP sign-in; persist session
- [ ] Item catalog seeded by UPC; eligibility flag enforced server-side
- [ ] Requests via Realtime; **first-come-first-serve accept as a single atomic DB update** (no double-accepts)
- [ ] Listed-seller priority window, then community broadcast (Edge Function + push)
- [ ] Request expiry + deliverer 10-min deadline handled server-side (cron)
- [ ] Replace `src/store/app-store.tsx` mocks with Supabase calls (screens stay as-is)

## AI pricing setup
- Put your key in `.env` (copy `.env.example`): `ANTHROPIC_API_KEY=...` from console.anthropic.com. Without it the app uses category estimates (marked ESTIMATE).
- The route uses Claude Opus 5.5 with web search and server-side fallbacks enabled; each lookup is roughly a few cents. Cache prices per item in the DB so each item is priced once, not per listing.
- Before launch: deploy the API route (EAS Hosting) and rate-limit it per user.

## Phase 2 — Camera + trust
- [ ] expo-camera barcode scan must match requested item's UPC
- [ ] Seal photo upload to Storage
- [ ] Single-use, short-lived signed QR token, verified server-side on scan
- [ ] Ratings, reliability score, report/dispute queue

## Phase 3 — Money
- [ ] Stripe Connect onboarding for sellers; PaymentSheet for buyers
- [ ] Authorize on accept → capture on QR scan → transfer to seller
- [ ] Refund paths for cancel / expiry / disputes

## Phase 4 — Ship
- [ ] Apple Developer Program ($99/yr) — **you must enroll yourself**
- [ ] In-app credits screen for product photos (CC BY-SA attribution), or replace with our own photos
- [ ] Rental damage/late policy and deposit capture rules
- [ ] App icon, splash, screenshots, privacy policy + terms URLs (UW Entrepreneurial Law Clinic review)
- [ ] `eas build --profile preview` → TestFlight beta in one building
- [ ] App Review notes: demo account, explain P2P model, sealed-goods-only rules, account deletion in-app (required)
- [ ] `eas submit` to the App Store

## Open decisions for the founder
- Fee model: placeholder is 20% (min $0.75) to the deliverer plus a $0.25 platform fee, in `src/data/pricing.ts`. A $1.25 Coke costs $2.25 total.
- Check "Lobb" trademark + App Store name availability.
- Launch building.
