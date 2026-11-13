import { LegalPage } from '@/components/legal-page';

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="November 13, 2026"
      intro="Lobb is a marketplace for students in the same UW housing building to buy, sell and borrow everyday items. This policy explains what we collect, why, and the choices you have. Questions: support@getlobb.com."
      sections={[
        {
          heading: 'What we collect',
          body: [
            'Account: your UW email address, a display name, your building, and your room number.',
            'Your room number is private. It is only shown to the other person in an order that needs it (for example, a door drop-off), after they accept.',
            'Date of birth, only if you choose to enter it.',
            'What you do on Lobb: listings, orders, shout-outs, chat messages, ratings, and the photos you take (items you list, seal checks, and handoffs).',
            'Payments: handled by Stripe. We never see or store your full card or bank details. We keep Stripe’s customer and account IDs and the status of each payment and payout.',
            'Safety: reports you file and people you block.',
            'Device: a push notification token if you allow notifications, and basic technical logs needed to run the service.',
          ],
        },
        {
          heading: 'How we use it',
          body: [
            'To run the marketplace: show listings in your building, connect buyers and the neighbors who deliver, verify handoffs, process payments and payouts, and send you notifications you asked for.',
            'To keep people safe: verify you are a UW student, enforce the rules about what can be sold, and look into reports.',
            'To price items: when you list something, we look up its store price using the product name or barcode.',
            'AI photo reading, only if you allow it: your item photo is sent to Anthropic’s Claude to recognize the product and its price. It’s used only for that, and Anthropic doesn’t use it to train its models. You’re asked first, and you can turn it off any time in Account → Settings.',
            'To keep Lobb safe: we automatically filter offensive language in chats, shout-outs, listings and names, and we review reports within 24 hours.',
            'We do not sell your personal information and we do not use it for advertising.',
          ],
        },
        {
          heading: 'Who we share it with',
          body: [
            'Other users: your display name, rating, and listings are visible to people in your building. Your room number is only shared as described above.',
            'Service providers that run Lobb for us: Supabase (database and accounts), Expo (app hosting), Cloudflare (website), Stripe (payments and payouts), Resend (sign-in emails), Anthropic (reading item photos if you allow it, and estimating prices from product names when no store lists an item), and Kroger and UPCitemdb (product and price lookups, which receive product details, not your personal information). Each is bound to protect your data at least as well as we do.',
            'If required by law, or to protect the safety of our users.',
          ],
        },
        {
          heading: 'How long we keep it',
          body: [
            'We keep your data while your account is open. When you delete your account, we delete your profile, listings, shout-outs, messages and photos. Orders you were part of stay in the other person’s history without your name. Stripe keeps payment records as the law requires.',
          ],
        },
        {
          heading: 'Your choices',
          body: [
            'Delete your account any time: Account → Delete account.',
            'Turn off shout-out alerts or AI photo reading in Account, or turn off notifications in your phone’s settings.',
            'Block anyone from a chat, shout-out or order; manage blocked people in Account.',
            'Ask us for a copy of your data or to correct it: support@getlobb.com.',
          ],
        },
        {
          heading: 'Students and minors',
          body: ['Lobb is for UW students 18 and older; you confirm your age when you sign up. We don’t knowingly collect data from anyone under 18.'],
        },
        {
          heading: 'Changes',
          body: ['If we change this policy, we will update the date above and tell you in the app for important changes.'],
        },
      ]}
    />
  );
}
