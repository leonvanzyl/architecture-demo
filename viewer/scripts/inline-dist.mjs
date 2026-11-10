// Post-build: inline the JS/CSS bundle into dist/index.html so it also works when opened from file://
import fs from 'node:fs';
import path from 'node:path';
const dist = new URL('../dist/', import.meta.url).pathname;
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/g, (m, f) => {
  const js = fs.readFileSync(path.join(dist, f), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/g, (m, f) => `<style>${fs.readFileSync(path.join(dist, f), 'utf8')}</style>`);
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.rmSync(path.join(dist, 'assets'), { recursive: true, force: true });
console.log('inlined bundle into dist/index.html (' + (html.length / 1024).toFixed(0) + ' KB)');
