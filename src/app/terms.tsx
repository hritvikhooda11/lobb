import { LegalPage } from '@/components/legal-page';

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Use"
      updated="November 12, 2026"
      intro="These terms are an agreement between you and Lobb. By using Lobb you agree to them. Questions: support@getlobb.com."
      sections={[
        {
          heading: 'Who can use Lobb',
          body: ['You must be a current UW student with a uw.edu email, at least 18, and living in a building Lobb supports. One account per person.'],
        },
        {
          heading: 'What Lobb is',
          body: [
            'Lobb connects neighbors. When you buy or borrow something, you are dealing with the neighbor who brings it; Lobb is not the seller. Lobb sets prices from store prices, processes payments, and helps resolve problems.',
          ],
        },
        {
          heading: 'What you can sell or lend',
          body: [
            'Sales: only new, factory-sealed, shelf-stable items. You must check the seal and take the photos the app asks for.',
            'Loans: non-food items (no toiletries), returned in the same condition.',
            'Never: alcohol, tobacco or nicotine, cannabis, vitamins or supplements, medication, weapons, or anything illegal, recalled, opened, or not yours to sell.',
          ],
        },
        {
          heading: 'Payments and fees',
          body: [
            'Prices include the delivering neighbor’s fee and Lobb’s fee, shown before you order. Your card is authorized when you order and charged when you receive the item (for loans, when you return it; the deposit hold is released then).',
            'If an order is cancelled or nobody accepts it, the hold is released. If a borrowed item is not returned within 48 hours of its due time, you may be charged the deposit, which goes to the lender.',
            'Neighbors who deliver are paid through Stripe and must agree to Stripe’s Connected Account Agreement. You are responsible for any taxes on what you earn.',
          ],
        },
        {
          heading: 'How to behave',
          body: [
            'Be honest in listings, show up when you accept an order, respect people’s privacy (including room numbers), and don’t harass anyone. No spam, scams, or trying to take payments off Lobb.',
            'We may remove listings, limit, or close accounts that break these rules.',
          ],
        },
        {
          heading: 'Problems with an order',
          body: [
            'Use Report a problem in the app. We review reports and may refund buyers, hold payouts, or take action on accounts.',
          ],
        },
        {
          heading: 'Disclaimers',
          body: [
            'Items are provided by other students. Lobb does not make or inspect them and provides the service as is. To the extent the law allows, Lobb is not liable for indirect damages, and our total liability for any claim is limited to the amount you paid through Lobb in the 3 months before it.',
          ],
        },
        {
          heading: 'Changes and law',
          body: ['We may update these terms; we will tell you in the app about important changes. Washington State law applies.'],
        },
      ]}
    />
  );
}
