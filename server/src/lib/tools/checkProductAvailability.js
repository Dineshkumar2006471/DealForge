/**
 * check_product_availability
 *
 * Tier 1 (OBSERVE) — Safe read-only. Reads static product catalog.
 */
const { registerTool } = require('./registry');
const { getProduct, getAllProducts, calculateAnnualCost } = require('../data/productCatalog');

async function checkProductAvailability(args, context) {
  const { plan, seats } = args;

  if (plan) {
    const product = getProduct(plan);
    if (!product) {
      return {
        available: false,
        message: `Plan "${plan}" not found. Available plans: Starter, Pro, Enterprise.`,
        plans: getAllProducts().map(p => p.name),
      };
    }

    const seatCount = parseInt(seats) || 0;
    const result = {
      available: true,
      plan: product.name,
      pricePerSeat: product.pricePerSeat,
      billingCycle: product.billingCycle,
      features: product.features,
    };

    if (seatCount > 0) {
      result.seats = seatCount;
      result.monthlyTotal = product.pricePerSeat * seatCount;
      result.annualTotal = calculateAnnualCost(plan, seatCount);

      if (product.minSeats && seatCount < product.minSeats) {
        result.warning = `${product.name} requires minimum ${product.minSeats} seats.`;
      }
      if (product.maxSeats && seatCount > product.maxSeats) {
        result.warning = `${product.name} supports maximum ${product.maxSeats} seats. Consider upgrading.`;
      }
    }

    return result;
  }

  // No specific plan — return all
  return {
    available: true,
    plans: getAllProducts().map(p => ({
      name: p.name,
      pricePerSeat: p.pricePerSeat,
      features: p.features.slice(0, 3),
    })),
  };
}

registerTool('check_product_availability', checkProductAvailability, {
  description: 'Check product availability and pricing. Returns plan details, pricing per seat, and features.',
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'Plan name: starter, pro, or enterprise' },
      seats: { type: 'number', description: 'Number of seats to calculate pricing for' },
    },
  },
});

module.exports = checkProductAvailability;
