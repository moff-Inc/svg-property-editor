import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = path.resolve('src/lib/identity');
const source = await readFile(path.join(sourceDir, 'liquidGlass.ts'), 'utf8');
const result = await build({
  stdin: { contents: source + '\nexport { accentAlphaCycles, accentOpacityPair, accentRipple, applyDotAppearance, dotField, flowDotField, gradWindow, gradientRgb, innerRgb, introGraphicParams, introParticleParams, introTiming, motionDirection, ripplePhase, wordmarkLetterScales, wordmarkRevealTiming };', resolveDir: sourceDir, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { accentAlphaCycles, accentOpacityPair, accentRipple, applyDotAppearance, dotField, flowDotField, gradWindow, gradientRgb, innerRgb, introGraphicParams, introParticleParams, introTiming, motionDirection, ripplePhase, wordmarkLetterScales, wordmarkRevealTiming, createLiquidGlass, LIQUID_GLASS_DEFAULTS } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const params = { ...LIQUID_GLASS_DEFAULTS, wordmark: 0 }; // gradient source by default
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
const hue = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 1e-9) { if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)); else if (mx === g) h = ((b - r) / d + 2); else h = ((r - g) / d + 4); } return h * 60; };
const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

const latestSavedDefaults = {
  zoom: 0.65, bg: '#000000', hexR: 0.165, density: 150, ringR: 0.475,
  thickness: 0.475, fieldBlur: 0.175, threshold: 0.25, wave: 0.6,
  dotAspect: 1, fieldRot: 0, dotAlpha: 1, accentAlpha: 1,
  accentInnerAlpha: 0.41, accentOuterAlpha: 0.4, accentAlphaMotion: 1,
  accentAlphaCycles: 6, dotBlur: 0, dotGlow: 0.25, dotGlowSize: 11,
  gradStart: 0.15, gradLumaEven: 0, innerBright: 1.51, animA: 2,
  rippleCycles: 2, wmSize: 0.75, wmX: 0.66, wmY: 0.51, gfxX: 0.045,
  intro: 1, introWordSeconds: 4, introDimStartSeconds: 1.5, introDimSpeed: 1,
  introLetterScale: 1.1, introAccentSeconds: 4, introAccentStartOffset: -3.8,
  transparent: 1,
};
for (const [key, value] of Object.entries(latestSavedDefaults)) {
  assert.equal(LIQUID_GLASS_DEFAULTS[key], value, `latest SAVE default mismatch: ${key}`);
}

// Accent opacity motion: OFF preserves the configured endpoints; ON smoothly swaps them and
// returns to the exact starting state at the loop seam. Integer cycles provide loop-safe speed.
{
  const base = { ...LIQUID_GLASS_DEFAULTS, accentInnerAlpha: 0.2, accentOuterAlpha: 0.8, accentAlphaMotion: 0 };
  assert.deepEqual(accentOpacityPair(base, 0.37), { inner: 0.2, outer: 0.8 });
  const animated = { ...base, accentAlphaMotion: 1, accentAlphaCycles: 1 };
  assert.deepEqual(accentOpacityPair(animated, 0), { inner: 0.2, outer: 1 });
  const swapped = accentOpacityPair(animated, 0.5);
  near(swapped.inner, 1);
  near(swapped.outer, 0.8);
  const seam = accentOpacityPair(animated, 1);
  near(seam.inner, 0.2);
  near(seam.outer, 1);
  const oneCycleQuarter = accentOpacityPair(animated, 0.25);
  near(oneCycleQuarter.inner, 0.6);
  near(oneCycleQuarter.outer, 0.9);
  const twoCyclesQuarter = accentOpacityPair({ ...animated, accentAlphaCycles: 2 }, 0.25);
  near(twoCyclesQuarter.inner, 1);
  near(twoCyclesQuarter.outer, 0.8);
  assert.equal(accentAlphaCycles({ ...animated, accentAlphaCycles: 2.4 }), 2);
  assert.equal(accentAlphaCycles({ ...animated, accentAlphaCycles: 99 }), 6);

  let previous = accentOpacityPair(animated, 0);
  let maxStep = 0;
  for (let k = 1; k <= 1000; k++) {
    const current = accentOpacityPair(animated, k / 1000);
    maxStep = Math.max(maxStep, Math.abs(current.inner - previous.inner), Math.abs(current.outer - previous.outer));
    previous = current;
  }
  assert.ok(maxStep < 0.003, `opacity exchange must be smooth, max step=${maxStep}`);

  const opaque = { ...animated, accentInnerAlpha: 1, accentOuterAlpha: 1 };
  for (const phase of [0, 0.125, 0.37, 0.5, 0.875, 1]) {
    assert.deepEqual(accentOpacityPair(opaque, phase), { inner: 1, outer: 1 },
      `opacity 1 must remain fully opaque at phase ${phase}`);
  }
}

// Intro-only graphic settings: mode 5, three cycles, and the opposite rotation direction.
{
  const intro = introGraphicParams(LIQUID_GLASS_DEFAULTS);
  assert.equal(intro.motion, 5);
  assert.equal(intro.rippleCycles, 3);
  assert.equal(intro.animA, 3);
  assert.equal(intro.animB, 3);
  assert.equal(motionDirection(5), -1);
  assert.equal(motionDirection(1), 1);

  // The intro field remains seamless across a full phase cycle.
  const start = dotField(intro, 0);
  const settled = dotField(intro, 1);
  start.forEach((dot, i) => {
    for (const key of ['x', 'y', 'i', 'sr', 'ang', 'shade', 'even', 'swapRev']) {
      near(dot[key], settled[i][key], 1e-6);
    }
  });
}

// Pattern 2 morphs the initial graphic into a softer, more turbulent particle field while
// preserving deterministic endpoints and stable particle IDs.
{
  const particle = introParticleParams(LIQUID_GLASS_DEFAULTS);
  assert.equal(particle.motion, 3);
  assert.ok(particle.fieldBlur >= 0.36);
  assert.ok(particle.turbulence >= 2.2);
  assert.ok(particle.contrast <= 0.9);
  const expected = dotField(particle, 0.23);
  const actual = flowDotField(LIQUID_GLASS_DEFAULTS, 0.23, {
    progress: 1, travel: 0, target: 'particles', colorMix: 1, color: '#000000',
  });
  assert.deepEqual(actual, expected, 'pattern 2 morph endpoint must equal the particle field');
  assert.deepEqual(
    flowDotField(LIQUID_GLASS_DEFAULTS, 0.23, { progress: 0.5, travel: 0, target: 'particles' }),
    flowDotField(LIQUID_GLASS_DEFAULTS, 0.23, { progress: 0.5, travel: 0, target: 'particles' }),
    'pattern 2 particle morph must be deterministic',
  );
}

// Adjustable D/E durations change the real intro length.
{
  const timing = introTiming(LIQUID_GLASS_DEFAULTS);
  assert.equal(timing.wordSeconds, 4);
  assert.equal(timing.accentSeconds, 4);
  assert.equal(timing.accentStartOffset, -3.8);
  near(timing.accentStart, 9.4);
  near(timing.total, 13.4);
  const custom = introTiming({ ...LIQUID_GLASS_DEFAULTS, introWordSeconds: 2.5, introAccentSeconds: 1.5, introAccentStartOffset: 0 });
  near(custom.total, 13.2);
  const overlap = introTiming({ ...LIQUID_GLASS_DEFAULTS, introAccentStartOffset: -1 });
  near(overlap.accentStart, 12.2);
  near(overlap.total, 16.2);
  const delayed = introTiming({ ...LIQUID_GLASS_DEFAULTS, introAccentStartOffset: 1 });
  near(delayed.accentStart, 14.2);
  near(delayed.total, 18.2);
  const particle = introTiming({ ...LIQUID_GLASS_DEFAULTS, introPattern: 2 });
  near(particle.particleMorphEnd, 6.8);
  near(particle.wordStart, 6.8);
  near(particle.wordEnd, 10.8);
  near(particle.graphicEnd, 13.2);
  near(particle.accentStart, 7);
  near(particle.total, 13.2);
  assert.ok(particle.wordEnd < particle.graphicEnd, 'the second graphic must appear only after the word is complete');
}

// Intro section E finishes after exactly the second visible accent ripple and connects at alpha=1.
{
  let darkRuns = 0;
  let wasDark = false;
  for (let k = 0; k <= 1000; k++) {
    const alpha = accentRipple(k / 1000)[0];
    const dark = alpha < 0.5;
    if (dark && !wasDark) darkRuns++;
    wasDark = dark;
  }
  assert.equal(darkRuns, 2, 'intro accent must end after its second ripple');
  assert.deepEqual(accentRipple(0), [1, 1, 1, 1]);
  assert.deepEqual(accentRipple(1), [1, 1, 1, 1]);
}

// Reference text reveal: dim glyphs lead, bright glyphs follow, both finish without a jump.
{
  const revealBase = { ...LIQUID_GLASS_DEFAULTS, introDimStartSeconds: 0 };
  let previous = wordmarkRevealTiming(0, revealBase);
  assert.deepEqual(previous, { dim: 0, bright: 0 });
  for (let k = 1; k <= 100; k++) {
    const current = wordmarkRevealTiming(k / 100, revealBase);
    assert.ok(current.dim >= previous.dim && current.bright >= previous.bright, 'wordmark reveal must be monotonic');
    assert.ok(current.dim + 1e-9 >= current.bright, 'dim precursor must lead the bright text');
    previous = current;
  }
  assert.deepEqual(wordmarkRevealTiming(1, revealBase), { dim: 1, bright: 1 });
  const early = wordmarkRevealTiming(0.1, revealBase);
  assert.ok(early.dim > early.bright && early.dim > 0, 'dim text must appear before the bright pass');
  assert.equal(wordmarkRevealTiming(0.3, LIQUID_GLASS_DEFAULTS).dim, 0,
    'latest SAVE dim layer must wait for its configured 1.5 second start');
  const slow = wordmarkRevealTiming(0.2, { ...revealBase, introDimSpeed: 0.5 }).dim;
  const fast = wordmarkRevealTiming(0.2, { ...revealBase, introDimSpeed: 2 }).dim;
  assert.ok(fast > slow, 'higher dim speed must reveal the precursor faster');
}

// Each glyph briefly starts at 1.1x when its left-to-right reveal begins, then returns to 1x.
{
  assert.deepEqual(wordmarkLetterScales(0, LIQUID_GLASS_DEFAULTS), Array(10).fill(1));
  assert.deepEqual(wordmarkLetterScales(1, LIQUID_GLASS_DEFAULTS), Array(10).fill(1));
  const maxima = Array(10).fill(1);
  let foundStaggeredFrame = false;
  for (let k = 0; k <= 1000; k++) {
    const scales = wordmarkLetterScales(k / 1000, LIQUID_GLASS_DEFAULTS);
    assert.equal(scales.length, 10);
    scales.forEach((scale, i) => {
      assert.ok(scale >= 1 && scale <= 1.100001, `letter ${i} scale out of range: ${scale}`);
      maxima[i] = Math.max(maxima[i], scale);
    });
    const active = scales.filter(scale => scale > 1.001).length;
    if (active > 0 && active < scales.length) foundStaggeredFrame = true;
  }
  assert.ok(maxima.every(scale => scale > 1.099), `every letter must reach 1.1x: ${maxima.join(', ')}`);
  assert.ok(foundStaggeredFrame, 'letter pops must be staggered rather than scaling the whole wordmark');
  const adjustableMaxima = Array(10).fill(1);
  for (let k = 0; k <= 1000; k++) {
    wordmarkLetterScales(k / 1000, { ...LIQUID_GLASS_DEFAULTS, introLetterScale: 1.5 })
      .forEach((scale, i) => { adjustableMaxima[i] = Math.max(adjustableMaxima[i], scale); });
  }
  assert.ok(adjustableMaxima.every(scale => scale > 1.499 && scale <= 1.5),
    `every letter must support a 1.5x peak: ${adjustableMaxima.join(', ')}`);
}

// motion=5 CIRCULATES the gradient via a reversal weight (swapRev∈[0,1]): 0=正順(inner teal),
// 1=反転(inner violet). Colour stays ON the teal→violet line, so no 3rd colour (green) appears.

// 1. Geometry matches standard at the opposite phase: mode 5 keeps the same field while rotating
// in the reverse direction; only swapRev (colour) and shade (opacity) are additionally modulated.
for (const phase of [0, 0.2, 0.5, 0.75]) {
  const std = dotField({ ...params, motion: 1 }, (1 - phase) % 1);
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
// 4b. Adjustable loop speed: 6 waves repeat after 1/6 loop, while 1 wave has only advanced 1/6.
{
  const stable = { ...params, animA: 0, animB: 0 };
  const fast0 = dotField({ ...stable, rippleCycles: 6 }, 0);
  const fastRepeat = dotField({ ...stable, rippleCycles: 6 }, 1 / 6);
  fast0.forEach((d, i) => { near(d.swapRev, fastRepeat[i].swapRev, 1e-6); near(d.shade, fastRepeat[i].shade, 1e-6); });
  const slow = dotField({ ...stable, rippleCycles: 1 }, 1 / 6);
  const changed = fast0.filter((d, i) => Math.abs(d.swapRev - slow[i].swapRev) > 0.1).length;
  assert.ok(changed > fast0.length * 0.4, `1 wave/loop must be slower than 6 waves/loop: ${changed}/${fast0.length}`);
}
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
    dots: [], gradients: [], fillStyle: '', globalAlpha: 1,
    save() {}, restore() {}, setTransform() {}, scale() {}, translate() {},
    clearRect() { this.dots = []; }, fillRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, drawImage() {},
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient(x0, y0, x1, y1) {
      const gradient = { x0, y0, x1, y1, stops: [] };
      this.gradients.push(gradient);
      return { addColorStop(offset, color) { gradient.stops.push([offset, color.toLowerCase()]); } };
    },
    getImageData(_x, _y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    arc(x, y, rx) { this.ellipse(x, y, rx, rx, 0); },
    ellipse(x, y, rx, ry, angle) { const rgba = this.fillStyle.match(/[\d.]+/g).map(Number); this.dots.push({ x, y, color: rgba.slice(0, 3), opacity: rgba[3] }); },
  };
  contexts.push(ctx); return ctx;
}
globalThis.document = { createElement() { return { width: 0, height: 0, getContext: () => context() }; } };
globalThis.Path2D = class Path2D {};
const renderer = createLiquidGlass(), canvas = context();
near(renderer.getIntroSeconds(LIQUID_GLASS_DEFAULTS), 13.4);
near(renderer.getIntroSeconds({ ...LIQUID_GLASS_DEFAULTS, introWordSeconds: 2.5, introAccentSeconds: 1.5, introAccentStartOffset: 0 }), 13.2);
near(renderer.getIntroSeconds({ ...LIQUID_GLASS_DEFAULTS, introPattern: 2 }), 13.2);
function render(p, phase, size = 720) { for (const c of contexts) c.dots = []; renderer.render(canvas, size, size, phase, p); return contexts.flatMap(c => c.dots); }
const flat = { ...params, dotGlow: 0, dotBlur: 0 };
const key = d => `${d.x.toFixed(2)},${d.y.toFixed(2)}`;

// Exercise the three edited intro regions with the Canvas path: A=initial mode 5, B=fade-out,
// D=two-layer wordmark reveal. This is a low-cost runtime guard, not a visual approval.
for (const t01 of [0.15, 0.35, 0.75, 0.9]) {
  renderer.renderIntro(canvas, 720, 720, t01, 0.2, { ...flat, wordmark: 1, introPattern: 1 });
}
for (const t01 of [0.4, 0.55, 0.72, 0.9]) {
  renderer.renderIntro(canvas, 720, 720, t01, 0.2, { ...flat, wordmark: 1, introPattern: 2 });
}
const introGradients = contexts.flatMap(c => c.gradients);
assert.ok(introGradients.some(g => g.x0 === 64 && g.x1 === 103), 'intro wordmark must render its mirrored colour gradient');
const introMasks = introGradients.filter(g => g.x0 !== 64 && g.x0 !== 196);
assert.ok(introMasks.length >= 2, 'intro wordmark must render dim and bright reveal masks');
const introMaskWidths = introMasks.map(g => Math.abs(g.x1 - g.x0));
assert.ok(Math.max(...introMaskWidths) > Math.min(...introMaskWidths) * 3,
  'dim precursor must use a much longer alpha gradient than the bright pass');
// Swap recolours a band of dots vs standard, AND never introduces a 3rd colour: every saturated
// dot hue stays within the teal(≈174°)→violet(≈264°) gradient range — no green (hue<170).
const std = render({ ...flat, motion: 1 }, 0.75);
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

// ── Accent: smoothly moving mirrored spatial gradient ────────────────────
const withWord = { ...params, wordmark: 1 };
function accentFills(svg) {
  return [...svg.matchAll(/<path d="[^"]*" fill="(url\(#[^)]+\)|#[^"]+)"(?: opacity="[^"]+")?\/>/g)]
    .map(m => m[1].toLowerCase()).filter(fill => fill.startsWith('url('));
}
function gradientStops(svg, id) {
  const body = svg.match(new RegExp(`<linearGradient id="${id}"[^>]*>(.*?)<\\/linearGradient>`))?.[1] ?? '';
  return [...body.matchAll(/<stop offset="([^"]+)" stop-color="([^"]+)"(?: stop-opacity="[^"]+")?\/>/g)]
    .map(([, offset, color]) => [+offset, color.toLowerCase()]);
}
function gradientOpacities(svg, id) {
  const body = svg.match(new RegExp(`<linearGradient id="${id}"[^>]*>(.*?)<\\/linearGradient>`))?.[1] ?? '';
  return [...body.matchAll(/<stop offset="[^"]+" stop-color="[^"]+"(?: stop-opacity="([^"]+)")?\/>/g)]
    .map(([, opacity]) => opacity == null ? 1 : +opacity);
}
function accentState(p, phase) {
  const svg = renderer.toSvg({ params: p, phase, loopSeconds: 12 });
  return {
    fills: accentFills(svg),
    left: gradientStops(svg, 'mood-accent-left'),
    right: gradientStops(svg, 'mood-accent-right'),
    leftOpacity: gradientOpacities(svg, 'mood-accent-left'),
    rightOpacity: gradientOpacities(svg, 'mood-accent-right'),
  };
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const rgbHex = color => '#' + color.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');
function expectedGraphicSamples(p, phase) {
  const [innerSr, outerSr] = gradWindow(p);
  const radii = [innerSr, (innerSr + outerSr) / 2, outerSr];
  const base = rgb(p.dotColor);
  const base2 = innerRgb(p);
  const base3 = rgb(p.dotColor3);
  return radii.map(sr => {
    const swapRev = p.motion === 5 && p.inflow > 0
      ? Math.max(0, Math.min(1, p.inflow)) * (0.5 + 0.5 * ripplePhase(sr, phase, p))
      : 0;
    return rgbHex(applyDotAppearance(gradientRgb(sr, 1, base2, base3, base, p, swapRev), sr, p));
  });
}
function assertAccentMatchesGraphic(p, phase) {
  const state = accentState(p, phase);
  const expected = expectedGraphicSamples(p, phase);
  assert.deepEqual(state.fills, ['url(#mood-accent-right)', 'url(#mood-accent-right)', 'url(#mood-accent-left)', 'url(#mood-accent-left)']);
  assert.deepEqual(state.right.map(stop => stop[0]), [0, 0.5, 1]);
  assert.deepEqual(state.left.map(stop => stop[0]), [0, 0.5, 1]);
  assert.deepEqual(state.right.map(stop => stop[1]), expected, `right accent must match graphic inner→outer samples at phase ${phase}`);
  assert.deepEqual(state.left.map(stop => stop[1]), [...expected].reverse(), `left accent must mirror graphic outer→inner samples at phase ${phase}`);
  return state;
}

// Static motions keep the same inner/middle/outer mapping; motion 5 uses the exact same
// radial ripple phase and inflow amplitude as the graphic.
for (const motion of [1, 2, 3, 4]) {
  const p = { ...withWord, motion };
  const start = assertAccentMatchesGraphic(p, 0);
  const moved = assertAccentMatchesGraphic(p, 0.375);
  assert.deepEqual(start.left, moved.left, `motion ${motion} must not invent accent colour motion`);
}
for (const phase of [0, 0.125, 0.37, 0.5, 0.875, 1]) {
  assertAccentMatchesGraphic({ ...withWord, motion: 5 }, phase);
}

// A 2-colour gradient must ignore dotColor3 in both the graphic and the accent. A 3-colour
// gradient must use it, proving the logo follows the selected graphic colour source.
const twoA = accentState({ ...withWord, dotSource: 'gradient', dotColor3: '#ff0000' }, 0.23);
const twoB = accentState({ ...withWord, dotSource: 'gradient', dotColor3: '#00ff00' }, 0.23);
assert.deepEqual(twoA.left, twoB.left, '2-colour accent must not introduce dotColor3');
const threeA = accentState({ ...withWord, dotSource: 'gradient3', dotColor3: '#ff0000' }, 0.23);
const threeB = accentState({ ...withWord, dotSource: 'gradient3', dotColor3: '#00ff00' }, 0.23);
assert.notDeepEqual(threeA.left, threeB.left, '3-colour accent must follow dotColor3');

const colourDelta = (a, b) => Math.max(...rgb(a).map((v, i) => Math.abs(v - rgb(b)[i])));
// Fine-grained adjacent samples remain continuous while using the shared graphic clock.
const seenOuter = new Set();
let previousLeft = null;
let maxAccentStep = 0;
for (let k = 0; k <= 240; k++) {
  const phase = k / 240;
  const { left } = assertAccentMatchesGraphic({ ...withWord, motion: 5 }, phase);
  if (previousLeft) {
    maxAccentStep = Math.max(
      maxAccentStep,
      colourDelta(previousLeft[0][1], left[0][1]),
      colourDelta(previousLeft[2][1], left[2][1]),
    );
  }
  previousLeft = left;
  seenOuter.add(left[0][1]);
}
assert.ok(seenOuter.size > 40, `accent must move through many intermediate colours, saw ${seenOuter.size}`);
assert.ok(maxAccentStep <= 10, `accent motion must not jump between frames, max RGB step=${maxAccentStep}`);
const seamA = accentState({ ...withWord, motion: 5 }, 0);
const seamB = accentState({ ...withWord, motion: 5 }, 1);
assert.deepEqual(seamA.left, seamB.left, 'accent gradient must loop seamlessly');
assert.deepEqual(seamA.right, seamB.right, 'mirrored accent gradient must loop seamlessly');
// Turning the graphic wave off also stops accent colour motion; inflow is shared rather than independent.
const noInflow = accentState({ ...withWord, motion: 5, inflow: 0 }, 0.3);
const noInflowMoved = accentState({ ...withWord, motion: 5, inflow: 0 }, 0.7);
const fullInflow = accentState({ ...withWord, motion: 5, inflow: 1 }, 0.3);
assert.deepEqual(noInflow.left, noInflowMoved.left);
assert.notDeepEqual(noInflow.left, fullInflow.left);

// Inner/outer opacity controls form a mirrored transparency gradient in SVG.
const fadedEnds = accentState({ ...withWord, accentInnerAlpha: 0.2, accentOuterAlpha: 0.8, accentAlphaMotion: 0 }, 0.3);
assert.deepEqual(fadedEnds.leftOpacity, [0.8, 0.5, 0.2]);
assert.deepEqual(fadedEnds.rightOpacity, [0.2, 0.5, 0.8]);

// Animated endpoint opacity remains a spatial gradient, swaps at half-cycle, and closes the seam.
const alphaMotion = { ...withWord, accentInnerAlpha: 0.2, accentOuterAlpha: 0.8, accentAlphaMotion: 1, accentAlphaCycles: 1 };
const alphaStart = accentState(alphaMotion, 0);
const alphaSwap = accentState(alphaMotion, 0.5);
const alphaSeam = accentState(alphaMotion, 1);
assert.deepEqual(alphaStart.leftOpacity, [1, 0.6, 0.2]);
assert.deepEqual(alphaSwap.leftOpacity, [0.8, 0.9, 1]);
assert.deepEqual(alphaStart.leftOpacity, alphaSeam.leftOpacity);
assert.deepEqual(alphaStart.rightOpacity, alphaSeam.rightOpacity);

// SVG export carries the adjustable accent opacity on all four accent paths.
const fadedSvg = renderer.toSvg({ params: { ...withWord, accentAlpha: 0.35 }, phase: 0.3, loopSeconds: 12 });
const fadedAccent = [...fadedSvg.matchAll(/fill="url\(#mood-accent-(?:left|right)\)" opacity="([^"]+)"/g)];
assert.equal(fadedAccent.length, 4);
assert.ok(fadedAccent.every(([, alpha]) => +alpha === 0.35));

// Canvas uses the same local-space axes/stops as SVG, so the colour transition continues through
// both arcs on each side instead of restarting inside each individual path.
canvas.gradients = [];
const opaqueAccent = {
  ...flat, wordmark: 1, motion: 5, inflow: 0,
  accentInnerAlpha: 1, accentOuterAlpha: 1, accentAlphaMotion: 0,
};
render(opaqueAccent, 0.3);
const logoGradients = canvas.gradients.filter(g => (g.x0 === 64 && g.x1 === 103) || (g.x0 === 196 && g.x1 === 231));
assert.equal(logoGradients.length, 2);
const opaqueState = accentState(opaqueAccent, 0.3);
assert.deepEqual(logoGradients.find(g => g.x0 === 64).stops, opaqueState.left);
assert.deepEqual(logoGradients.find(g => g.x0 === 196).stops, opaqueState.right);

// Canvas carries the same outer↔inner alpha ramp inside each accent gradient.
canvas.gradients = [];
render({ ...flat, wordmark: 1, accentInnerAlpha: 0.2, accentOuterAlpha: 0.8, accentAlphaMotion: 0 }, 0.3);
const fadedCanvas = canvas.gradients.filter(g => (g.x0 === 64 && g.x1 === 103) || (g.x0 === 196 && g.x1 === 231));
const leftFade = fadedCanvas.find(g => g.x0 === 64).stops.map(([, color]) => color);
const rightFade = fadedCanvas.find(g => g.x0 === 196).stops.map(([, color]) => color);
assert.ok(leftFade[0].endsWith(', 0.8)') && leftFade[2].endsWith(', 0.2)'));
assert.ok(rightFade[0].endsWith(', 0.2)') && rightFade[2].endsWith(', 0.8)'));

console.log(`PASS: latest SAVE defaults; adjustable dim-text timing/speed, 1–1.5x letter reveal, and signed accent start offset; pattern 2 deterministically morphs into text-coloured particles, forms the word, then reveals the second graphic; graphic motion=5 swaps teal↔violet on the gradient line (recoloured ${recoloured}/${matched}, green dots ${greenDots}, out-of-range ${outOfRange}), radial & seamless, ${cases} Canvas/SVG parity; accent inner/middle/outer colours match the graphic at the same radii and ripple phase (${seenOuter.size} colours, max RGB step ${maxAccentStep}, 2-colour third-stop isolation, loop-safe opacity exchange)`);
