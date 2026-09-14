// LIQUID GLASS: ドット場のサイズと透明度で中央の六角形を表現する。
// 各ドットは完全な円／楕円として描画し、切り抜きやマスク合成を使わない。
import {
  TAU,
  RAD,
  clamp,
  rgba,
  rgbOf,
  cstr,
  smoothstep,
  mulberry32,
  softDraw,
  fillBg,
  LayerCache,
} from "./engine";
import type { CanvasRenderer, ControlsSpec, Params } from "./types";
import { hexagonDistance, hexDotWeight } from "./hexGeometry";
import { drawMoodMetrix, moodMetrixSvg, LOGO_W, LOGO_H } from "./moodMetrixLogo";

interface CircleDef {
  col: string;
  x: number;
  y: number;
  r: number;
  a: number;
  ring: number;
  wob: number;
}

export interface LiquidGlassParams {
  zoom: number;
  bg: string;
  hexR: number;
  hexRot: number;
  hexSpin: number;
  hexMask: number;
  halftone: number;
  density: number;
  ringR: number;
  thickness: number;
  fieldBlur: number;
  threshold: number;
  frequency: number;
  wave: number;
  turbulence: number;
  swirl: number;
  contrast: number;
  dotScale: number;
  dotAspect: number;
  fieldRot: number;
  fieldScale: number;
  dotAlpha: number;
  dotSource: string; // blob|solid|gradient
  dotColor: string; // solid色／gradientの外側色（＋ワードマークのアクセント色）
  dotColor2: string; // gradientの内側色（半径で dotColor へ補間）
  animA: number;
  animB: number;
  motion: number; // 1=標準, 2=陰影の吸い込み, 3=粒子渦（帯に沿って環流）, 4=粒子渦＋全体回転
  inflow: number; // 吸い込みの強さ（motion=2 のとき有効）
  count: number;
  blend: string;
  wobble: number;
  blur: number;
  scale: number;
  seed: number;
  wordmark: number; // MOOD METRIX ワードマークの表示（1で表示）
  wmSize: number; // ワードマークのサイズ（既定比の倍率）
  wmX: number; // ワードマーク中心X（キャンバス幅比 0..1）
  wmY: number; // ワードマーク中心Y（キャンバス高比 0..1）
  intro?: number; // 導入（出現）アニメ: 0=なし, 1=渦の集結→出現→ロゴ
  circles: CircleDef[];
  transparent?: number; // 背景透過（1でclear）
}

function wobblyRing(
  x: CanvasRenderingContext2D,
  cc: CircleDef,
  i: number,
  ph: number,
  P: LiquidGlassParams,
  W: number,
  H: number,
) {
  const w = P.wobble * cc.wob;
  // 「円のスケール」を大きくすると各ブラー円の着色帯が画面外へ逃げ、ドットが白(base)へ
  // フォールバックして色が飛ぶ。knee(2.2)を超える分は半径の伸びを緩やかに圧縮し、
  // スケールを大きくしても着色帯が画面内に残って色が全ドットへ反映されるようにする。
  // scale≦2.2（既定=1 を含む）は等倍で原典と同一。
  const sEff = P.scale <= 2.2 ? P.scale : 2.2 + (P.scale - 2.2) * 0.35;
  const R = cc.r * H * sEff * P.zoom;
  const f1 = 1 + (i % 2),
    f2 = 2 + (i % 3),
    f3 = 3 + (i % 2);
  const X = W / 2 + cc.x * H * P.zoom + Math.sin(TAU * (ph * f1) + i * 1.1) * w * H * 0.045;
  const Y = H / 2 + cc.y * H * P.zoom + Math.cos(TAU * (ph * f2) + i * 0.7) * w * H * 0.045;
  const N = 72,
    pts: number[][] = [];
  for (let k = 0; k < N; k++) {
    const t = (k / N) * TAU;
    const m =
      1 +
      0.1 * w * Math.sin(3 * t + TAU * ph * f1 + i) +
      0.06 * w * Math.sin(5 * t - TAU * ph * f3 + i * 2) +
      0.04 * w * Math.sin(2 * t + TAU * ph * f2);
    pts.push([X + Math.cos(t) * R * m, Y + Math.sin(t) * R * m]);
  }
  const g = x.createRadialGradient(X, Y, Math.max(1, R * cc.ring * 0.55), X, Y, R * 1.02);
  g.addColorStop(0, rgba(cc.col, cc.ring > 0.04 ? 0 : cc.a));
  g.addColorStop(clamp(cc.ring, 0.02, 0.92), rgba(cc.col, cc.a));
  g.addColorStop(1, rgba(cc.col, 0));
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < N; k++) x.lineTo(pts[k][0], pts[k][1]);
  x.closePath();
  x.fill();
}

const spacingPx = (P: LiquidGlassParams, u: number) =>
  (2.06 / (Math.max(17, Math.round(P.density)) - 1)) * u;

interface Dot {
  x: number;
  y: number;
  i: number;
  ang: number;
  sr: number;
  shade: number; // 吸い込みの陰影（不透明度係数、標準は1）
}

// グラデーション配色（Image #8）: 内側(inner=dotColor2)→外側(outer=dotColor)を
// リング半径 sr で補間する。中心付近ティール／外周バイオレット、中間はその混色。
function gradientRgb(sr: number, inner: number[], outer: number[], P: LiquidGlassParams): number[] {
  const t = smoothstep(P.ringR - 0.28, P.ringR + 0.28, sr);
  return [
    inner[0] + (outer[0] - inner[0]) * t,
    inner[1] + (outer[1] - inner[1]) * t,
    inner[2] + (outer[2] - inner[2]) * t,
  ];
}

function dotField(P: LiquidGlassParams, ph: number): Dot[] {
  const count = Math.max(17, Math.round(P.density));
  const r = mulberry32(P.seed);
  // 粒子渦(motion=3/4): 静止した「うねる帯」に沿って同じ粒子が環流し続ける。
  // 帯の形が時間で変わると粒子の明暗が揺れて出現/消滅に見えるため、位相は固定する。
  // motion=4 は同じ構造のまま全体を剛体回転させる版（1ループで1回転＝継ぎ目なし）。
  const vortex = P.motion === 3 || P.motion === 4;
  const phaseA = r() * TAU + TAU * (vortex ? 0 : ph) * P.animA;
  const phaseB = r() * TAU - TAU * (vortex ? 0 : ph) * P.animB;
  const spacing = 2.06 / (count - 1);
  const rotation = P.fieldRot * RAD + (P.motion === 4 ? TAU * ph : 0);
  const out: Dot[] = [];
  const thr = P.threshold;
  // 角度 a における帯の中心半径（うねり込み・時間不変）
  const bandR = (a: number) => {
    const dist =
      0.64 * Math.sin(P.frequency * a + phaseA) +
      0.24 * Math.sin(2 * a - phaseB) +
      0.12 * Math.sin(7 * a + phaseB);
    const rough =
      P.turbulence * 0.045 * (0.65 * Math.sin(3 * a + phaseB) + 0.35 * Math.sin(9 * a - phaseA));
    return clamp(P.ringR + P.wave * 0.15 * dist + rough, 0.12, 0.95);
  };
  // 粒子渦の周回数（整数＝ループ継ぎ目なし）。「渦の周回数(animB)」を流速に使う。
  const turns = Math.max(1, Math.round(P.animB));
  for (let row = 0; row < count; row++)
    for (let col = 0; col < count; col++) {
      const gx = -1.03 + col * spacing,
        gy = -1.03 + row * spacing;
      let sr = Math.hypot(gx, gy),
        sa = Math.atan2(gy, gx);
      // 明るさの揺らぎは粒子固有（出生角で固定）— 環流中に明滅しない。
      const light = 0.9 + 0.1 * Math.sin(sa * 2 - phaseA);
      if (vortex) {
        // 各粒子は「帯中心からの相対距離 delta」を保ったまま、うねる帯に沿った
        // 閉軌道を周回する。強度は delta で決まり一定＝消える・湧くが起きない。
        // ph=0 の配置・明るさは標準と完全に同一（標準の質感のまま流れる）。
        const delta = sr - bandR(sa);
        sa += TAU * turns * ph;
        sr = Math.max(0, bandR(sa) + delta);
      }
      const ringR = bandR(sa);
      const dc = Math.abs(sr - ringR);
      const dOut = Math.max(0, dc - P.thickness / 2);
      const sig = Math.max(0.012, P.fieldBlur);
      const blurred = Math.exp(-0.5 * Math.pow(dOut / sig, 2));
      const val = clamp(blurred * light, 0, 1);
      const th = smoothstep(thr, Math.min(1, thr + 0.72), val);
      const inten = Math.pow(th, 0.58 + P.contrast * 0.78);
      if (inten < 0.015) continue;
      const env = Math.exp(-Math.pow((sr - ringR) / Math.max(0.18, P.fieldBlur * 2.4), 2));
      const aFlow = P.swirl * 0.2 * env + P.turbulence * 0.075 * Math.sin(3 * sa + sr * 8 + phaseB);
      const rFlow =
        P.swirl * 0.018 * env * Math.sin(P.frequency * sa + phaseA) +
        P.turbulence * 0.018 * Math.sin(gx * 9 - gy * 7 + phaseB);
      const wr = Math.max(0, sr + rFlow),
        wa = sa + aFlow;
      let x = wr * Math.cos(wa),
        y = wr * Math.sin(wa);
      x += P.turbulence * 0.035 * Math.sin(y * 6 + phaseA);
      y += P.turbulence * 0.028 * Math.sin(x * 7 - phaseB);
      const rx0 = x * Math.cos(rotation) - y * Math.sin(rotation);
      const ry0 = x * Math.sin(rotation) + y * Math.cos(rotation);
      // 吸い込み: 位置・サイズ（＝形）は一切変えず、陰影だけで表現する。
      // 基準の明るさは標準と同一（どのフレームで止めても標準と同じ形・色）。
      // ハイライトの波は半径(sr)＋角度(sa)を混ぜた螺旋状で、渦の腕に沿って
      // 中心へ伝播（1ループ整数周期＝継ぎ目なし）。振幅を濃さ(inten)で重み付け
      // するため、濃い部分だけが腕づたいに吸い込まれて見え、薄い縁は静止する。
      let shade = 1;
      if (P.motion === 2 && P.inflow > 0) {
        const wavePhase = 0.5 + 0.5 * Math.sin(TAU * 2 * ph + sr * 8 + 3 * sa);
        shade = 1 + 0.7 * P.inflow * wavePhase * inten;
      }
      out.push({ x: rx0, y: ry0, i: inten, ang: wa + Math.PI / 2 + rotation, sr, shade });
    }
  return out;
}

function drawC3(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  ph: number,
  P: LiquidGlassParams,
  cache: LayerCache,
) {
  const S = W / 1280;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.filter = "none";
  c.globalCompositeOperation = "source-over";
  fillBg(c, W, H, P.bg, !!P.transparent);

  const q = 0.5,
    fw = Math.max(2, Math.round(W * q)),
    fh = Math.max(2, Math.round(H * q));
  const F = cache.get("c3f", fw, fh),
    fx = F.x;
  fx.save();
  fx.scale(q, q);
  fx.globalCompositeOperation = P.blend as GlobalCompositeOperation;
  for (let i = 0; i < P.count; i++) wobblyRing(fx, P.circles[i], i, ph, P, W, H);
  fx.restore();

  const rot = P.hexRot * RAD + ph * TAU * P.hexSpin;
  const hr = P.hexR * H * P.zoom;
  const hexDistance = hexagonDistance(hr, rot - Math.PI / 2);

  if (P.halftone) {
    const sw = Math.max(8, Math.round(W / 6)),
      sh = Math.max(8, Math.round(H / 6));
    const SM = cache.get("sample", sw, sh);
    softDraw(SM.x, F.c, P.blur * S * q * (sw / W), 1, "source-over", sw, sh, cache);
    const d = SM.x.getImageData(0, 0, sw, sh).data;
    const field = dotField(P, ph);
    const u = Math.min(W, H) * 0.395 * P.zoom * P.fieldScale;
    const cellPx = spacingPx(P, u);
    const rimWidth = Math.max(cellPx * 2.5, hr * 0.08);
    const base = rgbOf(P.dotColor);
    const base2 = rgbOf(P.dotColor2 || P.dotColor); // dotColor2 未設定時は dotColor へフォールバック
    for (let i = 0; i < field.length; i++) {
      const dt = field[i];
      const px = W / 2 + dt.x * u,
        py = H / 2 + dt.y * u;
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      // 中央六角形は、穴に近いドットほど面積をなめらかに減衰（サイズ変化）させて表現。
      // 粒子渦(motion=3/4)でも同じ画面固定マスク＝軌道（動き）には影響しない。
      const weight = P.hexMask ? hexDotWeight(hexDistance(px - W / 2, py - H / 2), rimWidth) : 1;
      const rx = cellPx * 0.5 * P.dotScale * (0.35 + 0.75 * Math.sqrt(dt.i)) * Math.sqrt(weight);
      const ry = rx * P.dotAspect;
      if (rx < 0.1 * S) continue;
      let col = base,
        sa = 1;
      if (P.dotSource === "blob") {
        const sx = clamp(Math.round((px / W) * sw), 0, sw - 1),
          sy = clamp(Math.round((py / H) * sh), 0, sh - 1);
        const k = (sy * sw + sx) * 4;
        sa = d[k + 3] / 255;
        col = sa > 0.06 ? [d[k], d[k + 1], d[k + 2]] : base;
      } else if (P.dotSource === "gradient") {
        col = gradientRgb(dt.sr, base2, base, P);
      }
      const a = clamp(dt.i * dt.shade * P.dotAlpha * (P.dotSource === "blob" ? 0.25 + 0.75 * sa : 1), 0, 1);
      if (a < 0.02) continue;
      c.fillStyle = cstr(col, a);
      c.beginPath();
      if (Math.abs(P.dotAspect - 1) < 0.02) c.arc(px, py, rx, 0, TAU);
      else c.ellipse(px, py, rx, ry, dt.ang, 0, TAU);
      c.fill();
    }
  } else {
    softDraw(c, F.c, P.blur * S * q, 1, "source-over", W, H, cache);
  }
}

// 最新の LIQUID GLASS 保存設定を初期値として固定。
export const LIQUID_GLASS_DEFAULTS: LiquidGlassParams = {
  zoom: 0.6,
  bg: "#000000",
  hexR: 0.185,
  hexRot: 0,
  hexSpin: 0,
  hexMask: 1,
  halftone: 1,
  density: 78,
  ringR: 0.42,
  thickness: 0.495,
  fieldBlur: 0.225,
  threshold: 0,
  frequency: 7,
  wave: 0.4,
  turbulence: 0,
  swirl: 3,
  contrast: 1.4,
  dotScale: 1,
  dotAspect: 1.04,
  fieldRot: 3,
  fieldScale: 1,
  dotAlpha: 0.65,
  dotSource: "gradient", // 既定＝バイオレット→ティールのグラデーション（Image #8）
  dotColor: "#6a2bff", // 外側＝バイオレット（＋ワードマークのアクセント）
  dotColor2: "#12e3c6", // 内側＝ティール
  animA: 0,
  animB: 3,
  motion: 4, // 既定＝粒子渦（環流＋回転）。導入の「出現→回転開始」と整合しループも回転
  inflow: 1,
  count: 1,
  blend: "lighter",
  wobble: 0.65,
  blur: 0,
  scale: 2,
  seed: 77,
  wordmark: 1,
  wmSize: 0.88,
  wmX: 0.65,
  wmY: 0.515,
  intro: 0,
  transparent: 0,
  circles: [
    { col: "#4b3bf5", x: -0.09, y: -0.05, r: 0.4, a: 0.9, ring: 0.52, wob: 1.0 },
    { col: "#db0000", x: 0.11, y: 0.07, r: 0.34, a: 0.8, ring: 0.6, wob: 1.4 },
    { col: "#2f6bff", x: 0.02, y: 0.13, r: 0.3, a: 0.65, ring: 0.38, wob: 0.8 },
    { col: "#a08bff", x: -0.06, y: 0.02, r: 0.24, a: 0.6, ring: 0.68, wob: 1.2 },
    { col: "#3ad2ff", x: 0.15, y: -0.11, r: 0.2, a: 0.5, ring: 0.48, wob: 1.6 },
    { col: "#ff7ad9", x: -0.17, y: 0.09, r: 0.18, a: 0.45, ring: 0.58, wob: 1.0 },
  ],
};

// 6つのデフォルトカラーパターン。ドット(グラフィック)を単色化し、その色が
// ワードマークのアクセント（「((」「))」）にも連動する（dotColor を共有）。
export const LIQUID_GLASS_PRESETS: Partial<LiquidGlassParams>[] = [
  { dotSource: "gradient", dotColor: "#6a2bff", dotColor2: "#12e3c6", bg: "#000000" }, // グラデ（Image #8）
  { dotSource: "solid", dotColor: "#6a2bff", bg: "#000000" }, // バイオレット
  { dotSource: "solid", dotColor: "#ff2878", bg: "#000000" }, // ピンク（添付画像）
  { dotSource: "solid", dotColor: "#ff4a17", bg: "#000000" }, // オレンジ
  { dotSource: "solid", dotColor: "#aadc00", bg: "#000000" }, // ライム
  { dotSource: "solid", dotColor: "#12e3c6", bg: "#000000" }, // ティール
  { dotSource: "solid", dotColor: "#3c5aff", bg: "#000000" }, // ブルー（添付画像）
];

// controls: HEX HALO と共通の並び（表示→中央の六角形→フォルム→色→モーション→背景）に
// 揃え、モード切替時も同機能セクションが同じ位置に来るようにする。
export const LIQUID_GLASS_CONTROLS: ControlsSpec = [
  ["表示 / VIEW", [["zoom", "ズーム", "r", 0.3, 2.6, 0.01, "×"]]],
  [
    "ロゴ / LOGO",
    [
      ["wordmark", "MOOD METRIX 表示", "c"],
      ["wmSize", "ロゴサイズ", "r", 0.4, 1.6, 0.01, "×"],
      ["wmX", "ロゴ位置 X（左右）", "r", 0.4, 1, 0.005, ""],
      ["wmY", "ロゴ位置 Y（上下）", "r", 0, 1, 0.005, ""],
    ],
  ],
  [
    "中央の六角形 / CENTER",
    [
      ["hexR", "六角形サイズ", "r", 0.05, 0.62, 0.005, ""],
      ["hexRot", "回転", "r", 0, 360, 1, "°"],
      ["hexSpin", "1ループの回転数", "r", -2, 2, 1, "周"],
      ["hexMask", "六角形に沿ってドットを調整", "c"],
    ],
  ],
  [
    "フォルム / FORM",
    [
      ["halftone", "ドット表現", "c"],
      ["density", "密度（格子数）", "r", 24, 180, 1, ""],
      ["ringR", "リング半径", "r", 0.15, 0.9, 0.005, ""],
      ["thickness", "リングの太さ", "r", 0.02, 0.8, 0.005, ""],
      ["fieldBlur", "リングのぼかし", "r", 0.02, 0.5, 0.005, ""],
      ["threshold", "しきい値", "r", 0, 0.6, 0.005, ""],
      ["contrast", "コントラスト", "r", 0, 1.4, 0.01, ""],
      ["frequency", "歪みの周波数", "r", 1, 12, 1, ""],
      ["wave", "歪み量", "r", 0, 2.5, 0.01, ""],
      ["turbulence", "乱れ", "r", 0, 2, 0.01, ""],
      ["swirl", "渦", "r", 0, 3, 0.01, ""],
      ["dotScale", "ドット径", "r", 0.2, 2, 0.01, ""],
      ["dotAspect", "ドット縦横比", "r", 0.3, 2.4, 0.01, ""],
      ["fieldRot", "場の回転", "r", -180, 180, 1, "°"],
      ["fieldScale", "場のスケール", "r", 0.4, 1.8, 0.01, ""],
    ],
  ],
  [
    "色 / COLOR",
    [
      ["dotSource", "ドットの色", "s", ["blob", "solid", "gradient"]],
      ["dotColor", "カラー（単色／グラデ外側）", "k"],
      ["dotColor2", "グラデ内側カラー", "k"],
      ["dotAlpha", "ドットの不透明度", "r", 0, 1, 0.01, ""],
      ["count", "ブラー円の数", "r", 1, 6, 1, ""],
      ["scale", "円のスケール", "r", 0.4, 6, 0.01, ""],
      ["blur", "円のブラー", "r", 0, 140, 1, "px"],
      ["wobble", "円の揺らぎ", "r", 0, 3, 0.05, ""],
      ["blend", "円の合成", "s", ["source-over", "lighter", "multiply"]],
    ],
  ],
  [
    "モーション / MOTION",
    [
      ["motion", "動きのパターン", "o", [["1", "標準"], ["2", "吸い込み（中心へ流入）"], ["3", "粒子渦（環流）"], ["4", "粒子渦（環流＋回転）"]]],
      ["inflow", "吸い込みの強さ", "r", 0, 2, 0.05, ""],
      ["animA", "歪みの周回数", "r", 0, 3, 1, "周"],
      ["animB", "渦の周回数", "r", 0, 3, 1, "周"],
    ],
  ],
  [
    "導入 / INTRO",
    [["intro", "導入アニメ（渦の集結→出現→ロゴ）", "c"]],
  ],
  [
    "背景 / BACKGROUND",
    [
      ["transparent", "背景透過", "c"],
      ["bg", "背景色", "k"],
      ["seed", "シード", "n"],
    ],
  ],
];

const rgbHex = (c: number[]) =>
  "#" +
  c
    .slice(0, 3)
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");

// ハーフトーンのドット場を <circle>/<ellipse> 群で出力（W×H 空間・中央寄せ）。
// 色はブラー円レイヤーからサンプリング（solid時は単色）。blur/背景ブロブ等の
// raster 効果は省略。ロックアップ合成のため W,H を引数化した。
function liquidGlassShapes(
  P: LiquidGlassParams,
  ph: number,
  cache: LayerCache,
  W: number,
  H: number,
): string {
  const S = W / 1280;
  const q = 0.5,
    fw = Math.max(2, Math.round(W * q)),
    fh = Math.max(2, Math.round(H * q));
  const F = cache.get("c3f", fw, fh),
    fx = F.x;
  fx.save();
  fx.scale(q, q);
  fx.globalCompositeOperation = P.blend as GlobalCompositeOperation;
  for (let i = 0; i < P.count; i++) wobblyRing(fx, P.circles[i], i, ph, P, W, H);
  fx.restore();

  let d: Uint8ClampedArray | null = null,
    sw = 0,
    sh = 0;
  if (P.dotSource === "blob") {
    sw = Math.max(8, Math.round(W / 6));
    sh = Math.max(8, Math.round(H / 6));
    const SM = cache.get("sample", sw, sh);
    softDraw(SM.x, F.c, P.blur * S * q * (sw / W), 1, "source-over", sw, sh, cache);
    d = SM.x.getImageData(0, 0, sw, sh).data;
  }

  const field = dotField(P, ph);
  const u = Math.min(W, H) * 0.395 * P.zoom * P.fieldScale;
  const cellPx = spacingPx(P, u);
  const base = rgbOf(P.dotColor);
  const base2 = rgbOf(P.dotColor2 || P.dotColor); // dotColor2 未設定時は dotColor へフォールバック
  const rot = P.hexRot * RAD + ph * TAU * P.hexSpin;
  const hr = P.hexR * H * P.zoom;
  const hexDistance = hexagonDistance(hr, rot - Math.PI / 2);
  const rimWidth = Math.max(cellPx * 2.5, hr * 0.08);
  const shapes: string[] = [];
  for (let i = 0; i < field.length; i++) {
    const dt = field[i];
    const px = W / 2 + dt.x * u,
      py = H / 2 + dt.y * u;
    if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
    // 中央六角形は穴に近いドットほど面積をなめらかに減衰（サイズ変化）。
    const weight = P.hexMask ? hexDotWeight(hexDistance(px - W / 2, py - H / 2), rimWidth) : 1;
    const rx = cellPx * 0.5 * P.dotScale * (0.35 + 0.75 * Math.sqrt(dt.i)) * Math.sqrt(weight);
    const ry = rx * P.dotAspect;
    if (rx < 0.1 * S) continue;
    let col = base,
      sa = 1;
    if (d && P.dotSource === "blob") {
      const sx = clamp(Math.round((px / W) * sw), 0, sw - 1),
        sy = clamp(Math.round((py / H) * sh), 0, sh - 1);
      const k = (sy * sw + sx) * 4;
      sa = d[k + 3] / 255;
      col = sa > 0.06 ? [d[k], d[k + 1], d[k + 2]] : base;
    } else if (P.dotSource === "gradient") {
      col = gradientRgb(dt.sr, base2, base, P);
    }
    const a = clamp(dt.i * dt.shade * P.dotAlpha * (P.dotSource === "blob" ? 0.25 + 0.75 * sa : 1), 0, 1);
    if (a < 0.02) continue;
    const fill = rgbHex(col);
    const o = a.toFixed(3);
    if (Math.abs(P.dotAspect - 1) < 0.02) {
      shapes.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${rx.toFixed(2)}" fill="${fill}" opacity="${o}"/>`);
    } else {
      const deg = ((dt.ang * 180) / Math.PI).toFixed(2);
      shapes.push(
        `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="${fill}" opacity="${o}" transform="rotate(${deg} ${px.toFixed(1)} ${py.toFixed(1)})"/>`,
      );
    }
  }
  return shapes.join("");
}

// 背景色の明度からワードマークのインク色（文字/®）を決める：暗い背景=白, 明るい背景=黒。
const inkFor = (bg: string) => {
  const c = rgbOf(bg);
  return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114 > 150 ? "#000000" : "#ffffff";
};

// ロックアップの配置（render / toSvg で共有）。グラフィックは常に D×D 正方形へ描画し
// （マークの大きさ＝横幅は wordmark の ON/OFF で不変）、ON時は左に固定・OFF時は中央。
// ワードマークは サイズ(wmSize=既定比の倍率) と 中心位置(wmX,wmY=キャンバス比) で調整可能。
function lockupLayout(W: number, H: number, showWord: boolean, P: LiquidGlassParams) {
  const D = H; // グラフィック正方形の一辺（mark は min(D,D) 基準＝ON/OFFで同一サイズ）
  const gy = Math.round((H - D) / 2);
  const gcx = showWord ? W * 0.2 : W / 2; // グラフィック中心X: ON=左寄せ / OFF=中央
  const gx = Math.round(gcx - D / 2);
  if (!showWord) return { D, gx, gy, wx: 0, wy: 0, wmScale: 0 };
  const wmScale = ((H * 0.4) / LOGO_H) * (P.wmSize ?? 1);
  const wmW = LOGO_W * wmScale,
    wmH = LOGO_H * wmScale;
  const cx = W * (P.wmX ?? 0.685),
    cy = H * (P.wmY ?? 0.5);
  return { D, gx, gy, wx: Math.round(cx - wmW / 2), wy: Math.round(cy - wmH / 2), wmScale };
}

// ── 導入（出現）アニメ「テーマ1: 中心で集合→左で確定」──────────────────
// 各区間の長さ（秒）。合計＝導入尺。回転は全区間 phase 直結＝一定速度。
// 構成: A 中心で出現（外周→中心へ一粒ずつポポポ／回転は一定速度で継続）
//       B 中央のまま薄く消失
//       C 現在の場所（左寄せ）で再出現（透明→不透明）
//       D ロゴ(rogo.svg)を左→右へグラデーションワイプで表示
//       E アクセントのみ点滅→点灯で確定し通常ループへ段差なく接続
const INTRO_A = 5.2; // 出現(中心): 外周→中心へ一粒ずつ（radial ポポポ）
const INTRO_B = 1.6; // 消失: 中央のまま薄く消える
const INTRO_C = 2.4; // 再出現: 左寄せで透明→不透明
const INTRO_D = 2.8; // ロゴ: 左→右へグラデーションワイプ
const INTRO_E = 2.0; // 点滅: アクセントのみ→点灯で確定
const INTRO_T = INTRO_A + INTRO_B + INTRO_C + INTRO_D + INTRO_E; // 14.0
export const LIQUID_GLASS_INTRO_SECONDS = INTRO_T;

// アクセント点滅のキーフレーム（進行 e→不透明度）。乱数不使用＝書き出しでも同一。
// 端点は必ず1（D終端＝アクセント点灯／ループ側＝点灯 と連続）。
const FLICKER: [number, number][] = [
  [0, 1], [0.1, 0.22], [0.18, 1], [0.3, 0.34], [0.4, 1], [0.52, 0.58], [0.64, 1], [1, 1],
];
function flickerAlpha(e: number): number {
  const x = clamp(e, 0, 1);
  for (let i = 1; i < FLICKER.length; i++) {
    if (x <= FLICKER[i][0]) {
      const t = (x - FLICKER[i - 1][0]) / (FLICKER[i][0] - FLICKER[i - 1][0]);
      return FLICKER[i - 1][1] + (FLICKER[i][1] - FLICKER[i - 1][1]) * t;
    }
  }
  return 1;
}

// 区間A(中心で出現): 各ドットを、外周→中心の順に一粒ずつ透明→不透明でフェードイン
// （＝ポポポと湧く。出現順のみ制御し、位置は場に従う）。場(motion4)は phase で一定速度に
// 回転し続けるため、回転はそのまま継続する。出現順は半径 sr が大きい(外周)ほど先、
// 小さい(中心寄り)ほど後。per-dot ハッシュで粒立ち。tA=0 で全ドット透明＝完全な黒、
// tA=1 で全ドット不透明＝ drawC3(motion4, phase) と厳密一致（区間B の開始フレームと連続）。
// 呼び出し側が drawC3 と同じ「中央 H×H 正方形」の ctx を渡す（W=H=正方形の一辺）。
function drawIntroReveal(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  tA: number,
  phase: number,
  P: LiquidGlassParams,
) {
  const field = dotField({ ...P, motion: 4 }, phase);
  const u = H * 0.395 * P.zoom * P.fieldScale; // drawC3(正方形の一辺=H) と同一
  const cellPx = spacingPx(P, u);
  const S = H / 1280;
  const rot = P.hexRot * RAD + phase * TAU * P.hexSpin;
  const hr = P.hexR * H * P.zoom;
  const hexDistance = hexagonDistance(hr, rot - Math.PI / 2);
  const rimWidth = Math.max(cellPx * 2.5, hr * 0.08);
  const base = rgbOf(P.dotColor);
  const base2 = rgbOf(P.dotColor2 || P.dotColor); // dotColor2 未設定時は dotColor へフォールバック
  const cx = W / 2,
    cy = H / 2;
  const rOuter = P.ringR + P.thickness * 0.5 + 0.35; // 外周のおおよその最大半径（正規化用）
  // 各粒が透明→不透明になる窓（0..1）。小さめにして一粒ずつくっきり湧かせる（ポポポ）。
  const fadeWin = 0.34;
  for (let i = 0; i < field.length; i++) {
    const dt = field[i];
    const pxt = cx + dt.x * u,
      pyt = cy + dt.y * u; // 目標位置（動かさない）
    if (pxt < -20 || pxt > W + 20 || pyt < -20 || pyt > H + 20) continue;
    // 出現順: 外周(半径大)→中心(半径小)。radial を主にしつつ per-dot ハッシュ(jit)で
    // 一粒ずつ湧かせる。frac で [0,1)、×(1-fadeWin) で最後の粒も tA=1 で完全不透明
    // ＝末端は drawC3(P,0) と厳密一致。
    const rad01 = clamp(dt.sr / rOuter, 0, 1); // 0=中心, 1=外周
    const hsh = Math.sin(i * 127.1 + 311.7) * 43758.5453; // 決定的（乱数不使用）
    const jit = hsh - Math.floor(hsh); // per-dot [0,1)
    let ord = 0.6 * (1 - rad01) + 0.4 * jit; // 外周(rad01≈1)→ord小→先／中心→後
    ord -= Math.floor(ord); // frac → [0,1)
    const order = ord * (1 - fadeWin);
    const a1 = smoothstep(0, 1, clamp((tA - order) / fadeWin, 0, 1)); // 透明→不透明
    if (a1 <= 0) continue; // 未出現
    // 六角形の穴は最初から適用（サイズ変化のみ）。tA=1 で全ドット不透明＝pattern4 と厳密一致。
    const weight = P.hexMask ? hexDotWeight(hexDistance(pxt - cx, pyt - cy), rimWidth) : 1;
    const rx = cellPx * 0.5 * P.dotScale * (0.35 + 0.75 * Math.sqrt(dt.i)) * Math.sqrt(weight);
    if (rx < 0.1 * S) continue;
    const a = clamp(dt.i * dt.shade * P.dotAlpha, 0, 1) * a1; // 不透明度だけを上げる
    if (a < 0.02) continue;
    // 色は drawC3 と一致させる（gradient は半径補間、それ以外は単色）。
    // ＝A末端が pattern4 と厳密一致。blob は導入中は単色フォールバック。
    const col = P.dotSource === "gradient" ? gradientRgb(dt.sr, base2, base, P) : base;
    c.fillStyle = cstr(col, a);
    c.beginPath();
    if (Math.abs(P.dotAspect - 1) < 0.02) c.arc(pxt, pyt, rx, 0, TAU);
    else c.ellipse(pxt, pyt, rx, rx * P.dotAspect, dt.ang, 0, TAU);
    c.fill();
  }
}

// 導入1フレーム。t01=導入進行(0..1)、phase=通常ループ位相（連続で渡す）。
// t01=1 は render(phase) とピクセル一致するよう構成（ループへ段差なく接続）。
function renderLiquidGlassIntro(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  t01: number,
  phase: number,
  P: LiquidGlassParams,
  cache: LayerCache,
) {
  const t = clamp(t01, 0, 1);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.filter = "none";
  c.globalCompositeOperation = "source-over";
  fillBg(c, W, H, P.bg, !!P.transparent);

  const bA = INTRO_A / INTRO_T;
  const bB = (INTRO_A + INTRO_B) / INTRO_T;
  const bC = (INTRO_A + INTRO_B + INTRO_C) / INTRO_T;
  const bD = (INTRO_A + INTRO_B + INTRO_C + INTRO_D) / INTRO_T;

  // A: 中心で出現（外周→中心へ radial に一粒ずつ）。場は phase で一定速度に回転し続ける。
  // 中央 H×H オフスクリーンへ描いて合成（カル/クリップが drawC3 と一致＝A末端が
  // drawC3(motion4, phase) と厳密一致＝B開始と連続）。
  if (t < bA) {
    const Lc = lockupLayout(W, H, false, P);
    const g = cache.get("introGfx", Lc.D, Lc.D);
    g.x.setTransform(1, 0, 0, 1, 0, 0);
    g.x.clearRect(0, 0, Lc.D, Lc.D);
    drawIntroReveal(g.x, Lc.D, Lc.D, t / bA, phase, P);
    c.drawImage(g.c, Lc.gx, Lc.gy);
    return;
  }
  // B: 消失（中央・motion4 をフェードアウト）
  if (t < bB) {
    const tB = (t - bA) / (bB - bA);
    const Lc = lockupLayout(W, H, false, P);
    const g = cache.get("introGfx", Lc.D, Lc.D);
    drawC3(g.x, Lc.D, Lc.D, phase, { ...P, motion: 4, transparent: 1 }, cache);
    c.globalAlpha = 1 - smoothstep(0, 1, tB);
    c.drawImage(g.c, Lc.gx, Lc.gy);
    c.globalAlpha = 1;
    return;
  }
  // C/D/E: 選択中モーションを「現在の場所」で再出現。ワードマーク表示なら左寄せ、
  // 非表示なら中央（＝通常ループと同じ配置。終端が render と一致する）。
  const showWord = P.wordmark == null ? true : !!P.wordmark;
  const L = lockupLayout(W, H, showWord, P);
  const g = cache.get("introGfx", L.D, L.D);
  drawC3(g.x, L.D, L.D, phase, { ...P, transparent: 1 }, cache);
  c.globalAlpha = t < bC ? smoothstep(0, 1, (t - bB) / (bC - bB)) : 1; // C: 透明→不透明
  c.drawImage(g.c, L.gx, L.gy);
  c.globalAlpha = 1;
  // ワードマーク非表示なら D/E のロゴ演出はスキップ（C以降はグラフィックのみを保持）。
  if (t < bC || !showWord) return;

  const ink = inkFor(P.bg);
  // D: ロゴを左→右へグラデーションワイプで出現
  if (t < bD) {
    const w = smoothstep(0, 1, (t - bC) / (bD - bC));
    const wm = cache.get("introWm", W, H);
    const wx = wm.x;
    wx.setTransform(1, 0, 0, 1, 0, 0);
    wx.globalAlpha = 1;
    wx.globalCompositeOperation = "source-over";
    wx.clearRect(0, 0, W, H);
    drawMoodMetrix(wx, L.wx, L.wy, L.wmScale, P.dotColor, ink);
    const span = LOGO_W * L.wmScale;
    const edge = Math.max(8, span * 0.28); // 透明グラデーションの柔らかさ
    const revealX = L.wx - edge + w * (span + 2 * edge);
    wx.globalCompositeOperation = "destination-in";
    const grad = wx.createLinearGradient(revealX - edge, 0, revealX, 0);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    wx.fillStyle = grad;
    wx.fillRect(0, 0, W, H);
    wx.globalCompositeOperation = "source-over";
    c.drawImage(wm.c, 0, 0);
    return;
  }
  // E: アクセントのみ点滅（終端 alpha=1 で確定＝ループへ接続）
  const e = (t - bD) / (1 - bD);
  drawMoodMetrix(c, L.wx, L.wy, L.wmScale, P.dotColor, ink, flickerAlpha(e));
}

export function createLiquidGlass(): CanvasRenderer {
  const cache = new LayerCache();
  return {
    introSeconds: LIQUID_GLASS_INTRO_SECONDS,
    renderIntro(ctx, W, H, t01, phase, params: Params) {
      renderLiquidGlassIntro(ctx, W, H, t01, phase, params as unknown as LiquidGlassParams, cache);
    },
    render(ctx, W, H, phase, params: Params) {
      const P = params as unknown as LiquidGlassParams;
      const showWord = P.wordmark == null ? true : !!P.wordmark;
      const L = lockupLayout(W, H, showWord, P);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      fillBg(ctx, W, H, P.bg, !!P.transparent);
      // グラフィックは透過の正方形オフスクリーンへ描き、合成する（背景は本体で一度だけ塗る）
      const g = cache.get("lockupGfx", L.D, L.D);
      drawC3(g.x, L.D, L.D, phase, { ...P, transparent: 1 }, cache);
      ctx.drawImage(g.c, L.gx, L.gy);
      // 文字/® は背景色に対して自動でコントラスト（暗い背景=白, 明るい背景=黒）。
      if (showWord) drawMoodMetrix(ctx, L.wx, L.wy, L.wmScale, P.dotColor, inkFor(P.bg));
    },
    toSvg({ phase, params }) {
      const P = params as unknown as LiquidGlassParams;
      const W = 1280,
        H = 720;
      const showWord = P.wordmark == null ? true : !!P.wordmark;
      const L = lockupLayout(W, H, showWord, P);
      const shapes = liquidGlassShapes(P, phase, cache, L.D, L.D);
      const bgRect = P.transparent ? "" : `<rect width="${W}" height="${H}" fill="${P.bg}"/>`;
      const gfx = `<g transform="translate(${L.gx} ${L.gy})">${shapes}</g>`;
      const wm = showWord ? moodMetrixSvg(L.wx, L.wy, L.wmScale, P.dotColor, inkFor(P.bg)) : "";
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
        bgRect +
        gfx +
        wm +
        `</svg>`
      );
    },
  };
}
