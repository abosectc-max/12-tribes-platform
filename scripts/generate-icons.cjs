const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'public', 'icons');

function makeSVG(size, maskable) {
  const r = maskable ? 0 : Math.round(size * 0.22);
  const fs2 = Math.round(size * 0.38);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs>
  <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#00D4FF"/>
    <stop offset="50%" stop-color="#6366F1"/>
    <stop offset="100%" stop-color="#A855F7"/>
  </linearGradient>
</defs>
<rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="-apple-system,Helvetica,sans-serif" font-size="${fs2}" font-weight="900">12</text>
</svg>`;
}

const specs = [
  ['icon-192.svg', 192, false],
  ['icon-512.svg', 512, false],
  ['icon-maskable-192.svg', 192, true],
  ['icon-maskable-512.svg', 512, true],
  ['icon-180.svg', 180, false],
  ['apple-touch-icon.svg', 180, false],
];

specs.forEach(([name, size, mask]) => {
  fs.writeFileSync(path.join(iconsDir, name), makeSVG(size, mask));
  console.log('OK:', name, size + 'x' + size);
});

console.log('\nDone. For PNG conversion, open /icons/generator.html in a browser.');
