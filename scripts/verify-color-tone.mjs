// 色味調整レイヤー(TONE)と 3色グラデ(gradient3) の検証ハーネス。
// liquidGlass.ts を esbuild でバンドルし内部関数を直接呼ぶ（verify-liquid-glass.mjs と同方式）。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const sourceDir = new URL('../src/lib/identity/', import.meta.url).pathname;
const source = await readFile(new URL('liquidGlass.ts', `file://${sourceDir}`), 'utf8');
const bundle = await build({
  stdin: {
    contents: source + '\nexport { gradientRgb, applyTone, isGradient };',
    resolveDir: sourceDir,
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { gradientRgb, applyTone, isGradient, LIQUID_GLASS_DEFAULTS: D } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// ── isGradient: gradient/gradient3 のみ true（solid/blob は従来経路）───────────
assert.equal(isGradient({ dotSource: 'gradient' }), true);
assert.equal(isGradient({ dotSource: 'gradient3' }), true);
assert.equal(isGradient({ dotSource: 'solid' }), false);
assert.equal(isGradient({ dotSource: 'blob' }), false);

// ── applyTone: 既定は無変換（バイト一致）──────────────────────────────────
{
  const c = [123, 45, 200];
  const out = applyTone(c, D);
  assert.deepEqual(out, c, 'tone defaults must be a no-op');
  // undefined(旧保存物)も既定へ吸収され無変換
  assert.deepEqual(applyTone([10, 20, 30], { dotSource: 'gradient' }), [10, 20, 30]);
}
// 彩度0 → グレースケール（R≈G≈B）
{
  const [r, g, b] = applyTone([200, 50, 50], { ...D, toneSat: 0 });
  assert.ok(Math.abs(r - g) < 1.5 && Math.abs(g - b) < 1.5, `sat0 not gray: ${r},${g},${b}`);
}
// 明るさ0 → 黒
{
  const out = applyTone([200, 50, 50], { ...D, toneBright: 0 });
  assert.ok(out.every((v) => v < 1), `bright0 not black: ${out}`);
}
// 色相+180: 赤(hue0) → シアン
{
  const [r, g, b] = applyTone([255, 0, 0], { ...D, toneHue: 180 });
  assert.ok(r < 40 && g > 200 && b > 200, `hue+180 of red not cyan: ${r},${g},${b}`);
}
// 色被せ1.0 → 完全に色被せカラー
{
  const [r, g, b] = applyTone([255, 0, 0], { ...D, toneTint: 1, toneTintColor: '#00ff00' });
  assert.ok(r < 1 && g > 254 && b < 1, `tint1 not #00ff00: ${r},${g},${b}`);
}

// ── gradient3: 内→中→外の3ストップ補間 ─────────────────────────────────
const Pg3 = { ...D, dotSource: 'gradient3', bg: '#000000', ringR: 0.585, gradMid: 0.5 };
// inner=mid=outer が同色なら luma係数=1 で入力と厳密一致
{
  const C = [100, 150, 200];
  const out = gradientRgb(0.585, 0.8, C, C, C, Pg3);
  out.forEach((v, i) => near(v, C[i]));
}
// 中間色が中央(t≈gradMid=0.5, sr=ringR)で支配的：inner=outer=灰, mid=赤 → 中央は赤優勢
{
  const gray = [10, 10, 10], red = [240, 10, 10];
  const atMid = gradientRgb(0.585, 0.8, gray, red, gray, Pg3); // t≈0.5
  const atInner = gradientRgb(0.2, 0.8, gray, red, gray, Pg3); // t≈0（小sr）
  assert.ok(atMid[0] > atMid[2] + 20, `mid color not red-dominant: ${atMid}`);
  assert.ok(Math.abs(atInner[0] - atInner[2]) < 3, `inner not gray: ${atInner}`);
}
// gradMid の位置で中間色のピークが移動する（0.25 と 0.75 で赤の出方が変わる）
{
  const gray = [10, 10, 10], red = [240, 10, 10];
  const early = gradientRgb(0.45, 0.8, gray, red, gray, { ...Pg3, gradMid: 0.25 });
  const late = gradientRgb(0.45, 0.8, gray, red, gray, { ...Pg3, gradMid: 0.75 });
  assert.notDeepEqual(early, late, 'gradMid must shift the middle color position');
}

// ── 2色gradient は mid 引数を無視（3色追加が2色経路に影響しない）──────────
{
  const P2 = { ...D, dotSource: 'gradient', bg: '#000000' };
  const inner = [20, 200, 180], outer = [110, 40, 255];
  const a = gradientRgb(0.5, 0.7, inner, [255, 255, 0], outer, P2);
  const b = gradientRgb(0.5, 0.7, inner, [0, 0, 0], outer, P2);
  assert.deepEqual(a, b, '2-color gradient must ignore the mid argument');
}

console.log('PASS color-tone: isGradient gate, tone no-op/hue/sat/bright/tint, gradient3 3-stop + gradMid, 2-color mid-ignore');
