// Sound design for the 10-lessons reel: a music stem and an SFX stem, both driven by out/timeline.json.
// Pure synthesis (no samples): filtered noise, FM/additive tones, a Schroeder reverb bus.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TL = JSON.parse(readFileSync(path.join(here, 'out/timeline.json'), 'utf8'));
const S = TL.scenes.map((s) => s.start);           // scene start times
const SR = 44100, DUR = 15, N = SR * DUR, BEAT = .5;
const mk = () => [new Float32Array(N), new Float32Array(N)];
const SFX = mk(), WET = mk(), MUS = mk();
let seed = 4242; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const sine = (f, t) => Math.sin(2 * Math.PI * f * t);

// add(): render fn(t, progress) into a bus with gain/pan, and optionally send to the reverb
function add(t0, dur, fn, { g = 1, pan = 0, send = 0, bus = SFX } = {}) {
  const s = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  const gl = g * Math.cos((pan + 1) * Math.PI / 4), gr = g * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n; i++) {
    const k = s + i; if (k < 0 || k >= N) continue;
    const v = fn(i / SR, i / n);
    bus[0][k] += v * gl; bus[1][k] += v * gr;
    if (send) { WET[0][k] += v * gl * send; WET[1][k] += v * gr * send; }
  }
}
// state-variable filter (bandpass out) helper
function svf() { let low = 0, band = 0; return (x, fc, q = .8) => { const f = Math.min(.8, 2 * Math.sin(Math.PI * Math.min(fc, SR * .45) / SR)); low += f * band; const high = x - low - q * band; band += f * high; band = Math.max(-6, Math.min(6, band)); low = Math.max(-6, Math.min(6, low)); return band; }; }
function lpf() { let y = 0; return (x, a) => (y += a * (x - y)); }

/* ---------------- SFX building blocks ---------------- */
function impact(t0, g = 1) {                                  // sub boom + noise body + crack
  add(t0, 1.8, (t) => sine(34 + 70 * Math.exp(-t * 9), t) * Math.exp(-t * 2.3) * Math.min(1, t * 400), { g: 1.0 * g, send: .15 });
  const lp = lpf(); add(t0, .8, (t) => lp(rnd(), .1) * Math.exp(-t * 5.5), { g: 1.2 * g, send: .3 });
  add(t0, .06, (t) => rnd() * Math.exp(-t * 90), { g: .4 * g, send: .2 });
}
function whoosh(t0, dur = .4, { up = true, g = 1, pan = 0 } = {}) {
  const f = svf(); const pk = Math.sin;
  add(t0, dur, (t, p) => { const q = up ? p : 1 - p; return f(rnd(), 250 + 7000 * q * q, .55) * 2.2 * Math.pow(Math.sin(Math.PI * p), 1.3) * (up ? .4 + p : 1.4 - p); }, { g: .45 * g, pan, send: .12 });
}
function riser(t0, dur, g = 1) {
  const f = svf(); let ph = 0;
  add(t0, dur, (t, p) => { ph += 2 * Math.PI * (180 + 1500 * p * p) / SR; return (f(rnd(), 400 + 9000 * p * p, 1.2) * 1.6 + Math.sin(ph) * .22) * p * p; }, { g: .5 * g, send: .1 });
}
function thud(t0, g = 1, f0 = 110) { add(t0, .22, (t) => sine(f0 * (.55 + .45 * Math.exp(-t * 30)), t) * Math.exp(-t * 18), { g: .8 * g, send: .08 }); add(t0, .02, (t) => rnd() * Math.exp(-t * 200), { g: .3 * g }); }
function key(t0, g = 1, pan = 0) {                            // typewriter key: click + thock
  const hp = lpf(); add(t0, .035, (t) => (rnd() - hp(rnd(), .3)) * Math.exp(-t * 170), { g: .5 * g, pan });
  add(t0, .05, (t) => sine(170 + 40 * Math.exp(-t * 80), t) * Math.exp(-t * 85), { g: .4 * g, pan });
}
function bell(t0, f, g = 1, send = .5) {
  add(t0, 1.6, (t) => (sine(f, t) + .45 * sine(f * 2.76, t) * Math.exp(-t * 3) + .25 * sine(f * 5.4, t) * Math.exp(-t * 6)) * Math.exp(-t * 2.8) * Math.min(1, t * 800), { g: .35 * g, send, pan: rnd() * .3 });
}
function scribble(t0, dur, g = 1, pan = 0) {                   // pencil on paper
  const f = svf(), r = [rnd(), rnd(), rnd()].map(x => 7 + Math.abs(x) * 9);
  add(t0, dur, (t, p) => f(rnd(), 3800 + 900 * Math.sin(t * 31), 2.2) * (.5 + .5 * Math.abs(Math.sin(t * r[0] * 2))) * Math.pow(Math.sin(Math.PI * p), .4) * 2.2, { g: .3 * g, pan });
}
function pop(t0, f, g = 1, pan = 0) { add(t0, .14, (t) => sine(f * (1 + .9 * Math.exp(-t * 55)), t) * Math.exp(-t * 32), { g: .5 * g, pan, send: .2 }); }
function blip(t0, f, g = 1, pan = 0) { add(t0, .16, (t) => (sine(f * (1 - .5 * t * 5), t) + .3 * sine(f * 2, t)) * Math.exp(-t * 26), { g: .4 * g, pan, send: .25 }); }
function sparkle(t0, g = 1) { for (let i = 0; i < 7; i++) { const tt = t0 + i * .035, f = 2400 + Math.abs(rnd()) * 5200; add(tt, .25, (t) => sine(f, t) * Math.exp(-t * 20), { g: .12 * g, pan: rnd() * .8, send: .5 }); } }
function glitch(t0, dur = .18, g = 1) {                        // bit-crushed stutter
  let hold = 0; add(t0, dur, (t, p) => { if (Math.floor(t * 900) % 2 === 0) hold = rnd(); return Math.sign(hold) * (Math.abs(hold) > .35 ? 1 : 0) * (Math.floor(t * 70) % 2 ? 1 : .3) * (1 - p); }, { g: .16 * g, pan: rnd() * .5 });
}
function tick(t0, f = 1800, g = 1) { add(t0, .03, (t) => sine(f, t) * Math.exp(-t * 130), { g: .35 * g }); }

/* ---------------- music bed (120 bpm, A minor) ---------------- */
function mKick(t0, g = 1) { let ph = 0; add(t0, .35, (t) => { ph += 2 * Math.PI * (45 + 125 * Math.exp(-t * 30)) / SR; return Math.sin(ph) * Math.exp(-t * 9) * Math.min(1, t * 900); }, { g: .8 * g, bus: MUS }); }
function mHat(t0, g = 1, open = false) { const hp = lpf(); add(t0, open ? .16 : .045, (t) => (rnd() - hp(rnd(), .25)) * Math.exp(-t * (open ? 20 : 75)), { g: .12 * g, pan: .3, bus: MUS }); }
function mClap(t0, g = 1) { for (const o of [0, .011, .022]) { const lp = lpf(); add(t0 + o, .12, (t) => lp(rnd(), .5) * Math.exp(-t * (o === .022 ? 22 : 90)), { g: .4 * g, bus: MUS, send: .1 }); } }
function mBass(t0, f, dur = .22, g = 1) { let ph = 0; add(t0, dur, (t) => { ph += 2 * Math.PI * f / SR; const saw = (ph / Math.PI) % 2 - 1; return (Math.sin(ph) * .8 + saw * .22 * Math.exp(-t * 14)) * Math.min(1, t * 400) * Math.exp(-t * 6); }, { g: .55 * g, bus: MUS }); }
function mPad(t0, dur, freqs, g = 1) { for (const f of freqs) add(t0, dur, (t, p) => (sine(f, t) + sine(f * 1.004, t) * .8) * Math.min(1, t * 5) * Math.min(1, (1 - p) * 6), { g: .04 * g, pan: rnd() * .5, bus: MUS, send: .2 }); }

const A1 = 55, notes = [A1, A1, A1 * 1.5, A1, A1 * 4 / 3, A1, A1 * 1.5, A1 * 1.2];
const nice = 7, boring = 8, last = 9; // scene indices of the stripped-back moment and the finale
const dropStart = S[boring] - .02, dropEnd = S[last];

for (let b = 2; b < 30; b++) {
  const t = b * BEAT, quiet = t >= dropStart && t < dropEnd;
  if (quiet) continue;                                      // music drops out for "Be boring."
  mKick(t, b < 4 ? .7 : 1);
  if (b % 2 === 1 && b >= 4) mClap(t, .85);
  mHat(t + .25, 1, b % 4 === 3);
  if (t >= 4) { mHat(t + .125, .4); mHat(t + .375, .4); }
  if (b >= 3) { mBass(t, notes[b % 8], .22); mBass(t + .25, notes[(b + 3) % 8] * (b % 2 ? 2 : 1), .15, .8); }
}
[[S[1], [110, 164.8, 196, 261.6]], [S[3], [87.3, 130.8, 174.6, 220]], [S[5], [98, 146.8, 196, 246.9]], [S[7] - .0, [110, 164.8, 220, 329.6]]]
  .forEach(([t, ch]) => { const end = Math.min(t + 3.2, dropStart); if (end > t) mPad(t, end - t, ch, 1); });
// after the drop: the finale chord
mPad(S[last], 15 - S[last], [110, 164.8, 220, 277.2, 329.6], 1.6);

/* ---------------- SFX design, scene by scene ---------------- */
// every cut: swoosh into it (alternating direction) + a tight hit on it
for (let i = 1; i < S.length; i++) {
  whoosh(S[i] - .2, .26, { up: i % 2 === 1, pan: i % 2 ? -.5 : .5, g: .9 });
  thud(S[i], .8, i % 2 ? 100 : 130);
}
// 1 — STEAL: big impact, glitch stutter, shimmer on "like an artist"
impact(0.0, 1.4); glitch(.30, .14, .8); glitch(.52, .08, .6); whoosh(.18, .3, { up: false, g: .8 }); sparkle(S[0] + .5, .9);
// 2 — four stacked lines slam in, then underline + play button
[.05, .38, .72, .98].forEach((o, i) => { thud(S[1] + o, 1, 150 - i * 12); whoosh(S[1] + o - .05, .22, { up: i % 2 === 0, pan: i % 2 ? .6 : -.6, g: .7 }); });
whoosh(S[1] + 1.2, .3, { g: .6 }); pop(S[1] + 1.6, 880, 1); bell(S[1] + 1.65, 1319, .6);
// 3 — typewriter, marker swipe, carriage bell
for (let i = 0; i < 29; i++) key(S[2] + .08 + i / 30, .9 + .2 * rnd(), rnd() * .35);
whoosh(S[2] + .95, .25, { g: .7 }); bell(S[2] + 1.1, 2093, .5, .6);
// 4 — pencil scribbles and the ink fill
scribble(S[3] + .02, .4, 1, -.5); scribble(S[3] + .25, .5, .8, .6); scribble(S[3] + .45, .4, .9, .1); scribble(S[3] + .55, .4, .8, -.2);
whoosh(S[3] + .45, .3, { g: .6 }); pop(S[3] + .93, 1568, .7);
// 5 — orbiting shapes pop in as a rising arpeggio, orbit whirl underneath
[0, 2, 4, 5, 7, 9].forEach((st, i) => pop(S[4] + .2 + i * .09, 523.25 * Math.pow(2, st / 12), 1, (i - 2.5) / 3.5));
{ const f = svf(); add(S[4] + .3, 1.4, (t, p) => f(rnd(), 500 + 600 * Math.sin(t * 8) + 1200 * p, 1.4) * Math.sin(Math.PI * p) * 1.4, { g: .22, pan: .0, send: .2 }); }
// 6 — underline stroke, then the share ripples + node pings
scribble(S[5] + .25, .25, .6, -.3); bell(S[5] + .85, 659.3, .8);
[0, .25, .5].forEach((o, i) => { add(S[5] + .85 + o, .5, (t) => sine(220 * (1 + i * .5), t) * Math.exp(-t * 5), { g: .18, send: .5 }); });
for (let i = 0; i < 12; i++) blip(S[5] + .95 + i * .075, 700 + (i % 6) * 150 + 40 * i, .6, rnd() * .8);
// 7 — globe spin-up, arcs zipping across
{ const f = svf(); add(S[6], 1.2, (t, p) => f(rnd(), 300 + 1800 * p, 1.6) * Math.sin(Math.PI * Math.min(1, p * 1.1)) * 1.8, { g: .25, send: .2 }); }
for (let k = 0; k < 6; k++) whoosh(S[6] + .45 + k * .1, .22, { up: true, g: .55, pan: (k - 2.5) / 3 });
sparkle(S[6] + .7, .8);
// 8 — "Be nice": bouncy boing + smile sparkle
{ let ph = 0; add(S[7] + .05, .5, (t) => { ph += 2 * Math.PI * (300 + 220 * Math.sin(t * 38) * Math.exp(-t * 6) + 380 * Math.exp(-t * 10)) / SR; return Math.sin(ph) * Math.exp(-t * 6); }, { g: .3, send: .2 }); }
sparkle(S[7] + .35, .9); bell(S[7] + .4, 1760, .45);
// 9 — "Be boring": deadpan metronome, progress ticks, success ding; riser into the finale
for (let i = 0; i < 4; i++) tick(S[8] + .1 + i * .22, 900, 1);
for (let i = 0; i < 16; i++) tick(S[8] + .2 + i * .035, 2600, .45);
bell(S[8] + .78, 1046.5, .9, .6); bell(S[8] + .83, 1568, .6, .6);
riser(S[8] + .3, S[9] - S[8] - .3 + .02, 1.1);
// 10 — dots subtracted (descending bloops), the last dot rings, the finale hit and tail
for (let i = 0; i < 30; i++) blip(S[9] + .35 + Math.abs(rnd()) * .6, 1500 - i * 28, .5, rnd() * .8);
impact(S[9] + 1.0, 1.1); bell(S[9] + 1.02, 329.6, 1, .7); bell(S[9] + 1.04, 659.3, .6, .7); sparkle(S[9] + 1.15, 1);
add(S[9] + 1.0, 15 - S[9] - 1.0, (t, p) => (sine(110, t) + sine(164.8, t) * .5) * Math.exp(-t * 1.6), { g: .12, send: .3 });

/* ---------------- reverb bus (Schroeder: 8 combs + 2 all-passes per side) ---------------- */
function reverb(src, spread) {
  const out = new Float32Array(N), cd = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((d) => Math.round((d + spread) * SR / 44100 * 1.15));
  const lp = new Float32Array(cd.length);
  cd.forEach((d, c) => { const buf = new Float32Array(d); let idx = 0; for (let i = 0; i < N; i++) { const y = buf[idx]; lp[c] += .35 * (y - lp[c]); buf[idx] = src[i] * .1 + lp[c] * .86; out[i] += y; if (++idx === d) idx = 0; } });
  for (const d of [225 + spread, 556 + spread]) { const buf = new Float32Array(d); let idx = 0; for (let i = 0; i < N; i++) { const b = buf[idx], x = out[i]; buf[idx] = x + b * .5; out[i] = b - x * .5 + 0 * x; if (++idx === d) idx = 0; } }
  return out;
}
const rvL = reverb(WET[0], 0), rvR = reverb(WET[1], 23);

/* ---------------- master per stem ---------------- */
function writeWav(name, L, R, gain) {
  let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const norm = gain / Math.max(peak, 1e-6), buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * norm * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * norm * 32767), 46 + i * 4); }
  writeFileSync(path.join(here, 'out', name), buf); console.log(name, 'peak', peak.toFixed(2));
}
const fade = (t) => Math.min(1, t * 100) * Math.min(1, (DUR - t) * 5);
// SFX stem = dry SFX + reverb return; music stem = music + a touch of its own sends (none)
const sL = new Float32Array(N), sR = new Float32Array(N), mL = new Float32Array(N), mR = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const f = fade(i / SR);
  sL[i] = Math.tanh((SFX[0][i] + rvL[i] * .9) * 1.0) * f; sR[i] = Math.tanh((SFX[1][i] + rvR[i] * .9) * 1.0) * f;
  mL[i] = Math.tanh(MUS[0][i] * 1.1) * f; mR[i] = Math.tanh(MUS[1][i] * 1.1) * f;
}
writeWav('sfx2.wav', sL, sR, .8); writeWav('music2.wav', mL, mR, .8);
