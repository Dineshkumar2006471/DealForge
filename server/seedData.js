// Compatibility entry point. Demo data is organization-scoped and requires SEED_ORGANIZATION_ID.
const { seedAcmeDeal } = require('./src/lib/schema/seedData');
seedAcmeDeal().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
