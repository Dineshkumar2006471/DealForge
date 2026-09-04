// Quick seeder for Deals Collection
const { seedAcmeDeal } = require('./src/lib/schema/seedData');

seedAcmeDeal()
  .then(() => {
    console.log('Seeding complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('Seeding failed', err);
    process.exit(1);
  });
