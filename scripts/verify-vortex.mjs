import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = path.resolve('src/lib/identity');
const source = await readFile(path.join(sourceDir, 'liquidGlass.ts'), 'utf8');
// Expose the pure field only in this test bundle; keep the production API small.
const result = await build({
  stdin: { contents: source + '\nexport { dotField, advectVortex };', resolveDir: sourceDir, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { dotField, advectVortex, createLiquidGlass, LIQUID_GLASS_DEFAULTS } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const params = { ...LIQUID_GLASS_DEFAULTS, motion: 3, wordmark: 0 };
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

// Track individual particles across their lifetime: inward, clockwise, shrinking,
// and invisible at both ends before recycling (including fractional strength).
const particle = { x: 0.7, y: 0.1, i: 0.8, sr: 0.7, ang: 0, shade: 1 };
for (const inflow of [0.05, 0.5, 1, 1.35, 2]) {
  let previous = Infinity, previousAngle = -Infinity;
  for (let frame = 0; frame < 100; frame++) {
    const dot = advectVortex(particle, frame / (100 * params.animB), 0, { ...params, inflow });
    const radius = Math.hypot(dot.x, dot.y);
    assert.ok(radius <= previous, 'A particle must move inward for its whole lifetime');
    assert.ok(dot.ang >= previousAngle, 'A particle must wind clockwise');
    assert.ok(dot.size > 0 && dot.size <= 1);
    previous = radius; previousAngle = dot.ang;
  }
  near(advectVortex(particle, 0, 0, { ...params, inflow }).shade, 0);
  assert.ok(advectVortex(particle, 0.999999 / params.animB, 0, { ...params, inflow }).shade < 1e-7);
}
assert.ok(Math.hypot(...['x', 'y'].map(k => advectVortex(particle, 0.99 / params.animB, 0, params)[k])) < 0.1,
  'Particles must reach the center, not stop at the hexagon rim');

for (const patch of [{}, { inflow: 0.05 }, { inflow: 2 }, { density: 180 }, { seed: 12, swirl: 0 }]) {
  const p = { ...params, ...patch };
  const first = dotField(p, 0), last = dotField(p, 1);
  assert.equal(first.length, last.length);
  first.forEach((dot, i) => {
    for (const key of ['x', 'y', 'ang', 'i', 'shade', 'size']) near(dot[key], last[i][key]);
  });
  // Seeking backward must not depend on prior renders.
  const at = dotField(p, 0.317);
  dotField(p, 0.81);
  assert.deepEqual(dotField(p, 0.317), at);
}
for (const phase of [0, 0.23, 0.99]) {
  assert.deepEqual(dotField({ ...params, inflow: 0 }, phase), dotField({ ...params, motion: 1 }, phase));
  assert.deepEqual(dotField({ ...params, animB: 0 }, phase), dotField({ ...params, animB: 0 }, 0));
}

// Record actual Canvas circle/ellipse calls. Export parity and geometry are
// checked without a browser or a GPU; no clip/erase API is provided.
const contexts = [];
function context() {
  const ctx = {
    dots: [], fillStyle: '', globalAlpha: 1,
    save() {}, restore() {}, setTransform() {}, scale() {},
    clearRect() { this.dots = []; }, fillRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, drawImage() {},
    createRadialGradient() { return { addColorStop() {} }; },
    getImageData(_x, _y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    arc(x, y, rx) { this.ellipse(x, y, rx, rx, 0); },
    ellipse(x, y, rx, ry, angle) {
      const rgba = this.fillStyle.match(/[\d.]+/g).map(Number);
      this.dots.push({ x, y, rx, ry, angle, color: rgba.slice(0, 3), opacity: rgba[3] });
    },
  };
  contexts.push(ctx);
  return ctx;
}
globalThis.document = { createElement() { return { width: 0, height: 0, getContext: () => context() }; } };
const renderer = createLiquidGlass(), canvas = context();
function render(p, phase, size = 720) {
  for (const c of contexts) c.dots = [];
  renderer.render(canvas, size, size, phase, p);
  return contexts.flatMap(c => c.dots);
}
function svgDots(svg) {
  assert.ok(!/NaN|Infinity|<mask|<clipPath/.test(svg));
  return [...svg.matchAll(/<(circle|ellipse)\s+([^>]+)\/>/g)].map(([, tag, attributes]) => {
    const a = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    return { x: +a.cx, y: +a.cy, rx: +(tag === 'circle' ? a.r : a.rx), ry: +(tag === 'circle' ? a.r : a.ry), opacity: +a.opacity };
  });
}
let cases = 0;
for (const motion of [1, 2, 3]) {
  for (const patch of [{}, { inflow: 0 }, { inflow: 2 }, { hexMask: 0 }, { dotAspect: 0.6, hexSpin: 1 }, { density: 180 }]) {
    for (const phase of [0, 0.125, 0.49, 0.75, 1]) {
      const p = { ...params, motion, ...patch };
      const drawn = render(p, phase);
      const svg = svgDots(renderer.toSvg({ params: p, phase, loopSeconds: 12 }));
      assert.equal(drawn.length, svg.length);
      assert.ok(svg.length > 100);
      drawn.forEach((d, i) => {
        for (const key of ['x', 'y']) near(d[key], svg[i][key], 0.051);
        for (const key of ['rx', 'ry']) near(d[key], svg[i][key], 0.0051);
        near(d.opacity, svg[i].opacity, 0.0011);
      });
      cases++;
    }
  }
}
const standard = render({ ...params, motion: 1 }, 0);
const vortex = render(params, 0);
const innerCount = dots => dots.filter(d => Math.hypot(d.x - 360, d.y - 360) < 45).length;
assert.equal(innerCount(standard), 0);
assert.ok(innerCount(vortex) > 50, 'Visible particles must enter the former central opening');
console.log(`PASS: inward trajectories, recycling, looping, deterministic seek, zero strength, ${cases} Canvas/SVG comparisons; inner particles ${innerCount(standard)} → ${innerCount(vortex)}`);

if (process.argv[2]) {
  const dir = path.resolve(process.argv[2]);
  await mkdir(dir, { recursive: true });
  const frames = [];
  // A larger mark for reviewing the particle motion on a square canvas.
  const preview = { ...params, zoom: 1 };
  for (let frame = 0; frame < 360; frame++) frames.push(render(preview, frame / 360));
  await writeFile(path.join(dir, 'frames.json'), JSON.stringify(frames));
  await writeFile(path.join(dir, 'standard.json'), JSON.stringify(render({ ...preview, motion: 1 }, 0)));
  await writeFile(path.join(dir, 'pattern-3.svg'), renderer.toSvg({ params: preview, phase: 0, loopSeconds: 12 }));
  const browser = await build({
    stdin: { contents: `export { createLiquidGlass, LIQUID_GLASS_DEFAULTS } from './liquidGlass';`, resolveDir: sourceDir },
    bundle: true, write: false, format: 'iife', globalName: 'Vortex', minify: true,
  });
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>パターン3 · 粒子渦</title>
<style>:root{color-scheme:dark;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#08080c;color:#eee}main{max-width:880px;margin:auto;padding:32px 24px}h1{font-size:24px;margin:0 0 8px}p{color:#aaa;margin:0 0 24px}canvas{width:100%;display:block;background:black;border-radius:16px}section{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:24px}label{display:flex;gap:8px;align-items:center}button,select{font:inherit;padding:8px 16px;border:1px solid #555;border-radius:8px;background:#20202a;color:white}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #b296ff;outline-offset:4px}input{accent-color:#9a70ff}#seek{width:100%;margin-top:24px}</style>
<main><h1>パターン3 · 粒子渦</h1><p>外周から中心へ、粒子が螺旋を描いて吸い込まれます。</p><canvas id="view" width="720" height="720" aria-label="中心へ流れる紫色の粒子アニメーション"></canvas><section><button id="play" type="button">一時停止</button><label>モーション<select id="motion"><option value="3">3：粒子渦</option><option value="1">1：標準</option><option value="2">2：吸い込み</option></select></label><label>吸い込み<input id="strength" type="range" min="0" max="2" step="0.05" value="1"><output id="value">1.00</output></label></section><input id="seek" aria-label="再生位置" type="range" min="0" max="1" step="0.001" value="0"></main>
<script>${browser.outputFiles[0].text}</script><script>
const canvas=document.getElementById('view'),ctx=canvas.getContext('2d'),renderer=Vortex.createLiquidGlass();
const params={...Vortex.LIQUID_GLASS_DEFAULTS,motion:3,wordmark:0,zoom:1};
const play=document.getElementById('play'),seek=document.getElementById('seek');
let phase=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,last=performance.now();
function label(){play.textContent=playing?'一時停止':'再生'}label();
play.onclick=()=>{playing=!playing;label()};
document.getElementById('motion').onchange=e=>{params.motion=Number(e.target.value)};
document.getElementById('strength').oninput=e=>{params.inflow=Number(e.target.value);document.getElementById('value').value=params.inflow.toFixed(2)};
seek.oninput=e=>{phase=Number(e.target.value);playing=false;label()};
function tick(now){if(playing)phase=(phase+Math.min((now-last)/1000,0.1)/12)%1;last=now;renderer.render(ctx,720,720,phase,params);seek.value=String(phase);requestAnimationFrame(tick)}requestAnimationFrame(tick);
</script></html>`;
  await writeFile(path.join(dir, 'pattern-3.html'), html);
  console.log(`Preview and 360 frames written to ${dir}`);
}
