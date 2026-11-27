// Renders the blockout to PNG frames with headless Chromium.
// usage: node render.cjs <outDir> [firstFrame] [lastFrame] [query]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const out = process.argv[2] || 'frames'; const f0 = +(process.argv[3] ?? 0), f1 = +(process.argv[4] ?? 100);
const query = process.argv[5] || '';
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = http.createServer((q, r) => {
  const p = path.join(__dirname, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); } });
}).listen(0, async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  pg.on('console', m => console.log('page:', m.text())); pg.on('pageerror', e => console.log('ERR', e.message));
  await pg.goto(`http://localhost:${srv.address().port}/index.html?${query}`);
  await pg.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  for (let f = f0; f <= f1; f++) {
    const t = Date.now();
    await pg.evaluate(f => window.__setFrame(f), f);
    const data = await pg.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
    fs.writeFileSync(path.join(out, `f${String(f).padStart(4, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log('frame', f, Date.now() - t, 'ms');
  }
  await b.close(); srv.close();
});
