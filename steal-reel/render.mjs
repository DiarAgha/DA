// Renders reel.html frame-by-frame with headless Chromium and encodes with ffmpeg.
//   node render.mjs                         -> out/steal-like-an-artist-reel.mp4 (needs out/audio.wav)
//   node render.mjs --stills 0,30,45        -> out/stills/frame_XXXX.png (for review)
//   node render.mjs --page reel2.html --timeline out/timeline.json --silent --out video2-silent.mp4
//   node render.mjs --name "Jane Doe" --handle "@jane"   -> personalised sign-off
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : undefined; };
const FPS = 30, TOTAL = 450;
const out = path.join(here, 'out'); mkdirSync(out, { recursive: true });

const browser = await playwright.chromium.launch({ args: ['--disable-gpu', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const pageFile = arg('page') || 'reel.html';
const timeline = arg('timeline') ? JSON.parse(readFileSync(path.resolve(arg('timeline')), 'utf8')) : undefined;
await page.addInitScript(([cfg, tl]) => { window.CONFIG = cfg; if (tl) window.TIMELINE = tl; }, [{ name: arg('name') || '', handle: arg('handle') || '' }, timeline]);
await page.goto(pathToFileURL(path.join(here, pageFile)).href);
await page.evaluate(() => window.fontsReady);
await page.waitForTimeout(300);

const grab = () => page.evaluate(() => document.getElementById('c').toDataURL('image/png').split(',')[1]);

const stills = arg('stills');
if (stills) {
  mkdirSync(path.join(out, 'stills'), { recursive: true });
  for (const f of stills.split(',').map(Number)) {
    await page.evaluate((f) => window.renderFrame(f), f);
    writeFileSync(path.join(out, 'stills', `frame_${String(f).padStart(4, '0')}.png`), Buffer.from(await grab(), 'base64'));
  }
  await browser.close(); process.exit(0);
}

const audio = arg('silent') ? '' : path.join(out, 'audio.wav');
const dest = path.join(out, arg('out') || 'steal-like-an-artist-reel.mp4');
const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  ...(audio && existsSync(audio) ? ['-i', audio] : []),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  ...(audio && existsSync(audio) ? ['-c:a', 'aac', '-b:a', '256k', '-ar', '44100', '-shortest'] : []),
  '-movflags', '+faststart', dest,
], { stdio: ['pipe', 'inherit', 'inherit'] });

for (let f = 0; f < TOTAL; f++) {
  await page.evaluate((f) => window.renderFrame(f), f);
  const buf = Buffer.from(await grab(), 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 30 === 0) console.log(`frame ${f}/${TOTAL}`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log('wrote', dest);
