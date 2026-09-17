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
  edgeFade: number; // 外周ソフトフェード（gradient専用, 0=前段一致 … 1=外縁alphaを透明へ）
  dotScale: number;
  dotAspect: number;
  fieldRot: number;
  fieldScale: number;
  dotAlpha: number;
  armEven: number; // アーム密度均一化（gradient専用、0=無効）
  dotBlur: number; // ドット自体のぼかし（px@1280基準、0=鮮明）
  dotGlow: number; // ドット層の発光（全ソース, 0=無効=従来一致）。既存blur(blob円用)とは別レイヤー
  dotGlowSize: number; // 発光の広がり（ぼかし半径 px@1280基準・実解像度で S=辺/1280 倍）
  dotSource: string; // blob|solid|gradient|gradient3
  dotColor: string; // solid色／gradientの外側色（＋ワードマークのアクセント色）
  dotColor2: string; // gradientの内側色（半径で dotColor へ補間）
  dotColor3: string; // 3色グラデ(gradient3)の中間色（内→中→外で補間）
  gradStart: number; // グラデ内側カラーの始点（-0.6..0.9・0=既定）。内→外の補間が起きる半径窓を動かす
  gradLumaEven: number; // 内側カラーを外側カラーの明るさへ寄せる量（0..1・既定0.85）。0=内側カラーを指定値のまま出す
  innerHide: number; // グラデ内側カラーの非表示（1で内側カラーを使わず外側カラーで代替）
  gradMid: number; // 3色グラデの中間色の位置（0..1・既定0.5）。gradient3 のみ有効
  innerBright: number; // 内側ドットの明るさ倍率（0..2・1=無変換）。穴側の明るさ
  innerAlpha: number; // 内側ドットの不透明度（0..1・1=無変換）。外側へ向けて1へ補間
  outerBright: number; // 外側ドットの明るさ倍率（0..2・1=無変換）。外周の明るさ
  // 色味調整レイヤー（全ソース共通の後段色補正・既定は無変換＝呼び出し前と同一）
  toneHue: number; // 色相シフト（度・-180..180・0=無変換）
  toneSat: number; // 彩度倍率（0..2・1=無変換）
  toneBright: number; // 明るさ倍率（0..2・1=無変換）
  toneTint: number; // 色被せ量（0..1・0=無効）
  toneTintColor: string; // 色被せの色（toneTint>0 のとき各色へ寄せる）
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
  outer: number; // 帯縁(ringR±thickness/2)より外側の距離（0=帯内/内側）。外周フェード用・位置とは無関係
  even: number; // アーム密度均一化の alpha 係数（標準=1・gradient時のみ≠1）
}

// グラデーション配色（Image #8）: 内側(inner=dotColor2)→外側(outer=dotColor)を
// リング半径 sr で補間する。中心付近ティール／外周バイオレット、中間はその混色。
// 濃度均一化: 明るい内側(ティール)の知覚輝度を外側(バイオレット)へ GRAD_LUMA_EVEN 分だけ
// 寄せる。RGB 等倍スケール＝色相・彩度(R:G:B比)は不変・明度のみ低下（k≤1 で増光/クリップなし）。
// 基準を luma(outer) にするのでパレット差替でも自動追従。solid/blob は本関数を通らず不変。
// この補償は「外側カラーの輝度」を基準にするため、暗い外側カラーほど内側カラーが
// 強く暗転する＝外側カラー次第で内側が濁って見える原因になる（既定パレットでは
// 内側 #17f0d9 が #0d8a7d へ、HSL 明度で -43%）。gradLumaEven でその量を可変にし、
// 0 で内側カラーを指定値どおりに描ける。既定は 0.85 ＝ 従来値で出力は完全に不変。
const GRAD_LUMA_EVEN = 0.85; // 0=無補償 … 1=内外を等輝度化（inner/outer≈1.0）
const luma601 = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
// 背景明度ゲート: 黒(0)で前段式にバイト一致・白(1)で白背景向け補償をフル適用（両背景で成立）。
const bgWhiteness = (P: LiquidGlassParams) => clamp((luma601(rgbOf(P.bg)) / 255 - 0.5) / 0.5, 0, 1);
// gradient(2色)/gradient3(3色) を「グラデーション経路」として共通に扱う（各 gate を集約）。
// solid/blob は false ＝従来と完全に同じ経路を通る（バイト一致）。
const isGradient = (P: LiquidGlassParams) => P.dotSource === "gradient" || P.dotSource === "gradient3";
// グラデ内側カラーの実効値。非表示(innerHide)時は外側カラーで代替するので内→外の混色が
// 消え、2色グラデは全面が外側カラーになる（gradient3 は 外→中間→外）。ドットの数/径/濃度や
// armEven・edgeFade は一切通らないので形状と密度は不変。未設定時の dotColor フォールバックは従来どおり。
const innerRgb = (P: LiquidGlassParams) => rgbOf((P.innerHide ? P.dotColor : P.dotColor2) || P.dotColor);
// 白背景の濃度均一化: 高i(=帯中心=各辺の濃い芯)ほど色を白へ寄せ、overlap で暗くなりすぎる
// 飽和天井(≈255-luma)を下げて芯の突出を抑える。色/luma 領域の補償なので motion2 の shade
// (alpha 再増幅)に相殺されない＝白地の主レバー。黒背景は bgWhiteness=0 で完全に無効。
const CORE_LIFT_WHITE = 0.15; // 0=無効 … 白地で芯を白へ寄せる強度（推奨0.08–0.20。過大で芯が白抜け）
// 内側カラーの始点(gradStart): 内→外の補間が起きる半径窓 [w0,w1] そのものを動かす。
// t を clamp((t-gs)/(1-gs)) のように「t空間」で切ると、smoothstep の傾きが非0の点で
// プラトーが終わるため立ち上がりに折れ(C1不連続)が出て輪郭線状のリングに見え、さらに
// 傾きが 1/(1-gs) 倍に圧縮されて2トーンの境界になる。半径窓ごと動かせば両端の傾きは
// smoothstep のまま0＝内側純色からの離陸も外側色への着地も滑らかに繋がる。
//
// 端点は固定オフセットではなくリング形状(thickness/fieldBlur)から引いた目標へ寄せる。
// 目標をリング帯の内側に取るのが要点で、外側端を「ドットが見える限界」まで飛ばすと
// 混色の終端が薄いスカートに逃げ、外側カラーが濃いドットに乗らず痩せて見える
// （既定値で濃度 0.12 まで低下）。下の目標なら窓全域で濃度 0.77 以上を保つ。
//   ・近端(near) = ringR ± thickness/4  … 芯の肩の手前。ここまでが始点側の純色
//   ・遠端(far)  = ringR ± (thickness/2 + fieldBlur) … 濃いドットが残る縁
// +方向は [near, far] が外側へ、-方向は内側へ動く（順序が反転しないよう左右を入替）。
// gs=0 は early return で前段の式そのもの＝solid/blob 同様に全出力バイト一致。
const GRAD_WIN_MIN = 0.22; // 混色区間の最小幅。どの ringR/thickness でもハードエッジ化させない
function gradWindow(P: LiquidGlassParams): [number, number] {
  const w0 = P.ringR - 0.28, w1 = P.ringR + 0.28;
  const gs = isGradient(P) ? clamp(P.gradStart ?? 0, -0.6, 0.9) : 0; // solid/blob では無意味
  if (gs === 0) return [w0, w1]; // 前段一致
  const half = P.thickness / 2;
  const near = half / 2, far = half + Math.max(0.02, P.fieldBlur);
  const u = gs > 0 ? gs / 0.9 : gs / -0.6; // 各方向の振り切りで 1
  const t0 = P.ringR + (gs > 0 ? near : -far); // 窓の内側端の目標
  const t1 = P.ringR + (gs > 0 ? far : -near); // 窓の外側端の目標
  const s0 = w0 + (t0 - w0) * u, s1 = w1 + (t1 - w1) * u;
  return s1 - s0 >= GRAD_WIN_MIN ? [s0, s1] : [s0, s0 + GRAD_WIN_MIN];
}
function gradientRgb(sr: number, i: number, inner: number[], mid: number[], outer: number[], P: LiquidGlassParams): number[] {
  const [w0, w1] = gradWindow(P);
  const t = smoothstep(w0, w1, sr);
  // 2色(gradient): inner→outer を t で線形補間（前段と同一式＝バイト一致）。
  // 3色(gradient3): inner→mid→outer を中間色位置 gradMid で2区間に分けて補間。
  let col: number[];
  if (P.dotSource === "gradient3") {
    const gm = clamp(P.gradMid ?? 0.5, 0.02, 0.98);
    if (t <= gm) {
      const u = t / gm;
      col = [inner[0] + (mid[0] - inner[0]) * u, inner[1] + (mid[1] - inner[1]) * u, inner[2] + (mid[2] - inner[2]) * u];
    } else {
      const u = (t - gm) / (1 - gm);
      col = [mid[0] + (outer[0] - mid[0]) * u, mid[1] + (outer[1] - mid[1]) * u, mid[2] + (outer[2] - mid[2]) * u];
    }
  } else {
    col = [
      inner[0] + (outer[0] - inner[0]) * t,
      inner[1] + (outer[1] - inner[1]) * t,
      inner[2] + (outer[2] - inner[2]) * t,
    ];
  }
  const L0 = luma601(col);
  let out = col;
  if (L0 > 1) {
    const le = clamp(P.gradLumaEven ?? GRAD_LUMA_EVEN, 0, 1);
    const k = Math.min(1, (L0 * (1 - le) + luma601(outer) * le) / L0);
    out = [col[0] * k, col[1] * k, col[2] * k];
  }
  const lift = CORE_LIFT_WHITE * bgWhiteness(P) * clamp(i, 0, 1);
  return lift > 0
    ? [out[0] + (255 - out[0]) * lift, out[1] + (255 - out[1]) * lift, out[2] + (255 - out[2]) * lift]
    : out;
}

// ── 色味調整レイヤー（TONE）────────────────────────────────────────────
// 全ソース(solid/gradient/gradient3/blob)の「最終ドット色」に、色相/彩度/明るさ/色被せを
// per-dot で適用する後段レイヤー。canvas と SVG 書き出しの双方で同一色を焼き込むため、
// ベクター(各<circle fill>)にも調整結果が反映される。既定(hue0/sat1/bright1/tint0)は
// 早期 return で入力配列をそのまま返す＝バイト完全一致。undefined(旧保存物)も既定へ吸収。
function rgb2hsl(c: number[]): [number, number, number] {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (d > 1e-9) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h: number, s: number, l: number): number[] {
  if (s <= 1e-9) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}
function applyTone(rgb: number[], P: LiquidGlassParams): number[] {
  const hue = P.toneHue || 0, sat = P.toneSat ?? 1, bri = P.toneBright ?? 1, tint = P.toneTint || 0;
  if (hue === 0 && sat === 1 && bri === 1 && tint === 0) return rgb; // 無変換＝バイト一致
  let [h, s, l] = rgb2hsl(rgb);
  h = (h + hue / 360) % 1;
  if (h < 0) h += 1;
  s = clamp(s * sat, 0, 1);
  l = clamp(l * bri, 0, 1);
  let out = hsl2rgb(h, s, l);
  if (tint > 0) {
    const tc = rgbOf(P.toneTintColor || "#ffffff");
    out = [out[0] + (tc[0] - out[0]) * tint, out[1] + (tc[1] - out[1]) * tint, out[2] + (tc[2] - out[2]) * tint];
  }
  return out;
}
// 色味調整が既定(無変換)以外か。true のときのみワードマークのアクセント色にもトーンを適用する。
function toneActive(P: LiquidGlassParams): boolean {
  return (P.toneHue || 0) !== 0 || (P.toneSat ?? 1) !== 1 || (P.toneBright ?? 1) !== 1 || (P.toneTint || 0) !== 0;
}

// ドットの半径位置（穴側0→外周1）。内/外の明るさ配分に使う。gradientRgb と同じ窓を
// 使うので、始点(gradStart)を動かしても色の境界と innerBright/outerBright の境界がずれない。
const radialT = (sr: number, P: LiquidGlassParams) => {
  const [w0, w1] = gradWindow(P);
  return smoothstep(w0, w1, sr);
};
// ドット最終色への統合後段: ①内/外の明るさ（半径で innerBright→outerBright を補間しRGBへ乗算）
// ②色味調整レイヤー。既定(inner/outer=1, tone無変換)は入力配列をそのまま返す＝バイト一致。
function applyDotAppearance(col: number[], sr: number, P: LiquidGlassParams): number[] {
  const ib = P.innerBright ?? 1, ob = P.outerBright ?? 1;
  if (ib !== 1 || ob !== 1) {
    const f = ib + (ob - ib) * radialT(sr, P);
    col = [clamp(col[0] * f, 0, 255), clamp(col[1] * f, 0, 255), clamp(col[2] * f, 0, 255)];
  }
  return applyTone(col, P);
}

// 内側ドットの不透明度(innerAlpha)。穴側だけ alpha を落とし、外側へ向けて 1 へ戻す。
// 補間には radialT を使うので、内/外の明るさ(innerBright/outerBright)やグラデの色境界と
// 同じ半径で切り替わる。色ではなく alpha を触るので、ドットの色・径・位置は一切変わらない。
// 既定 1 は係数 1 の early return ＝ canvas / SVG / 導入アニメの全経路でバイト一致。
const innerAlphaF = (sr: number, P: LiquidGlassParams) => {
  const ia = P.innerAlpha ?? 1;
  return ia === 1 ? 1 : ia + (1 - ia) * radialT(sr, P);
};

// per-dot 径係数(coverage)。gradient は白背景で floor を上げ faint を拡大し薄い辺を充填。
// ピーク径(i=1)は 1.10 に固定＝各辺の芯サイズ・凝集は不変。黒背景は floor=0.66 で前段式にバイト一致。
function gradRadiusFactor(i: number, P: LiquidGlassParams): number {
  const s = Math.sqrt(i);
  if (!isGradient(P)) return 0.35 + 0.75 * s;
  const floor = 0.66 + (0.7 - 0.66) * bgWhiteness(P);
  return floor + (1.1 - floor) * s;
}

// 濃度均一化(gradient): alpha に入る強度を per-dot で写像。
// - faint(i→0) は floor で下限リフト（黒背景で黒沈み緩和・前段）。
// - dense(i→1) は白背景のみ ceil<1 で頭打ち（芯の過度な暗さを抑制。初期はほぼ無効＝色lift優先）。
// 黒背景は ceil=1.0 で前段式にバイト一致。solid/blob はゲートで raw i を返し完全不変。3経路が同一式。
const GRAD_ALPHA_FLOOR = 0.15; // faint 下限（黒沈み緩和・前段）
const GRAD_ALPHA_CEIL_WHITE = 0.95; // 白地の dense 上限（初期ほぼ無効）。黒=1.0で前段一致
const EDGE_FADE_SPAN = 1.6; // 外周フェード全長 = sig(=max(0.012,fieldBlur)) × これ
const alphaI = (i: number, P: LiquidGlassParams, outer = 0) => {
  if (!isGradient(P)) return i; // solid/blob は raw i＝完全不変（floor 概念なし）
  const ceil = 1 + (GRAD_ALPHA_CEIL_WHITE - 1) * bgWhiteness(P);
  const a = GRAD_ALPHA_FLOOR + (ceil - GRAD_ALPHA_FLOOR) * i;
  // 外周ソフトフェード: 帯の外側ほど alpha を floor なしへ近づけ、
  // 場の打ち切り直前も連続的に透明へ落として
  // 輪郭の「切れ(a≈floor*dotAlpha の環がプツッと消える)」を無くす。帯縁(outer=0)/edgeFade=0 で前段一致。
  if (P.edgeFade > 0 && outer > 0) {
    const g = smoothstep(0, Math.max(0.012, P.fieldBlur) * EDGE_FADE_SPAN, outer);
    const faded = ceil * i * smoothstep(0.015, 0.08, i);
    return a + (faded - a) * P.edgeFade * g;
  }
  return a;
};

// アーム密度均一化(gradient): 各ドットの描画輝度プロキシ w=alphaI(i)·gradRadiusFactor(i)² を
// 角度θ=atan2(y,x)でフーリエ展開し、腕骨格を除いた低〜中次ムラを打ち消す係数を Dot.even に保存。
// 実測(既定 frequency=7)では角度ムラは3次(8.4%)・4次(15.5%)が支配的で、1,2次はほぼ皆無。
// よって 1〜(frequency−2)次を補正対象とし、腕=frequency次とその隣接(±1=サイドバンド)は除外＝
// 7アーム骨格は不変。位置(x,y,sr,ang)は読むだけ。
const ARM_EVEN_MAXHARM = 6; // 補正の最大次数（コスト上限）。実次数は frequency−2 で頭打ち
const ARM_EVEN_LIMIT = 0.5; // per-dot 係数の上下限(±)。暴走防止
// m 次が腕骨格(=frequency の正の整数倍)の±1以内か＝補正から除外すべきか
function isArmHarmonic(m: number, freq: number): boolean {
  for (let k = 1; m + 1 >= k * freq; k++) if (Math.abs(m - k * freq) <= 1) return true;
  return false;
}
function applyArmEven(out: Dot[], P: LiquidGlassParams) {
  if (!isGradient(P) || !(P.armEven > 0)) return; // undefined/0/solid/blob は完全不変
  const freq = Math.max(2, Math.round(P.frequency));
  const mmax = Math.min(ARM_EVEN_MAXHARM, Math.max(2, freq - 2));
  const ms: number[] = []; // 補正対象の次数（腕骨格±1を除外）
  for (let m = 1; m <= mmax; m++) if (!isArmHarmonic(m, freq)) ms.push(m);
  if (!ms.length) return; // frequency が小さすぎて安全に均せる次数が無い
  // 描画輝度プロキシの角度別 総和 を各対象次数でフーリエ係数化（DC＋cos/sin）
  let sw = 0;
  const cs: Record<number, number> = {},
    sn: Record<number, number> = {};
  for (const m of ms) {
    cs[m] = 0;
    sn[m] = 0;
  }
  for (const d of out) {
    const rf = gradRadiusFactor(d.i, P);
    const w = alphaI(d.i, P) * rf * rf; // 面積×不透明度の近似（色/hexは低次で無視可）
    const th = Math.atan2(d.y, d.x);
    sw += w;
    for (const m of ms) {
      cs[m] += w * Math.cos(m * th);
      sn[m] += w * Math.sin(m * th);
    }
  }
  if (sw < 1e-6) return;
  for (const d of out) {
    const th = Math.atan2(d.y, d.x);
    let rel = 0; // その角度の（腕を除く）ムラ（平均からの相対偏差）
    for (const m of ms) {
      rel += (2 / sw) * (cs[m] * Math.cos(m * th) + sn[m] * Math.sin(m * th));
    }
    // rel>0 の角度は密＝薄く、rel<0 は疎＝濃く。armEven で強度調整、±LIMIT でクランプ。
    d.even = clamp(1 - P.armEven * rel, 1 - ARM_EVEN_LIMIT, 1 + ARM_EVEN_LIMIT);
  }
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
      // 濃度均一化(gradient): 2ローブ角度変調の振幅を半減し帯太さのムラを抑える。
      const light = 0.9 + (isGradient(P) ? 0.03 : 0.1) * Math.sin(sa * 2 - phaseA);
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
        // 濃度均一化(gradient): 螺旋ハイライトの振幅を弱め帯中心の突出を抑える（意匠は維持）。
        shade = 1 + (isGradient(P) ? 0.3 : 0.7) * P.inflow * wavePhase * inten;
      }
      // outer: 帯縁より外側のみ dOut（既存 sr/ringR/dOut を読むだけ・位置へ書戻さない）。内側/穴側は0。
      out.push({ x: rx0, y: ry0, i: inten, ang: wa + Math.PI / 2 + rotation, sr, shade, outer: sr > ringR ? dOut : 0, even: 1 });
    }
  applyArmEven(out, P); // 各アーム密度の均一化（gradient専用・位置不変・7次=腕は不変）
  return out;
}

// 発光を下に敷き、その上にドット層を合成。dotBlur=0 なら芯は鮮明なまま。
// 全ソース(solid/gradient/blob)で有効。dl 依存の純関数＝決定的・ph0==ph1 でシームレス。
function compositeDotGlow(
  c: CanvasRenderingContext2D,
  dl: HTMLCanvasElement,
  glowPx: number,
  glowStrength: number,
  W: number,
  H: number,
  cache: LayerCache,
  blurPx: number,
) {
  if (glowStrength > 0 && glowPx > 0.3) {
    softDraw(c, dl, glowPx, glowStrength, "lighter", W, H, cache);
  }
  softDraw(c, dl, blurPx, 1, "source-over", W, H, cache);
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
    const base2 = innerRgb(P); // 内側カラー（非表示時は外側カラー／未設定時は dotColor）
    const base3 = rgbOf(P.dotColor3 || P.dotColor); // gradient3 の中間色。未設定時は dotColor
    // 発光(dotGlow): 有効時は透明レイヤ(DL)へ描き後段でぼかし加算＋鮮明な芯を等倍重ね。
    // 無効時は c へ直接＝中間レイヤ皆無で従来とバイト一致。glowPx は S=W/1280 でスケール。
    const glowPx = (P.dotGlow || 0) > 0 ? (P.dotGlowSize || 0) * S : 0;
    const glowOn = (P.dotGlow || 0) > 0 && glowPx > 0.3;
    const blurPx = Math.max(0, P.dotBlur || 0) * S;
    const DL = glowOn || blurPx > 0.3 ? cache.get("dotGlowLayer", W, H) : null;
    const tg = DL ? DL.x : c;
    if (DL) {
      DL.x.setTransform(1, 0, 0, 1, 0, 0);
      DL.x.clearRect(0, 0, W, H);
      DL.x.globalAlpha = 1;
      DL.x.filter = "none";
      DL.x.globalCompositeOperation = "source-over";
    }
    for (let i = 0; i < field.length; i++) {
      const dt = field[i];
      const px = W / 2 + dt.x * u,
        py = H / 2 + dt.y * u;
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      // 中央六角形は、穴に近いドットほど面積をなめらかに減衰（サイズ変化）させて表現。
      // 粒子渦(motion=3/4)でも同じ画面固定マスク＝軌道（動き）には影響しない。
      const weight = P.hexMask ? hexDotWeight(hexDistance(px - W / 2, py - H / 2), rimWidth) : 1;
      const rx = cellPx * 0.5 * P.dotScale * gradRadiusFactor(dt.i, P) * Math.sqrt(weight);
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
      } else if (isGradient(P)) {
        col = gradientRgb(dt.sr, dt.i, base2, base3, base, P);
      }
      col = applyDotAppearance(col, dt.sr, P); // 内/外明るさ＋色味調整（既定は無変換）
      // edgeFade(alphaI 第3引数=dt.outer)と armEven(*dt.even) を alpha に同時適用（色/径/cull は不変）。
      const a = clamp(alphaI(dt.i, P, dt.outer) * dt.shade * dt.even * P.dotAlpha * innerAlphaF(dt.sr, P) * (P.dotSource === "blob" ? 0.25 + 0.75 * sa : 1), 0, 1);
      if (a < (isGradient(P) && P.edgeFade > 0 && dt.outer > 0 ? 0.001 : 0.02)) continue;
      tg.fillStyle = cstr(col, a);
      tg.beginPath();
      if (Math.abs(P.dotAspect - 1) < 0.02) tg.arc(px, py, rx, 0, TAU);
      else tg.ellipse(px, py, rx, ry, dt.ang, 0, TAU);
      tg.fill();
    }
    if (DL) compositeDotGlow(c, DL.c, glowPx, P.dotGlow, W, H, cache, blurPx);
  } else {
    softDraw(c, F.c, P.blur * S * q, 1, "source-over", W, H, cache);
  }
}

// 最新の LIQUID GLASS 保存設定を初期値として固定。
export const LIQUID_GLASS_DEFAULTS: LiquidGlassParams = {
  zoom: 0.6,
  bg: "#ffffff", // 既定＝白背景（最新save／Image #12）。濃度均一化も白背景基準で調整
  hexR: 0.185,
  hexRot: 0,
  hexSpin: 0,
  hexMask: 1,
  halftone: 1,
  density: 89,
  ringR: 0.585,
  thickness: 0.37,
  fieldBlur: 0.21,
  threshold: 0,
  frequency: 7,
  wave: 0.64,
  turbulence: 0,
  swirl: 3,
  contrast: 1.4,
  edgeFade: 1, // 外周を透明までフェード。0でフェード無効
  dotScale: 1,
  dotAspect: 1.04,
  fieldRot: 3,
  fieldScale: 1,
  dotAlpha: 0.48,
  armEven: 1, // 各アーム密度の均一化（左上の薄さを補正）
  dotBlur: 1.2,
  dotGlow: 0.35, // ドット層の淡い発光（Image #14 の violet アーム）。0で全経路バイト一致
  dotGlowSize: 14, // 発光の広がり（px@1280）
  dotSource: "gradient", // 既定＝バイオレット→ティールのグラデーション（Image #8）
  dotColor: "#6a2bff", // 外側＝バイオレット（＋ワードマークのアクセント）
  dotColor2: "#17f0d9", // 内側＝やや明るい cyan 寄り teal（Image #12 の内側発色）
  dotColor3: "#3d6bff", // 3色グラデ(gradient3)の中間色。既定 gradient では未使用
  gradStart: 0, // グラデ内側カラーの始点（0=従来どおり）
  gradLumaEven: 0.85, // 内側→外側への明るさ追従（0.85=従来の固定値。0で内側カラーの濁りが消える）
  innerHide: 0, // グラデ内側カラーの非表示（0=表示）
  gradMid: 0.5, // 3色グラデの中間色の位置（0..1）
  innerBright: 1, // 内側ドットの明るさ倍率（1=無変換）
  innerAlpha: 1, // 内側ドットの不透明度（1=無変換）
  outerBright: 1, // 外側ドットの明るさ倍率（1=無変換）
  toneHue: 0, // 色味調整レイヤー: 既定は全て無変換＝既存の全出力とバイト一致
  toneSat: 1,
  toneBright: 1,
  toneTint: 0,
  toneTintColor: "#ffffff",
  animA: 1,
  animB: 0,
  motion: 2, // 既定＝吸い込み（最新save）。この静止形状を基準に濃度均一を狙う
  inflow: 1.25,
  count: 1,
  blend: "lighter",
  wobble: 0,
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
  { dotSource: "gradient", dotColor: "#4a44ff", dotColor2: "#23ecd8", bg: "#000000", zoom: 0.95, dotAlpha: 0.78 }, // ティール→ロイヤルブルー・黒背景（添付画像 上）
  { dotSource: "gradient", dotColor: "#4a44ff", dotColor2: "#23ecd8", bg: "#ffffff", zoom: 0.95, dotAlpha: 0.72, toneSat: 1.25, toneBright: 0.95 }, // ティール→ロイヤルブルー・白背景（添付画像 下・色味調整で彩度/明るさ最適化）
  { dotSource: "gradient", dotColor: "#6a2bff", dotColor2: "#17f0d9", bg: "#000000" }, // グラデ（Image #8/#12）
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
      ["edgeFade", "外周フェード", "r", 0, 1, 0.01, ""],
      ["threshold", "しきい値", "r", 0, 0.6, 0.005, ""],
      ["contrast", "コントラスト", "r", 0, 1.4, 0.01, ""],
      ["armEven", "アーム密度の均一化", "r", 0, 1, 0.05, ""],
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
      ["dotSource", "ドットの色", "o", [["blob", "円から採色"], ["solid", "単色"], ["gradient", "2色グラデ"], ["gradient3", "3色グラデ"]]],
      ["dotColor", "カラー（単色／グラデ外側）", "k"],
      ["dotColor2", "グラデ内側カラー", "k"],
      ["gradStart", "グラデ内側カラーの始点", "r", -0.6, 0.9, 0.01, ""],
      ["gradLumaEven", "外側カラーへの明るさ追従", "r", 0, 1, 0.01, ""],
      ["innerHide", "グラデ内側カラーを非表示", "c"],
      ["dotAlpha", "ドットの不透明度", "r", 0, 1, 0.01, ""],
      ["dotBlur", "ドットのぼかし", "r", 0, 12, 0.1, "px"],
      ["dotGlow", "ドットの発光", "r", 0, 1, 0.01, ""],
      ["dotGlowSize", "発光の広がり", "r", 0, 60, 1, "px"],
      ["count", "ブラー円の数", "r", 1, 6, 1, ""],
      ["scale", "円のスケール", "r", 0.4, 6, 0.01, ""],
      ["blur", "円のブラー", "r", 0, 140, 1, "px"],
      ["wobble", "円の揺らぎ", "r", 0, 3, 0.05, ""],
      ["blend", "円の合成", "s", ["source-over", "lighter", "multiply"]],
    ],
  ],
  [
    "見え方 / APPEARANCE",
    [
      ["innerBright", "内側の明るさ", "r", 0, 2, 0.01, "×"],
      ["innerAlpha", "内側の不透明度", "r", 0, 1, 0.01, ""],
      ["outerBright", "外側の明るさ", "r", 0, 2, 0.01, "×"],
    ],
  ],
  [
    "3色グラデ / 3-COLOR",
    [
      ["dotColor3", "グラデ中間カラー", "k"],
      ["gradMid", "中間色の位置", "r", 0.05, 0.95, 0.01, ""],
    ],
    { key: "dotSource", equals: "gradient3" }, // 3色グラデ選択時のみ表示
  ],
  [
    "色味調整 / TONE",
    [
      ["toneHue", "色相シフト", "r", -180, 180, 1, "°"],
      ["toneSat", "彩度", "r", 0, 2, 0.01, "×"],
      ["toneBright", "明るさ", "r", 0, 2, 0.01, "×"],
      ["toneTint", "色被せ量", "r", 0, 1, 0.01, ""],
      ["toneTintColor", "色被せカラー", "k"],
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

// ワードマークのアクセント色。色味調整ON時は dotColor にも同じトーンを適用し、ドット群とロゴの
// アクセントを同一トーンへ揃える。既定(無変換)は dotColor をそのまま返す＝従来出力とバイト一致。
const accentColor = (P: LiquidGlassParams) =>
  toneActive(P) ? rgbHex(applyTone(rgbOf(P.dotColor), P)) : P.dotColor;

// ハーフトーンのドット場を <circle>/<ellipse> 群で出力（W×H 空間・中央寄せ）。
// 色はブラー円レイヤーからサンプリング（solid時は単色）。背景ブロブは省略。
// ドットのぼかし・発光は toSvg のフィルターで再現する。
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
  const base2 = innerRgb(P); // 内側カラー（非表示時は外側カラー／未設定時は dotColor）
  const base3 = rgbOf(P.dotColor3 || P.dotColor); // gradient3 の中間色。未設定時は dotColor
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
    const rx = cellPx * 0.5 * P.dotScale * gradRadiusFactor(dt.i, P) * Math.sqrt(weight);
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
    } else if (isGradient(P)) {
      col = gradientRgb(dt.sr, dt.i, base2, base3, base, P);
    }
    col = applyDotAppearance(col, dt.sr, P); // 内/外明るさ＋色味調整（既定は無変換＝<circle fill> もバイト一致）
    const a = clamp(alphaI(dt.i, P, dt.outer) * dt.shade * dt.even * P.dotAlpha * innerAlphaF(dt.sr, P) * (P.dotSource === "blob" ? 0.25 + 0.75 * sa : 1), 0, 1);
    if (a < (isGradient(P) && P.edgeFade > 0 && dt.outer > 0 ? 0.001 : 0.02)) continue;
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
  cache: LayerCache, // 発光(グロー)合成用
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
  const base2 = innerRgb(P); // 内側カラー（非表示時は外側カラー／未設定時は dotColor）
  const base3 = rgbOf(P.dotColor3 || P.dotColor); // gradient3 の中間色。未設定時は dotColor
  const cx = W / 2,
    cy = H / 2;
  const rOuter = P.ringR + P.thickness * 0.5 + 0.35; // 外周のおおよその最大半径（正規化用）
  // 各粒が透明→不透明になる窓（0..1）。小さめにして一粒ずつくっきり湧かせる（ポポポ）。
  const fadeWin = 0.34;
  // 発光(グロー): drawC3 と同一機構。A末端(tA=1)==drawC3(motion4) の継ぎ目一致に必須。S=H/1280。
  const glowPx = (P.dotGlow || 0) > 0 ? (P.dotGlowSize || 0) * S : 0;
  const glowOn = (P.dotGlow || 0) > 0 && glowPx > 0.3;
  const blurPx = Math.max(0, P.dotBlur || 0) * S;
  const DL = glowOn || blurPx > 0.3 ? cache.get("dotGlowLayer", W, H) : null;
  const tg = DL ? DL.x : c;
  if (DL) {
    DL.x.setTransform(1, 0, 0, 1, 0, 0);
    DL.x.clearRect(0, 0, W, H);
    DL.x.globalAlpha = 1;
    DL.x.filter = "none";
    DL.x.globalCompositeOperation = "source-over";
  }
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
    const rx = cellPx * 0.5 * P.dotScale * gradRadiusFactor(dt.i, P) * Math.sqrt(weight);
    if (rx < 0.1 * S) continue;
    const a = clamp(alphaI(dt.i, P, dt.outer) * dt.shade * dt.even * P.dotAlpha * innerAlphaF(dt.sr, P), 0, 1) * a1; // 不透明度だけを上げる
    if (a < (isGradient(P) && P.edgeFade > 0 && dt.outer > 0 ? 0.001 : 0.02)) continue;
    // 色は drawC3 と一致させる（gradient は半径補間、それ以外は単色）＋色味調整レイヤー。
    // ＝A末端が pattern4 と厳密一致。blob は導入中は単色フォールバック。
    const col = applyDotAppearance(isGradient(P) ? gradientRgb(dt.sr, dt.i, base2, base3, base, P) : base, dt.sr, P);
    tg.fillStyle = cstr(col, a);
    tg.beginPath();
    if (Math.abs(P.dotAspect - 1) < 0.02) tg.arc(pxt, pyt, rx, 0, TAU);
    else tg.ellipse(pxt, pyt, rx, rx * P.dotAspect, dt.ang, 0, TAU);
    tg.fill();
  }
  if (DL) compositeDotGlow(c, DL.c, glowPx, P.dotGlow, W, H, cache, blurPx);
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
    drawIntroReveal(g.x, Lc.D, Lc.D, t / bA, phase, P, cache);
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
    drawMoodMetrix(wx, L.wx, L.wy, L.wmScale, accentColor(P), ink);
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
  drawMoodMetrix(c, L.wx, L.wy, L.wmScale, accentColor(P), ink, flickerAlpha(e));
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
      if (showWord) drawMoodMetrix(ctx, L.wx, L.wy, L.wmScale, accentColor(P), inkFor(P.bg));
    },
    toSvg({ phase, params }) {
      const P = params as unknown as LiquidGlassParams;
      const W = 1280,
        H = 720;
      const showWord = P.wordmark == null ? true : !!P.wordmark;
      const L = lockupLayout(W, H, showWord, P);
      const shapes = liquidGlassShapes(P, phase, cache, L.D, L.D);
      const blurPx = Math.max(0, P.dotBlur || 0) * L.D / 1280;
      const glowPx = Math.max(0, P.dotGlowSize || 0) * L.D / 1280;
      const glowOn = P.dotGlow > 0 && glowPx > 0.3;
      const blurOn = blurPx > 0.3;
      const pad = Math.ceil(Math.max(blurPx, glowOn ? glowPx : 0) * 4);
      const effects = blurOn || glowOn
        ? `<defs><filter id="liquid-dot-effects" filterUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${L.D + pad * 2}" height="${L.D + pad * 2}" color-interpolation-filters="sRGB">` +
          (glowOn ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${glowPx.toFixed(2)}" result="halo"/><feComponentTransfer in="halo" result="glow"><feFuncA type="linear" slope="${P.dotGlow}"/></feComponentTransfer>` : "") +
          (blurOn ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${blurPx.toFixed(2)}" result="core"/>` : "") +
          `<feMerge>${glowOn ? '<feMergeNode in="glow"/>' : ""}<feMergeNode in="${blurOn ? "core" : "SourceGraphic"}"/></feMerge></filter></defs>`
        : "";
      const bgRect = P.transparent ? "" : `<rect width="${W}" height="${H}" fill="${P.bg}"/>`;
      const gfx = `<g transform="translate(${L.gx} ${L.gy})"><g${effects ? ' filter="url(#liquid-dot-effects)"' : ""}>${shapes}</g></g>`;
      const wm = showWord ? moodMetrixSvg(L.wx, L.wy, L.wmScale, accentColor(P), inkFor(P.bg)) : "";
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
        effects +
        bgRect +
        gfx +
        wm +
        `</svg>`
      );
    },
  };
}
