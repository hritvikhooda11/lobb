import type { LegalSection } from '@/components/legal-page';

/** Terms of Use. Shown once at sign-up (accept to continue) and any time from Account. */
export const TERMS = {
  title: 'Terms of Use',
  updated: 'November 13, 2026',
  intro: 'By using Lobb you agree to these terms and our Privacy Policy. Questions: support@getlobb.com.',
  sections: [
    {
      heading: 'Who can use Lobb',
      body: ['UW students, 18 or older, with a uw.edu email and living in a building Lobb supports. One account each.'],
    },
    {
      heading: 'How Lobb works',
      body: [
        'Lobb connects neighbors. When you buy or borrow, you deal with the neighbor who brings it; Lobb is not the seller. Lobb sets prices from store prices and handles payments.',
      ],
    },
    {
      heading: 'What can be listed',
      body: [
        'Sales: new, factory-sealed, shelf-stable items only. Loans: non-food items, returned in the same condition.',
        'Never: alcohol, tobacco or nicotine, cannabis, supplements, medication, weapons, or anything illegal, recalled, opened, or not yours.',
      ],
    },
    {
      heading: 'Payments',
      body: [
        'Prices shown include the neighbor’s and Lobb’s fees. Your card is held when you order and charged when you get the item (loans: when you return it, and the deposit is released). Cancelled or unaccepted orders are not charged. If a borrowed item isn’t returned within 48 hours of its due time, you may be charged the deposit.',
        'Neighbors are paid through Stripe and agree to Stripe’s Connected Account Agreement. You’re responsible for taxes on what you earn.',
      ],
    },
    {
      heading: 'Respect and safety',
      body: [
        'Lobb has zero tolerance for objectionable content or abusive users: no harassment, hate, threats, sexual content, spam or scams in listings, shout-outs or chats. Keep payments on Lobb and keep people’s room numbers private.',
        'Report problems in the app. We review reports within 24 hours, and we remove content and suspend or close accounts that break these rules.',
      ],
    },
    {
      heading: 'Limits',
      body: [
        'Lobb is provided as is. Items come from other students; we don’t make or inspect them. As far as the law allows, we aren’t liable for indirect damages, and our total liability is limited to what you paid through Lobb in the last 3 months.',
        'We may update these terms and will tell you in the app about important changes. Washington State law applies.',
      ],
    },
  ] satisfies LegalSection[],
};
