# Connect Lobb to Supabase (about 15 minutes)

Lobb's backend is a free Supabase project. These steps need **your** account, so they're yours to do. Everything else (schema, security rules, functions) is already written in `supabase/migrations/` and tested (`npm run test:db`).

## 1. Create the project
1. Sign up at **supabase.com** (GitHub sign-in is fine) and click **New project**.
2. Name: `lobb`. Region: **West US (Oregon)** (closest to Seattle).
3. Save the **database password** in your password manager. You'll need it once in step 4.

## 2. Copy the keys into `.env`
In the dashboard: **Project Settings → API Keys** (and **Data API** for the URL). In the `lobb` folder, copy `.env.example` to `.env` and fill in:

| `.env` line | Where to find it | Safe in the app? |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Project URL, `https://<ref>.supabase.co` | Yes |
| `EXPO_PUBLIC_SUPABASE_KEY` | **Publishable** key (`sb_publishable_…`) | Yes, row-level security protects data |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** key (`sb_secret_…`) | **No.** Server only. Never add `EXPO_PUBLIC_` to it |
| `ANTHROPIC_API_KEY` | console.anthropic.com (optional, for live AI prices) | **No.** Server only |

`.env` is git-ignored. Don't paste these keys into chats or screenshots.

## 3. Turn on 6-digit email codes
**Authentication → Emails → Templates.** In both **Magic Link** and **Confirm signup**, replace the body with:

```html
<h2>Your Lobb code</h2>
<p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
```

## 4. Push the database
In Terminal, from the `lobb` folder:

```bash
npx supabase login
```
```bash
npx supabase link --project-ref <your-ref>
```
(It asks for the database password from step 1. The ref is the `<ref>` in your project URL.)
```bash
npx supabase db push
```

That creates every table, security rule and function, the seeded catalog, the photo buckets, and the job that expires unanswered requests after 10 minutes.

## 5. Restart and sign in
```bash
npx expo start
```
Sign in with your `@uw.edu` email and enter the code from your inbox.

## 6. Push notifications
Lets shout-outs and new orders reach phones even when Lobb is closed. Skip this while you're testing in Expo Go; the app shows local notifications there instead (only while it's open).

**Shortcut:** `bash scripts/setup-push.sh` walks through a–c for you.

**a. EAS project and a development build** (needs a paid Apple Developer account for iOS):
```bash
npx eas login
```
```bash
npx eas init
```
(This adds `extra.eas.projectId` to `app.json`. The app needs it to get a push token.)
```bash
npx eas build --profile development --platform ios
```
When EAS asks, answer **yes** to setting up push notifications and generating an APNs key. For Android, add FCM V1 credentials first (Expo docs: "Add Android FCM V1 credentials"). Install the build on your phone, run `npx expo start`, open Lobb and sign in: it asks for notification permission and saves the phone's push token in `push_tokens`.

**b. Deploy the Edge Function.** Make a long random secret (`openssl rand -hex 32`) and keep it in your password manager:
```bash
npx supabase secrets set PUSH_WEBHOOK_SECRET=<your-secret>
```
```bash
npx supabase functions deploy push --no-verify-jwt
```
(`--no-verify-jwt` because the database webhook calls it, not the app; it checks the secret header instead. If you turn on **Enhanced push security** in the EAS dashboard, also `npx supabase secrets set EXPO_ACCESS_TOKEN=<token>`.)

**c. Add three database webhooks.** **Database → Webhooks → Create a new hook**, once for each table:

| Name | Table | Events | Type | Function | HTTP header |
|---|---|---|---|---|---|
| `push_shoutouts` | `shoutouts` | Insert | Supabase Edge Functions | `push` (POST) | `x-lobb-webhook-secret: <your-secret>` |
| `push_requests` | `requests` | Insert | Supabase Edge Functions | `push` (POST) | `x-lobb-webhook-secret: <your-secret>` |
| `push_messages` | `messages` | Insert | Supabase Edge Functions | `push` (POST) | `x-lobb-webhook-secret: <your-secret>` |

**d. Test it.** With the app fully closed on phone A, post a shout-out from phone B (same building). Phone A gets a banner; tapping it opens Shout-outs. Logs: **Edge Functions → push → Logs**. You can also send a test to a token from `push_tokens` at expo.dev/notifications.

What gets sent: shout-outs go to everyone else in the building with shout-out alerts on; new orders go to neighbors who list the item and have it in stock (alcohol only to admins). Who and what is decided in SQL (`public.push_messages`) and covered by `npm run test:db`. Payloads contain first names, item names and prices, never room numbers or birthdates. Phones that uninstall Lobb are removed automatically.

## Testing with two people
You need two accounts in the same building. Easiest: a friend with a UW email. In a **dev build** you can also use the dev sign-in (`LOBB_DEV_LOGIN=1` + `EXPO_PUBLIC_DEMO_LOGIN=1` in `.env`), which signs in without sending an email. It only works on your laptop's dev server; production builds and the hosted API return 404 for it.

Without a second UW email you can temporarily allow another domain in **SQL Editor**:

```sql
insert into public.allowed_email_domains values ('gmail.com');
```

and remove it again when you're done (existing gmail test accounts keep working; only new sign-ups are blocked):

```sql
delete from public.allowed_email_domains where domain = 'gmail.com';
```

Use one account in the browser preview and one on the iPhone Simulator (or a real phone in Expo Go). Note the 20-second priority window: a neighbor without the item listed sees a new request 20 seconds after it's sent.

## 7. Going live (before TestFlight)
Supabase is already Lobb's real, hosted backend (database, sign-in, realtime, photos, push). Nothing moves to AWS. Three things are missing before real students can use it away from your laptop: real email delivery, hosting the API routes, and a few switches. Steps marked **(you)** need your accounts, card or DNS.

### 7a. Real email for sign-in codes (Resend)
Supabase's built-in email only sends a few messages an hour and lands in spam, so codes must go through your own email provider. **Resend** is the simplest (free tier: about 3,000 emails/month, 100/day, plenty for a UW pilot). AWS SES also works (cheaper at scale, but needs a sandbox-exit request to AWS, which takes a day or more); the Supabase side is the same, only the host/user/password differ.

1. **(you, ~$12/yr) Buy a domain**, e.g. `getlobb.com` (the iOS bundle id `com.lobbapp.lobb` doesn't need to match). Cloudflare Registrar, Namecheap or Porkbun are fine. You can't send from `@gmail.com` or `@uw.edu`.
2. **(you) Create a Resend account** at resend.com → **Domains → Add domain** → enter `mail.getlobb.com` (a subdomain keeps your main domain's reputation separate) and region **us-east-1**.
3. **(you, DNS)** Resend shows 3–4 records (an MX and a TXT for SPF on `send.mail…`, a TXT `resend._domainkey…` for DKIM). Add each one exactly at your registrar's DNS page. Also add a DMARC record so UW's mail servers trust it: type `TXT`, name `_dmarc`, value `v=DMARC1; p=none;`. Click **Verify** in Resend; it usually turns green within minutes (can take a few hours).
4. **(you)** Resend → **API Keys → Create** with permission **Sending access**, limited to that domain. Copy it once; don't paste it anywhere except the next step.
5. **(you)** Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**:

| Field | Value |
|---|---|
| Sender email | `codes@mail.getlobb.com` |
| Sender name | `Lobb` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key |

6. **Templates** (Authentication → Emails → Templates): make sure **Magic Link** and **Confirm signup** both show the code (step 3 above). Subject: `Your Lobb code: {{ .Token }}`. Body:

```html
<h2>Your Lobb sign-in code</h2>
<p>Enter this code in the Lobb app:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>It expires in 1 hour. If you didn't try to sign in, ignore this email.</p>
```

   Don't include `{{ .ConfirmationURL }}`: the app signs in with the code, not a link, and UW's link scanners can use up one-time links.
7. **Rate limits:** Authentication → **Rate Limits** → raise "Emails sent per hour" from the default to about `100` (Resend's daily cap is 100 on the free tier).
8. **Allow only UW:** in **SQL Editor** run `select * from public.allowed_email_domains;`. It must show only `uw.edu`. If `gmail.com` is there from testing:

```sql
delete from public.allowed_email_domains where domain = 'gmail.com';
```

9. Nothing changes in the app: Supabase sends the email, the app only asks for and checks the code. Test: sign in on the web preview with your `@uw.edu` address. The code should arrive within a minute (check UW's quarantine at first; DMARC helps). Resend → **Emails** shows each delivery.

### 7b. Host the API routes (EAS Hosting)
`/api/price`, `/api/barcode` and `/api/identify` run on the server (they hold keys). In development they run on your laptop; a phone away from your Wi-Fi can't reach that. EAS Hosting runs them at `https://lobb.expo.app`, which `app.json` already points the app at (`expo-router` plugin `origin`). The dev-only routes (`/api/dev-code`, `/api/dev-reset`) always return 404 there.

1. **(you)** Create a free account at expo.dev, then in the `lobb` folder:

```bash
npx eas-cli@latest login
```
```bash
npx eas-cli@latest init
```

2. **(you) Server secrets.** expo.dev → your **lobb** project → **Environment variables** → add each for the **production** environment, visibility **Sensitive** (not "Secret": Hosting can't read secret variables):

| Name | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (`sb_secret_…`) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys (needs billing; Lobb uses the cheapest model) |
| `UPCITEMDB_KEY` | optional, raises the 100 lookups/day limit |
| `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | developer.kroger.com (free) |
| `KROGER_ZIP` | `98105` |

   Also add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` (visibility **Plain text**) for **production** and **preview**: EAS Build doesn't upload your `.env`, so the app build reads them from here. **Never add `LOBB_DEV_LOGIN` or `EXPO_PUBLIC_DEMO_LOGIN` to production.**

3. Deploy:

```bash
npm run deploy:api
```

   The first time it asks for a subdomain: type `lobb`. If `lobb` is taken, pick another and change `origin` in `app.json` to `https://<your-name>.expo.app/` to match. Re-run `npm run deploy:api` whenever you change an API route or a server variable (each deploy is a fixed snapshot).
4. Check it: `https://lobb.expo.app/api/barcode?code=012000161155` should return a product, and the dev routes should return `{"error":"Not found"}`.
5. Build the app with `npx eas-cli@latest build --profile production --platform ios`. Release builds call `https://lobb.expo.app/api/...`; dev builds keep using your laptop.

### 7c. What's already done in the code
- The saved session on the phone is encrypted (AES-256-GCM with the key in the iOS Keychain / Android Keystore, `src/lib/secure-session.ts`). Old plain-text sessions are upgraded on first launch.
- Release builds only accept `@uw.edu` addresses and hide the dev sign-in; the database trigger enforces the same rule.
- Row-level security and grants are unchanged and covered by `npm run test:db`.

### 7d. Which Supabase plan
- **Free is fine for TestFlight and a closed pilot**, but a free project **pauses after 1 week without activity** and has **no backups**.
- **Upgrade to Pro ($25/month) before the public App Store launch:** never paused, daily backups (7 days), 8 GB database, 100 GB photo storage, 250 GB egress, 500 realtime connections, email support. Leave the spend cap on. Lobb's usage for one or two buildings is far inside these limits.
- Other monthly costs: domain (~$1), Resend (free to start), EAS (free: 100k API requests/month and 15 iOS builds), Anthropic (cents per priced item), Apple Developer Program ($99/year, needed for TestFlight).

### 7e. Still open before App Review
Apple's reviewers need a way to sign in, and they don't have a UW email. Plan one before submitting: for example allow your own domain (`insert into public.allowed_email_domains values ('getlobb.com');`, which only you can create addresses on), make `review@getlobb.com` forward to you, and put it in App Store Connect → App Review Information with a note that the code arrives by email. Release builds currently only accept `@uw.edu` in the app (`src/app/onboarding.tsx`), so that check needs to allow the reviewer address too.
