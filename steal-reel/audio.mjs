// Synthesises a 15s, 120 bpm soundtrack (no samples, no dependencies) timed to the reel's cuts.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100, DUR = 15, N = SR * DUR, BEAT = 0.5;
const L = new Float32Array(N), R = new Float32Array(N);
let seed = 1234; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function add(t0, dur, fn, gain = 1, pan = 0) {
  const s = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  const gl = gain * (pan <= 0 ? 1 : 1 - pan), gr = gain * (pan >= 0 ? 1 : 1 + pan);
  for (let i = 0; i < n && s + i < N; i++) {
    if (s + i < 0) continue;
    const v = fn(i / SR, i / n); L[s + i] += v * gl; R[s + i] += v * gr;
  }
}
const sine = (f, t) => Math.sin(2 * Math.PI * f * t);

function kick(t0, g = 1) {
  let ph = 0;
  add(t0, .35, (t, p) => { const f = 45 + 120 * Math.exp(-t * 28); ph += 2 * Math.PI * f / SR; return Math.sin(ph) * Math.exp(-t * 9) * (1 - Math.exp(-t * 900)); }, .9 * g);
}
function hat(t0, g = 1, open = false) {
  let y = 0, px = 0;
  add(t0, open ? .18 : .05, (t) => { const x = rnd(); y = x - px + .8 * y; px = x; return y * Math.exp(-t * (open ? 18 : 70)); }, .16 * g, .3);
}
function clap(t0, g = 1) {
  for (const o of [0, .011, .022]) { let lp = 0; add(t0 + o, .12, (t) => { lp += .55 * (rnd() - lp); return lp * Math.exp(-t * (o === .022 ? 22 : 90)); }, .5 * g); }
}
function bass(t0, f, dur = .24, g = 1) {
  let ph = 0;
  add(t0, dur, (t, p) => { ph += 2 * Math.PI * f / SR; const saw = (ph / Math.PI) % 2 - 1; const lp = Math.sin(ph) * .8 + saw * .25 * Math.exp(-t * 14); return lp * Math.min(1, t * 400) * Math.exp(-t * 6); }, .5 * g);
}
function whoosh(t0, dur = .45, g = 1, up = true) {
  let b = 0, lp = 0;
  add(t0, dur, (t, p) => { const q = up ? p : 1 - p; const k = .02 + q * q * .5; lp += k * (rnd() - lp); b += k * (lp - b); return (lp - b) * 6 * Math.sin(Math.PI * Math.min(1, p * 1.05) ** (up ? 1.6 : .8)); }, .6 * g);
}
function boom(t0, g = 1) { // sub impact + noise tail
  add(t0, 1.6, (t) => sine(38 + 40 * Math.exp(-t * 6), t) * Math.exp(-t * 2.4), 1.1 * g);
  let lp = 0; add(t0, .9, (t) => { lp += .12 * (rnd() - lp); return lp * Math.exp(-t * 4.5); }, 1.3 * g);
}
function tick(t0, g = 1) { let y = 0, px = 0; add(t0, .03, (t) => { const x = rnd(); y = x - px + .6 * y; px = x; return y * Math.exp(-t * 160); }, .35 * g, rnd() * .4); }
function ping(t0, f, g = 1, dur = .5) { add(t0, dur, (t) => (sine(f, t) + .3 * sine(f * 2.01, t)) * Math.exp(-t * 7) * Math.min(1, t * 300), .3 * g, rnd() * .6); }
function pad(t0, dur, freqs, g = 1) {
  for (const f of freqs) add(t0, dur, (t, p) => (sine(f, t) + sine(f * 1.004, t) * .8) * Math.min(1, t * 6) * Math.min(1, (1 - p) * 8), .045 * g, rnd() * .5);
}
function stab(t0, freqs, g = 1) {
  for (const f of freqs) { let ph = 0; add(t0, .5, (t) => { ph += 2 * Math.PI * f / SR; const saw = (ph / Math.PI) % 2 - 1; return saw * Math.exp(-t * 7) * Math.min(1, t * 500); }, .09 * g, rnd() * .6); }
}

const A1 = 55, bassNotes = [A1, A1, A1 * 1.5, A1, A1 * 4 / 3, A1, A1 * 1.5, A1 * 1.2]; // A m-ish groove

/* ---- hook (0–3s): impact, copy-pop, strike, STEAL slam ---- */
kick(0, 1);
tick(.5, 2); ping(.5, 880, .7);
whoosh(.95, .3, .8); tick(1.0, 3);
boom(1.5, 1); kick(1.5, 1.2); stab(1.5, [220, 261.6, 329.6], 1.2);
hat(2.0); hat(2.5); kick(2.0); kick(2.5); clap(2.5, 1);
whoosh(2.75, .3, 1);

/* ---- main groove (3–13s) ---- */
for (let b = 6; b < 26; b++) {
  const t = b * BEAT;
  kick(t, 1);
  if (b % 2 === 1) clap(t, .9);
  hat(t + .25, 1, b % 4 === 3);
  if (t >= 7) hat(t + .125, .45), hat(t + .375, .45);
  bass(t, bassNotes[b % 8], .22);
  bass(t + .25, bassNotes[(b + 3) % 8] * (b % 2 ? 2 : 1), .15, .8);
}
// pads follow the scene changes
pad(3, 2, [110, 164.8, 196, 261.6]); pad(5, 2, [87.3, 130.8, 174.6, 220]);
pad(7, 2, [98, 146.8, 196, 246.9]); pad(9, 2, [110, 164.8, 220, 329.6]);
pad(11, 2.2, [73.4, 110, 146.8, 220]);

// scene-cut whooshes + hits (cuts land on 3, 5, 7, 9, 11, 13)
for (const c of [3, 5, 7, 9, 11]) { whoosh(c - .25, .3, .9); boom(c, .35); }

/* ---- S3 typing clicks (5.12s onward, 24 chars/s, 29 chars) ---- */
for (let i = 0; i < 29; i++) tick(5.12 + i / 24, .9);
ping(6.35, 1320, .8);

/* ---- S4 draw sounds ---- */
for (let i = 0; i < 6; i++) whoosh(7.1 + i * .17, .22, .3);

/* ---- S5 ripples ---- */
ping(9.05, 440, .8, .9);
[0, .28, .56, .84].forEach((o, i) => ping(9.95 + o, 660 * Math.pow(1.25, i), .6, .6));
for (let i = 0; i < 12; i++) ping(10.05 + i * .08, 600 + (i % 6) * 120, .35, .3);

/* ---- S6 pops as dots vanish, then the last dot rings ---- */
const pr = (() => { let s = 77; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
for (let i = 0; i < 28; i++) ping(11.75 + pr() * .85, 1400 - i * 25, .45, .15);
ping(12.65, 330, 1, 1.0);

/* ---- outro: riser into the circle wipe, big hit, sign-off ---- */
whoosh(12.0, 1.0, 1.2);
boom(13.0, 1.3); kick(13.0, 1.2); stab(13.0, [220, 277.2, 329.6, 440], 1.5);
whoosh(12.75, .25, 1.1);
for (const t of [13.5, 14.0, 14.5]) { kick(t, .9); clap(t + 0, .6); }
for (const t of [13.25, 13.75, 14.25, 14.75]) hat(t, 1);
pad(13, 2, [110, 164.8, 220, 277.2, 329.6], 1.4);
ping(14.5, 880, .8, .6);

/* ---- master: gentle low shelf of glue, soft clip, fades, normalise ---- */
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t * 80) * Math.min(1, (DUR - t) * 6);
  L[i] = Math.tanh(L[i] * 1.1) * fade; R[i] = Math.tanh(R[i] * 1.1) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = .72 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * norm * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * norm * 32767), 46 + i * 4); }
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'); mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'audio.wav'), buf);
console.log('audio.wav written, pre-norm peak', peak.toFixed(2));
