// LIQUID GLASS の「グラフィック位置」(gfxX/gfxY) の検証ハーネス。
// liquidGlass.ts を esbuild でバンドルし lockupLayout を直接呼ぶ（verify-liquid-glass.mjs と同方式）。
//
//   node scripts/verify-graphic-offset.mjs
//
// グラフィックの座標を決めているのは lockupLayout の1箇所だけなので、
// ここが正しければ canvas / PNG / SVG / MP4 / 透過MOV のすべてが同じ場所に出る。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const sourceDir = new URL('../src/lib/identity/', import.meta.url).pathname;
const source = await readFile(new URL('liquidGlass.ts', `file://${sourceDir}`), 'utf8');
const bundle = await build({
  stdin: {
    contents: source + '\nexport { lockupLayout, introCenterLayout };',
    resolveDir: sourceDir,
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { lockupLayout, introCenterLayout, LIQUID_GLASS_DEFAULTS: D, LIQUID_GLASS_CONTROLS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const W = 1280, H = 720; // 書き出し解像度（EXPORT_W / EXPORT_H）
const L = (p, showWord = true) => lockupLayout(W, H, showWord, { ...D, ...p });

// ── 既定値は従来の配置と完全一致（オフセット導入前の値をハードコードして固定）──
{
  // D = H = 720 なので gy = 0。ロゴONは中心 W*0.2=256、OFFは中心 W/2=640。
  assert.deepEqual([L({}).gx, L({}).gy], [-104, 0], 'ロゴONの既定配置');
  assert.deepEqual([L({}, false).gx, L({}, false).gy], [280, 0], 'ロゴOFFの既定配置');

  // 未設定（古い保存データ）でも 0 と同じ扱いになること
  const without = { ...D };
  delete without.gfxX;
  delete without.gfxY;
  const a = lockupLayout(W, H, true, without);
  const b = L({ gfxX: 0, gfxY: 0 });
  assert.deepEqual(a, b, '未設定と 0 が同一');
}

// ── オフセットはキャンバス比ぶんだけ、正確に平行移動する ──
for (const [gfxX, gfxY] of [[0.1, 0], [-0.25, 0.125], [0.5, -0.5], [0.003, -0.007]]) {
  for (const showWord of [true, false]) {
    const base = L({}, showWord);
    const moved = L({ gfxX, gfxY }, showWord);
    // gx は「中心 - D/2」を丸めるので、丸めの差は最大1px
    assert.ok(
      Math.abs(moved.gx - (base.gx + W * gfxX)) <= 1,
      `gx のずれ量 (showWord=${showWord}, ${gfxX}): ${moved.gx} vs ${base.gx + W * gfxX}`,
    );
    assert.equal(moved.gy, Math.round(base.gy + H * gfxY), `gy のずれ量 (showWord=${showWord}, ${gfxY})`);
  }
}

// ── ワードマークはグラフィックのオフセットに影響されない（独立に動かせる）──
for (const [gfxX, gfxY] of [[0.3, 0.2], [-0.5, -0.4]]) {
  const base = L({});
  const moved = L({ gfxX, gfxY });
  assert.equal(moved.wx, base.wx, 'ワードマーク X は不変');
  assert.equal(moved.wy, base.wy, 'ワードマーク Y は不変');
  assert.equal(moved.wmScale, base.wmScale, 'ワードマークのスケールは不変');
  assert.equal(moved.D, base.D, 'グラフィックの一辺は不変（位置だけが動く）');
}

// ── 導入アニメの開始位置は必ずキャンバス中央（位置調整の影響を受けない）──
// 導入は「中央で出現 → 中央で消失 → 現在の配置へ移動」という演出なので、
// 開始位置までずれると「中央から出る」意図が崩れる。
{
  const C = (p) => introCenterLayout(W, H, { ...D, ...p });
  const center = C({});
  // ずらしが 0 のときは、ワードマーク非表示時の通常レイアウトと完全に一致
  assert.deepEqual(center, L({}, false), '中央レイアウト = ロゴOFFの通常レイアウト（ずらし0）');
  assert.deepEqual([center.gx, center.gy], [280, 0], '中央レイアウトの座標');
  for (const p of [{ gfxX: 0.35 }, { gfxY: -0.35 }, { gfxX: -0.2, gfxY: 0.3 }, { gfxX: 0.1, gfxY: 0.1 }]) {
    assert.deepEqual(C(p), center, `導入の中央がずれている: ${JSON.stringify(p)}`);
  }
  // 一方で最終配置（通常レイアウト）はちゃんと動く＝パラメータが効いている
  for (const showWord of [true, false]) {
    const moved = L({ gfxX: 0.1, gfxY: 0.1 }, showWord);
    const base = L({}, showWord);
    assert.notDeepEqual([moved.gx, moved.gy], [base.gx, base.gy], '最終配置は動く');
  }
}

// ── 導入アニメの移動量 ──
// 導入は「中央レイアウト Lc → 通常レイアウト L」の差でグラフィックを動かす。
// オフセットは両方へ同じだけ乗るので、差（= 移動距離）は変わってはいけない。
// 中央から最終配置までの移動距離は、ずらしたぶんだけ素直に増減する。
{
  const travel = (p) => {
    const l = L(p, true), c = introCenterLayout(W, H, { ...D, ...p });
    return [l.gx - c.gx, l.gy - c.gy];
  };
  assert.deepEqual(travel({}), [-384, 0], '既定の移動量（W*0.2 - W/2 = -384px）');
  assert.deepEqual(travel({ gfxX: 0.1 }), [-384 + 128, 0], '横へずらすと移動量もその分ずれる');
  assert.deepEqual(travel({ gfxY: -0.25 }), [-384, -180], '縦へずらすと縦の移動量が生まれる');
}

// ── コントロール定義と既定値が噛み合っていること ──
{
  const all = LIQUID_GLASS_CONTROLS.flatMap(([, controls]) => controls);
  for (const key of ['gfxX', 'gfxY']) {
    const ctl = all.find((c) => c[0] === key);
    assert.ok(ctl, `${key} のコントロールが無い`);
    assert.equal(ctl[2], 'r', `${key} はスライダー`);
    const [, , , min, max, step] = ctl;
    assert.equal(D[key], 0, `${key} の既定値は 0（従来の配置）`);
    assert.ok(min < 0 && max > 0, `${key} は左右（上下）どちらへも動かせる`);
    assert.ok(D[key] >= min && D[key] <= max, `${key} の既定値がスライダー範囲内`);
    // 端まで動かしてもグラフィックの2割以上が画面に残ること（消えるスライダーにしない）
    for (const v of [min, max]) {
      for (const showWord of [true, false]) {
        const m = L({ [key]: v }, showWord);
        const visibleW = Math.min(W, m.gx + m.D) - Math.max(0, m.gx);
        const visibleH = Math.min(H, m.gy + m.D) - Math.max(0, m.gy);
        assert.ok(visibleW >= m.D * 0.2, `${key}=${v} (ロゴ${showWord ? "ON" : "OFF"}) で横の露出が足りない: ${visibleW}px`);
        assert.ok(visibleH >= Math.min(H, m.D) * 0.2, `${key}=${v} (ロゴ${showWord ? "ON" : "OFF"}) で縦の露出が足りない: ${visibleH}px`);
      }
    }
    assert.ok(step > 0, `${key} の step`);
  }
}

console.log('グラフィック位置OK: 既定は従来と同一 / ずれ量は正確 / ロゴと導入の開始位置(中央)に影響なし');
