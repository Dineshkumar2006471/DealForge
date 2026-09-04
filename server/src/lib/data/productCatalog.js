/**
 * Product Catalog
 *
 * Deterministic pricing data. Never sent to the browser.
 * The model reads this through the check_product_availability tool.
 */
const PRODUCTS = {
  starter: {
    name: 'Starter',
    pricePerSeat: 29,
    billingCycle: 'monthly',
    features: [
      'Core CRM integration',
      'Email automation',
      'Basic reporting',
      '5 GB storage',
      'Email support',
    ],
    maxSeats: 50,
    minSeats: 1,
  },
  pro: {
    name: 'Pro',
    pricePerSeat: 79,
    billingCycle: 'monthly',
    features: [
      'Everything in Starter',
      'Advanced analytics',
      'Custom workflows',
      'API access',
      '50 GB storage',
      'Priority support',
      'Team collaboration',
    ],
    maxSeats: 500,
    minSeats: 1,
  },
  enterprise: {
    name: 'Enterprise',
    pricePerSeat: 149,
    billingCycle: 'monthly',
    features: [
      'Everything in Pro',
      'Unlimited storage',
      'SSO / SAML',
      'Dedicated account manager',
      'Custom integrations',
      'SLA guarantee (99.9%)',
      'Advanced security & compliance',
      'Priority onboarding',
    ],
    maxSeats: null, // unlimited
    minSeats: 100,
  },
};

function getProduct(planName) {
  const key = planName.toLowerCase().replace(/\s/g, '');
  return PRODUCTS[key] || null;
}

function getAllProducts() {
  return Object.values(PRODUCTS);
}

function calculateAnnualCost(planName, seats) {
  const product = getProduct(planName);
  if (!product) return null;
  return product.pricePerSeat * seats * 12;
}

module.exports = { PRODUCTS, getProduct, getAllProducts, calculateAnnualCost };
