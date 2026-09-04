const fs = require('fs');
const path = require('path');
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/<link rel="icon" href="data:image\/svg\+xml,.*?">/g, '<link rel="icon" href="/favicon.png">');
  fs.writeFileSync(filePath, content);
  console.log('Updated ' + file);
});
