const sharp = require('sharp');
sharp('DealForge-logo.png')
  .extract({ left: 0, top: 0, width: 262, height: 262 })
  .toFile('favicon.png')
  .then(() => console.log('Done'))
  .catch(err => console.error(err));
