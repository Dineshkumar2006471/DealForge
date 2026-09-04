/**
 * Concession Catalog
 *
 * Structured alternatives to deeper discounts.
 * Used when discount requests exceed autonomous limits.
 */
const CONCESSIONS = [
  {
    id: 'extended_trial',
    name: 'Extended Trial',
    description: '60-day free trial instead of the standard 14 days',
    value_signal: 'Reduces perceived risk for budget-conscious buyers',
  },
  {
    id: 'priority_onboarding',
    name: 'Priority Onboarding',
    description: 'Dedicated onboarding specialist for the first 30 days',
    value_signal: 'Reduces time-to-value, especially for larger teams',
  },
  {
    id: 'additional_training',
    name: 'Additional Training Sessions',
    description: '3 extra live training sessions for your team',
    value_signal: 'Increases adoption rates and reduces churn risk',
  },
  {
    id: 'waived_setup',
    name: 'Waived Setup Fee',
    description: 'No one-time setup or migration fee',
    value_signal: 'Lowers upfront cost without reducing recurring revenue',
  },
  {
    id: 'annual_commitment',
    name: 'Annual Commitment Discount',
    description: 'Additional 5% off with a 12-month commitment',
    value_signal: 'Locks in revenue while giving the customer a better rate',
  },
  {
    id: 'multi_year',
    name: 'Multi-Year Deal',
    description: 'Up to 10% additional discount with a 24-month commitment',
    value_signal: 'Maximizes LTV while offering significant savings',
  },
];

function getConcessions(maxCount = 3) {
  return CONCESSIONS.slice(0, maxCount);
}

function getConcessionById(id) {
  return CONCESSIONS.find(c => c.id === id) || null;
}

module.exports = { CONCESSIONS, getConcessions, getConcessionById };
