import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = path.resolve('src/lib/identity');
const source = await readFile(path.join(sourceDir, 'liquidGlass.ts'), 'utf8');
const result = await build({
  stdin: { contents: source + '\nexport { dotField };', resolveDir: sourceDir, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { dotField, createLiquidGlass, LIQUID_GLASS_DEFAULTS } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const params = { ...LIQUID_GLASS_DEFAULTS, wordmark: 0 }; // gradient source by default
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
const hue = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 1e-9) { if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)); else if (mx === g) h = ((b - r) / d + 2); else h = ((r - g) / d + 4); } return h * 60; };
const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

// motion=5 CIRCULATES the gradient via a reversal weight (swapRev∈[0,1]): 0=正順(inner teal),
// 1=反転(inner violet). Colour stays ON the teal→violet line, so no 3rd colour (green) appears.

// 1. Geometry identical to standard; only swapRev (colour) and shade (opacity) are modulated.
for (const phase of [0, 0.2, 0.5, 0.75]) {
  const std = dotField({ ...params, motion: 1 }, phase);
  const wave = dotField({ ...params, motion: 5 }, phase);
  assert.equal(std.length, wave.length);
  std.forEach((d, i) => { for (const k of ['x', 'y', 'i', 'sr', 'ang', 'even']) near(d[k], wave[i][k]); });
}
// 2. swapRev & shade are radial (angle-free): same sr → same swapRev/shade regardless of angle.
{
  const wave = dotField({ ...params, motion: 5 }, 0.15);
  const sh = wave.map(d => d.shade);
  assert.ok(Math.min(...sh) < 0.95 && Math.max(...sh) > 1.05, 'shade must pulse');
  const byR = new Map();
  for (const d of wave) { const k = d.sr.toFixed(4); if (byR.has(k)) { near(byR.get(k)[0], d.swapRev, 1e-9); near(byR.get(k)[1], d.shade, 1e-9); } else byR.set(k, [d.swapRev, d.shade]); }
}
// 2b. FULL circulation: over the loop swapRev reaches ~0 (inner teal / 正順) AND ~1 (inner violet /
//     反転) — i.e. the outer colour genuinely reaches the inside. Also swapRev ∈ [0,1] always.
{
  let lo = 1, hi = 0;
  for (let k = 0; k < 24; k++) {
    for (const d of dotField({ ...params, motion: 5 }, k / 24)) {
      assert.ok(d.swapRev >= -1e-9 && d.swapRev <= 1 + 1e-9, `swapRev must stay in [0,1], got ${d.swapRev}`);
      if (d.swapRev < lo) lo = d.swapRev;
      if (d.swapRev > hi) hi = d.swapRev;
    }
  }
  assert.ok(lo < 0.05, `swapRev must reach ~0 (正順/inner teal), min=${lo.toFixed(3)}`);
  assert.ok(hi > 0.95, `swapRev must reach ~1 (反転/inner violet=outer colour inside), max=${hi.toFixed(3)}`);
}
// 3. inflow=0 disables → swapRev 0 (正順) and shade 1 everywhere (equals standard).
for (const phase of [0, 0.4, 0.93]) {
  const w = dotField({ ...params, motion: 5, inflow: 0 }, phase);
  assert.ok(w.every(d => d.swapRev === 0 && d.shade === 1), 'inflow=0 must fully disable motion=5');
}
// 4. Circulation travels (animates): same dot changes swapRev across phases.
const w0 = dotField({ ...params, motion: 5 }, 0);
const midById = new Map(dotField({ ...params, motion: 5 }, 0.37).map(d => [d.id, d]));
let moved = 0, common = 0;
for (const d of w0) { const m = midById.get(d.id); if (!m) continue; common++; if (Math.abs(d.swapRev - m.swapRev) > 0.1) moved++; }
assert.ok(moved > common * 0.3, `circulation must animate: only ${moved}/${common} dots changed`);
// 5. Seamless loop + deterministic seek.
const loopA = dotField({ ...params, motion: 5 }, 0), loopB = dotField({ ...params, motion: 5 }, 1);
loopA.forEach((d, i) => { for (const k of ['x', 'y', 'i', 'sr', 'ang', 'shade', 'even', 'swapRev']) near(d[k], loopB[i][k], 1e-6); });
const at = dotField({ ...params, motion: 5 }, 0.317);
dotField({ ...params, motion: 5 }, 0.8);
assert.deepEqual(dotField({ ...params, motion: 5 }, 0.317), at);

// ── Render-level checks (real colour path) ───────────────────────────────
const contexts = [];
function context() {
  const ctx = {
    dots: [], fillStyle: '', globalAlpha: 1,
    save() {}, restore() {}, setTransform() {}, scale() {},
    clearRect() { this.dots = []; }, fillRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, drawImage() {},
    createRadialGradient() { return { addColorStop() {} }; }, createLinearGradient() { return { addColorStop() {} }; },
    getImageData(_x, _y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    arc(x, y, rx) { this.ellipse(x, y, rx, rx, 0); },
    ellipse(x, y, rx, ry, angle) { const rgba = this.fillStyle.match(/[\d.]+/g).map(Number); this.dots.push({ x, y, color: rgba.slice(0, 3), opacity: rgba[3] }); },
  };
  contexts.push(ctx); return ctx;
}
globalThis.document = { createElement() { return { width: 0, height: 0, getContext: () => context() }; } };
const renderer = createLiquidGlass(), canvas = context();
function render(p, phase, size = 720) { for (const c of contexts) c.dots = []; renderer.render(canvas, size, size, phase, p); return contexts.flatMap(c => c.dots); }
const flat = { ...params, dotGlow: 0, dotBlur: 0 };
const key = d => `${d.x.toFixed(2)},${d.y.toFixed(2)}`;
// Swap recolours a band of dots vs standard, AND never introduces a 3rd colour: every saturated
// dot hue stays within the teal(≈174°)→violet(≈264°) gradient range — no green (hue<170).
const std = render({ ...flat, motion: 1 }, 0.25);
const wave = render({ ...flat, motion: 5 }, 0.25);
const stdByPos = new Map(std.map(d => [key(d), d]));
let recoloured = 0, matched = 0, greenDots = 0, outOfRange = 0;
for (const ph of [0, 0.15, 0.3, 0.45]) {
  for (const d of render({ ...flat, motion: 5 }, ph)) {
    const [r, g, b] = d.color; if (sat(r, g, b) < 0.25) continue;
    const h = hue(r, g, b);
    if (h >= 80 && h < 168) greenDots++;                 // greener than teal = a 3rd colour
    if (h < 168 || h > 270) outOfRange++;                // outside teal→violet gradient span
  }
}
for (const d of wave) { const s = stdByPos.get(key(d)); if (!s) continue; matched++; if (Math.hypot(d.color[0] - s.color[0], d.color[1] - s.color[1], d.color[2] - s.color[2]) > 12) recoloured++; }
assert.ok(recoloured > matched * 0.2, `swap must recolour dots: only ${recoloured}/${matched}`);
assert.equal(greenDots, 0, `no dot may turn green (3rd colour): ${greenDots} green dots`);
assert.equal(outOfRange, 0, `all dot hues must stay within teal→violet: ${outOfRange} out of range`);

// Canvas/SVG parity for motion=5.
let cases = 0;
for (const phase of [0, 0.125, 0.5, 0.875]) {
  const p = { ...flat, motion: 5 };
  const drawn = render(p, phase);
  const svg = renderer.toSvg({ params: p, phase, loopSeconds: 12 });
  assert.ok(!/NaN|Infinity/.test(svg));
  const shapes = [...svg.matchAll(/<(circle|ellipse)\s+([^>]+)\/>/g)].map(([, , attr]) => { const a = Object.fromEntries([...attr.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])); return { x: +a.cx, opacity: +a.opacity }; });
  assert.equal(drawn.length, shapes.length);
  drawn.forEach((d, i) => { near(d.x, shapes[i].x, 0.051); near(d.opacity, shapes[i].opacity, 0.0011); });
  cases++;
}

// ── Accent: motion=5 uses ONLY the two base colours, and they swap ───────
const withWord = { ...params, wordmark: 1 };
function accentFills(p, phase) {
  const svg = renderer.toSvg({ params: p, phase, loopSeconds: 12 });
  return [...svg.matchAll(/<path d="[^"]*" fill="([^"]*)"\/>/g)].map(m => m[1].toLowerCase()).filter(f => f !== '#000000');
}
for (const motion of [1, 2, 3]) {
  const f = accentFills({ ...withWord, motion }, 0.3);
  assert.equal(f.length, 4);
  assert.ok(f.every(c => c === f[0]), `motion ${motion} accent must stay single-colour`);
}
const TEAL = '#17f0d9', VIOLET = '#6a2bff';
// Accent invariant: at EVERY phase the two arcs are complementary (one teal, one violet) — the
// "same colour on both arcs" state must never occur — and both arrangements are visited (it swaps).
const seenArr = new Set();
for (let k = 0; k <= 48; k++) {
  const phase = k / 48;
  const f = accentFills({ ...withWord, motion: 5 }, phase);
  assert.equal(f.length, 4);
  assert.ok(f.every(c => c === TEAL || c === VIOLET), `accent must be ONLY the 2 base colours, got ${f}`);
  assert.equal(f[0], f[2], 'inner arcs symmetric');
  assert.equal(f[1], f[3], 'outer arcs symmetric');
  assert.notEqual(f[0], f[1], `inner and outer arcs must never be the same colour (phase ${phase.toFixed(3)}: ${f})`);
  seenArr.add(f[0] + '|' + f[1]);
}
assert.ok(seenArr.has(`${TEAL}|${VIOLET}`) && seenArr.has(`${VIOLET}|${TEAL}`),
  `accent must repeat BOTH 2-colour arrangements, saw ${[...seenArr]}`);
// inflow=0 → static rest: inner teal / outer violet.
const rest = accentFills({ ...withWord, motion: 5, inflow: 0 }, 0.3);
assert.deepEqual(rest, [TEAL, VIOLET, TEAL, VIOLET], 'inflow=0 → inner teal / outer violet');

console.log(`PASS: motion=5 swaps teal↔violet on the gradient line (recoloured ${recoloured}/${matched}, green dots ${greenDots}, out-of-range ${outOfRange}), radial & seamless, ${cases} Canvas/SVG parity; accent = complementary 2-colour ripple (never same colour, both arrangements ${[...seenArr].length})`);
