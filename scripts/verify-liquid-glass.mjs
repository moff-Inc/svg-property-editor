import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const sourceDir = new URL('../src/lib/identity/', import.meta.url).pathname;
const source = await readFile(new URL('liquidGlass.ts', `file://${sourceDir}`), 'utf8');
const bundle = await build({
  stdin: { contents: source + '\nexport { dotField, alphaI };', resolveDir: sourceDir, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { dotField, alphaI, createLiquidGlass, LIQUID_GLASS_DEFAULTS: defaults } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`,
);
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

// Fading must reach transparency at the field's visibility cutoff, without
// changing the solid core or the inner hexagon's particle arrangement.
for (const bg of ['#ffffff', '#000000']) {
  const p = { ...defaults, bg, edgeFade: 1 };
  near(alphaI(0.015, p, p.fieldBlur * 2), 0);
  let previous = 0;
  for (let i = 0.015; i < 0.1; i += 0.001) {
    const alpha = alphaI(i, p, p.fieldBlur * 2);
    assert.ok(alpha >= previous && Number.isFinite(alpha));
    previous = alpha;
  }
  for (const i of [0.02, 0.2, 0.9]) {
    near(alphaI(i, p, 0), alphaI(i, { ...p, edgeFade: 0 }, 0));
  }
}
let cases = 0;
for (const motion of [1, 2, 3, 4]) {
  for (const frequency of [1, 2, 7, 12]) {
    const p = { ...defaults, motion, frequency };
    for (const phase of [0, 0.25, 0.75, 1]) {
      const before = dotField({ ...p, edgeFade: 0, armEven: 0 }, phase);
      const after = dotField(p, phase);
      assert.equal(before.length, after.length);
      after.forEach((dot, index) => {
        for (const key of ['x', 'y', 'sr', 'ang', 'i', 'shade']) near(dot[key], before[index][key]);
        assert.ok(dot.even >= 0.5 && dot.even <= 1.5);
      });
      assert.deepEqual(dotField(p, phase), after, 'Seeking must be deterministic');
      cases++;
    }
    const first = dotField(p, 0), last = dotField(p, 1);
    assert.equal(first.length, last.length);
    first.forEach((d, i) => {
      for (const key of ['x', 'y', 'sr', 'i', 'shade', 'even']) near(d[key], last[i][key]);
    });
  }
}
for (const dotSource of ['solid', 'blob']) {
  const p = { ...defaults, dotSource };
  assert.deepEqual(dotField(p, 0), dotField({ ...p, edgeFade: 0, armEven: 0 }, 0));
}

// The gradient SVG path needs only a Canvas context for its unused blob layer.
const context = { setTransform() {}, clearRect() {}, save() {}, restore() {}, scale() {} };
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const renderer = createLiquidGlass();
function svg(patch) {
  return renderer.toSvg({ params: { ...defaults, count: 0, wordmark: 0, ...patch }, phase: 0, loopSeconds: 12 });
}
for (const patch of [{}, { transparent: 1 }, { dotBlur: 0 }, { dotGlow: 0 }]) {
  const result = svg(patch);
  assert.ok(result.includes('<feGaussianBlur'));
  assert.ok(!/NaN|Infinity|<mask|<clipPath/.test(result));
  assert.equal((result.match(/id="liquid-dot-effects"/g) || []).length, 1);
}
const disabled = svg({ dotBlur: 0, dotGlow: 0 });
assert.ok(!disabled.includes('<filter'));
const dots = text => [...text.matchAll(/<(?:circle|ellipse)\s[^>]+/g)].map(m => m[0]);
assert.deepEqual(dots(svg({})), dots(disabled), 'Blur and glow must preserve vector dot geometry');
console.log(`PASS: outer fade, unchanged particle geometry (${cases} cases), loop continuity, deterministic seek, solid/blob isolation, SVG effects`);
