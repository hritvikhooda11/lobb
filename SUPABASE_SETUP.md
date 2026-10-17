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

**c. Add two database webhooks.** **Database → Webhooks → Create a new hook**, once for each table:

| Name | Table | Events | Type | Function | HTTP header |
|---|---|---|---|---|---|
| `push_shoutouts` | `shoutouts` | Insert | Supabase Edge Functions | `push` (POST) | `x-lobb-webhook-secret: <your-secret>` |
| `push_requests` | `requests` | Insert | Supabase Edge Functions | `push` (POST) | `x-lobb-webhook-secret: <your-secret>` |

**d. Test it.** With the app fully closed on phone A, post a shout-out from phone B (same building). Phone A gets a banner; tapping it opens Shout-outs. Logs: **Edge Functions → push → Logs**. You can also send a test to a token from `push_tokens` at expo.dev/notifications.

What gets sent: shout-outs go to everyone else in the building with shout-out alerts on; new orders go to neighbors who list the item and have it in stock (alcohol only to admins). Who and what is decided in SQL (`public.push_messages`) and covered by `npm run test:db`. Payloads contain first names, item names and prices, never room numbers or birthdates. Phones that uninstall Lobb are removed automatically.

## Testing with two people
You need two accounts in the same building. Easiest: a friend with a UW email. Without one, you can temporarily allow a second domain in **SQL Editor**:

```sql
insert into public.allowed_email_domains values ('gmail.com');
```

**Remove it before any real launch:**

```sql
delete from public.allowed_email_domains where domain = 'gmail.com';
```

Use one account in the browser preview and one on the iPhone Simulator (or a real phone in Expo Go). Note the 20-second priority window: a neighbor without the item listed sees a new request 20 seconds after it's sent.

## Before launch (not needed for testing)
- **Custom email (SMTP):** Supabase's built-in email is rate-limited to a handful per hour. Set up Resend or Postmark under **Authentication → Emails → SMTP**.
- **Encrypt the saved session** on the phone (see the TODO in `src/lib/supabase.ts`).
- **Deploy the API routes** (`/api/price`, `/api/barcode`) with EAS Hosting and set the app's `origin`, so phones can reach them outside your Wi-Fi.
