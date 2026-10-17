#!/usr/bin/env bash
# One-time setup for remote push notifications (SUPABASE_SETUP.md §6), as a guided script.
# Run from the project folder:  bash scripts/setup-push.sh
# It pauses wherever you need to sign in or click something. Safe to re-run: finished steps are skipped.
set -euo pipefail

PROJECT_REF="tauvuqwkpidiwmjfzguv"
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
pause() { read -r -p "$(printf '\033[33m%s\033[0m [Enter] ' "$1")"; }

step "1/6  Expo account"
if npx --yes eas-cli@latest whoami >/dev/null 2>&1; then
  echo "Signed in to Expo as $(npx --yes eas-cli@latest whoami)."
else
  npx --yes eas-cli@latest login
fi

step "2/6  EAS project (gives the app a push project ID)"
if grep -q '"projectId"' app.json; then
  echo "Already set up."
else
  npx --yes eas-cli@latest init
fi

step "3/6  Supabase CLI login + link to the Lobb project"
if [ -f supabase/.temp/project-ref ] && [ "$(cat supabase/.temp/project-ref)" = "$PROJECT_REF" ]; then
  echo "Already linked."
else
  npx --yes supabase login
  echo "When asked for the database password, use the one from when you created the project"
  echo "(or reset it: Dashboard → Project Settings → Database → Reset database password)."
  npx --yes supabase link --project-ref "$PROJECT_REF"
fi

step "4/6  Webhook secret + deploy the push function"
SECRET_FILE=".push-webhook-secret"   # git-ignored; keep a copy in your password manager
if [ ! -f "$SECRET_FILE" ]; then
  openssl rand -hex 32 > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
fi
grep -qx "$SECRET_FILE" .gitignore || echo "$SECRET_FILE" >> .gitignore
SECRET="$(cat "$SECRET_FILE")"
npx --yes supabase secrets set PUSH_WEBHOOK_SECRET="$SECRET" --project-ref "$PROJECT_REF"
npx --yes supabase functions deploy push --no-verify-jwt --project-ref "$PROJECT_REF"

step "5/6  Two database webhooks (in the Supabase dashboard)"
printf '%s' "$SECRET" | pbcopy
echo "The webhook secret is now on your clipboard."
echo "Opening Database → Webhooks. Create TWO hooks (enable webhooks first if it asks):"
echo
echo "  Name            Table       Events   Type                      Function     HTTP header"
echo "  push_shoutouts  shoutouts   Insert   Supabase Edge Functions   push (POST)  x-lobb-webhook-secret: <paste>"
echo "  push_requests   requests    Insert   Supabase Edge Functions   push (POST)  x-lobb-webhook-secret: <paste>"
open "https://supabase.com/dashboard/project/$PROJECT_REF/integrations/webhooks/webhooks" 2>/dev/null || true
pause "Press Enter once both webhooks are saved"

step "6/6  Development build for your iPhone (needs the \$99 Apple Developer account)"
echo "When EAS asks: sign in with your Apple ID, say YES to push notifications / generating an APNs key,"
echo "and register your iPhone (it shows a QR code to scan) so the build installs on it."
pause "Press Enter to start the build (takes ~15 min in the cloud)"
npx --yes eas-cli@latest build --profile development --platform ios

cat <<'DONE'

✅ Done. Next:
  1. Install the build on your iPhone from the link/QR EAS printed.
  2. Run:  npx expo start --dev-client
  3. Open Lobb on the phone, sign in, and allow notifications (this saves the phone's push token).
  4. Test: fully close Lobb on the phone, post a shout-out from another account in the same building,
     and a banner should arrive. Logs: Supabase → Edge Functions → push → Logs.
DONE
