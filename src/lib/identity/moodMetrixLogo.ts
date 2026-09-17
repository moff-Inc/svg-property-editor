// MOOD METRIX ワードマーク（Downloads/rogo.svg をインライン化）。
// 元 SVG の viewBox は 0 0 315 122。fill 別に3分類:
//  - LETTERS(元 white): 文字。白のまま。
//  - ACCENT(元 #5A00FF): 「((」「))」= 色替え対象（テーマ/アクセント色に連動）。
//  - MARK(元 black): ® マーク。黒のまま（黒背景では実質不可視）。
export const LOGO_W = 315;
export const LOGO_H = 122;

export interface MoodMetrixAccentGradient {
  kind: "mirrored-gradient";
  inner: string;
  middle: string;
  outer: string;
  innerAlpha?: number;
  outerAlpha?: number;
}

export type MoodMetrixAccent = string | string[] | MoodMetrixAccentGradient;

const LETTERS: string[] = [
  "M131.429 121.14V79.5599C131.429 77.8499 130.049 76.4699 128.339 76.4699H115.359V66.1699H159.199V76.4699H146.299C144.589 76.4699 143.209 77.8499 143.209 79.5599V121.14H131.419H131.429Z",
  "M196.74 121.14L186.82 103.05C186.28 102.06 185.24 101.44 184.11 101.44H180.46C178.75 101.44 177.37 102.82 177.37 104.53V121.14H165.67V66.1699H191.38C202.84 66.1699 209.84 73.6699 209.84 83.8899C209.84 94.1099 203.74 98.8099 197.81 100.21L210.17 121.14H196.74ZM189.65 76.2299H180.46C178.75 76.2299 177.37 77.6099 177.37 79.3199V88.2999C177.37 90.0099 178.75 91.3899 180.46 91.3899H189.65C194.35 91.3899 197.89 88.4199 197.89 83.8099C197.89 79.1999 194.35 76.2299 189.65 76.2299Z",
  "M218.67 121.14V66.1699H230.37V121.14H218.67Z",
  "M277.101 121.14L264.611 102.89C264.001 101.99 262.681 101.99 262.061 102.89L249.491 121.14H235.561L254.251 94.7299C255.001 93.6699 255.011 92.2399 254.261 91.1699L236.801 66.1699H250.731L262.051 83.0299C262.661 83.9499 264.011 83.9399 264.621 83.0299L275.781 66.1699H289.871L272.411 91.0899C271.661 92.1599 271.661 93.5799 272.411 94.6499L291.101 121.14H277.091H277.101Z",
  "M43.1 66.1699L31.19 96.7599C30.68 98.0699 28.82 98.0699 28.31 96.7599L16.4 66.1699H0V121.14H11.7V87.0399C11.7 85.8999 13.27 85.5999 13.69 86.6599L26.4 119.11H33.1L45.81 86.6599C46.23 85.5999 47.8 85.8999 47.8 87.0399V121.14H59.59V66.1699H43.11H43.1Z",
  "M84.4504 98.2299H105.27V88.1799H84.4504C82.7404 88.1799 81.3604 86.7999 81.3604 85.0899V79.3199C81.3604 77.6099 82.7404 76.2299 84.4504 76.2299H108.55V66.1799H69.6504V121.15H108.55V111.02H84.4504C82.7404 111.02 81.3604 109.64 81.3604 107.93V101.34C81.3604 99.6299 82.7404 98.2499 84.4504 98.2499V98.2299Z",
  "M239.029 56.1099V1.13989H260.699C277.929 1.13989 289.879 12.0999 289.879 28.6699C289.879 45.2399 277.929 56.1099 260.699 56.1099H239.029ZM250.729 42.7199C250.729 44.4299 252.109 45.8099 253.819 45.8099H260.699C271.579 45.8099 277.929 37.9799 277.929 28.6699C277.929 19.3599 271.999 11.4499 260.699 11.4499H253.819C252.109 11.4499 250.729 12.8299 250.729 14.5399V42.7299V42.7199Z",
  "M43.1098 1.13989L31.1998 31.7299C30.6898 33.0399 28.8298 33.0399 28.3198 31.7299L16.4098 1.13989H0.00976562V56.1099H11.7097V22.0099C11.7097 20.8699 13.2798 20.5699 13.6998 21.6299L26.4098 54.0799H33.1098L45.8198 21.6299C46.2398 20.5699 47.8098 20.8699 47.8098 22.0099V56.1099H59.5898V1.13989H43.1098Z",
  "M171.7 12.25C179.07 12.25 187.58 17.35 187.58 28.63C187.58 39.91 179.08 45 171.7 45C164.32 45 155.83 39.92 155.83 28.63C155.83 17.34 164.33 12.25 171.7 12.25ZM171.7 0C157.94 0 143.33 10.03 143.33 28.63C143.33 47.23 157.95 57.25 171.7 57.25C185.45 57.25 200.08 47.22 200.08 28.63C200.08 10.04 185.46 0 171.7 0Z",
  "M126.95 12.25C134.32 12.25 142.83 17.35 142.83 28.63C142.83 39.91 134.33 45 126.95 45C119.57 45 111.08 39.92 111.08 28.63C111.08 17.34 119.58 12.25 126.95 12.25ZM126.95 0C113.19 0 98.5801 10.03 98.5801 28.63C98.5801 47.23 113.2 57.25 126.95 57.25C140.7 57.25 155.33 47.22 155.33 28.63C155.33 10.04 140.71 0 126.95 0Z",
];

// LETTERS と同じ順序の各文字中心。導入時だけ、文字単位の出現スケールに使う。
export const MOOD_METRIX_LETTER_CENTERS: readonly (readonly [number, number])[] = [
  [137.3, 93.65],
  [187.75, 93.65],
  [224.52, 93.65],
  [263.33, 93.65],
  [29.8, 93.65],
  [89.1, 93.65],
  [264.45, 28.6],
  [29.8, 28.6],
  [171.7, 28.6],
  [126.95, 28.6],
];

const ACCENT: string[] = [
  "M198.6 0.770073C221.4 8.78007 222.31 45.6401 200.69 55.6601C200.01 55.9601 199.39 56.2001 198.6 56.4601C197.16 56.9601 195.96 55.1401 196.97 54.0201C203.45 47.1101 207.03 38.1301 206.86 28.6201C207.02 19.2701 203.61 10.4001 197.27 3.56007C195.9 2.40007 196.82 0.300073 198.6 0.770073Z",
  "M216.011 3.36005C230.781 9.96005 235.521 30.29 227.221 43.66C224.541 48.06 220.781 51.8001 216.011 53.8901C215.481 54.1101 214.881 53.8601 214.661 53.3301C214.471 52.9001 214.631 52.4801 214.901 52.1501C225.421 37.2801 225.451 19.96 214.901 5.10005C214.131 4.27005 214.911 2.94005 216.011 3.36005Z",
  "M101.35 3.56012C95.0103 10.4001 91.6003 19.2701 91.7603 28.6201C91.5903 38.1301 95.1702 47.1101 101.65 54.0201C102.2 54.6601 102.13 55.6201 101.5 56.1701C101.08 56.5301 100.52 56.6301 100.02 56.4701C98.5403 56.0001 97.3203 55.4201 96.0103 54.6701C79.0303 44.7601 77.6702 17.5201 92.4702 5.09012C94.7502 3.21012 97.1803 1.69012 100.02 0.780118C100.82 0.520118 101.68 0.950119 101.95 1.75012C102.2 2.46012 101.84 3.10012 101.35 3.57012V3.56012Z",
  "M83.7202 5.10005C73.1702 19.96 73.2002 37.2801 83.7202 52.1501C84.4902 52.9801 83.7102 54.31 82.6102 53.89C65.0702 45.93 62.2702 20.2201 76.2602 7.59005C78.1702 5.87005 80.1802 4.38005 82.6102 3.37005C83.1302 3.15005 83.7402 3.40005 83.9602 3.92005C84.1502 4.35005 83.9902 4.77005 83.7202 5.10005Z",
];

const MARK: string[] = [
  "M304.42 118.99C299.87 118.99 296.34 115.35 296.34 110.63C296.34 105.91 299.87 102.29 304.42 102.29C308.97 102.29 312.5 105.93 312.5 110.63C312.5 115.33 308.95 118.99 304.42 118.99ZM304.42 100.11C298.64 100.11 294.01 104.83 294.01 110.61C294.01 116.39 298.65 121.14 304.42 121.14C310.19 121.14 314.89 116.42 314.89 110.61C314.89 104.8 310.2 100.11 304.42 100.11Z",
  "M304.609 110.07H303.21V106.91H304.609C305.749 106.91 306.4 107.51 306.4 108.5C306.4 109.49 305.739 110.07 304.609 110.07ZM308.91 108.47C308.91 106.45 307.22 104.83 305.01 104.83H300.77V116.24H303.22V112.14H304.049L306.22 116.24H309.01L306.59 111.83C307.99 111.29 308.919 110.04 308.919 108.47H308.91Z",
];

let _cache: { letters: Path2D[]; accent: Path2D[]; mark: Path2D[] } | null = null;
function paths() {
  if (!_cache)
    _cache = {
      letters: LETTERS.map((d) => new Path2D(d)),
      accent: ACCENT.map((d) => new Path2D(d)),
      mark: MARK.map((d) => new Path2D(d)),
    };
  return _cache;
}

const isAccentGradient = (accent: MoodMetrixAccent): accent is MoodMetrixAccentGradient =>
  typeof accent === "object" && !Array.isArray(accent) && accent.kind === "mirrored-gradient";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const colorWithAlpha = (color: string, alpha: number) => {
  const a = clamp01(alpha);
  if (a >= 1) return color;
  const hex = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!hex) return color;
  return `rgba(${parseInt(hex[1], 16)}, ${parseInt(hex[2], 16)}, ${parseInt(hex[3], 16)}, ${Number(a.toFixed(4))})`;
};

const addGradientStops = (
  gradient: CanvasGradient,
  start: string,
  middle: string,
  end: string,
  startAlpha = 1,
  endAlpha = 1,
) => {
  const middleAlpha = (clamp01(startAlpha) + clamp01(endAlpha)) / 2;
  gradient.addColorStop(0, colorWithAlpha(start, startAlpha));
  gradient.addColorStop(0.5, colorWithAlpha(middle, middleAlpha));
  gradient.addColorStop(1, colorWithAlpha(end, endAlpha));
};

// canvas へ描画。(x,y) を左上、scale 倍、accent はアクセント色（「((」「))」）。
// accent は string=全弧一律 / string[]=弧ごとの個別色 / mirrored-gradient=左右対称の連続色。
// accentAlpha はアクセントの不透明度。number=全パス一律（導入の点滅用、既定1）。
// number[]=パスごと（波紋アニメ用）。ACCENT の順序は [右内, 右外, 左内, 左外]。
// letterScales は文字ごとの一時スケール。省略時は全て1で通常描画と同一。
export function drawMoodMetrix(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  accent: MoodMetrixAccent,
  letter = "#ffffff",
  accentAlpha: number | number[] = 1,
  letterScales: readonly number[] = [],
) {
  const p = paths();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = letter;
  p.letters.forEach((path, i) => {
    const letterScale = Math.max(0, letterScales[i] ?? 1);
    if (Math.abs(letterScale - 1) < 1e-6) {
      ctx.fill(path);
      return;
    }
    const [cx, cy] = MOOD_METRIX_LETTER_CENTERS[i];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(letterScale, letterScale);
    ctx.translate(-cx, -cy);
    ctx.fill(path);
    ctx.restore();
  });
  const solidAccent = typeof accent === "string" ? accent : "";
  let gradientFills: [CanvasGradient, CanvasGradient] | null = null;
  if (isAccentGradient(accent)) {
    // 両側を1本の距離軸として扱う。左は外→内、右は内→外に反転するため、
    // 弧ごとのベタ塗りではなく、参照画像どおり各弧の内部にもブルーの遷移が現れる。
    const left = ctx.createLinearGradient(64, 0, 103, 0);
    const right = ctx.createLinearGradient(196, 0, 231, 0);
    const innerAlpha = clamp01(accent.innerAlpha ?? 1);
    const outerAlpha = clamp01(accent.outerAlpha ?? 1);
    addGradientStops(left, accent.outer, accent.middle, accent.inner, outerAlpha, innerAlpha);
    addGradientStops(right, accent.inner, accent.middle, accent.outer, innerAlpha, outerAlpha);
    gradientFills = [right, left];
  }
  const accCol = (i: number): string | CanvasGradient => {
    if (gradientFills) return i < 2 ? gradientFills[0] : gradientFills[1];
    return Array.isArray(accent) ? accent[i] ?? accent[0] : solidAccent;
  };
  if (Array.isArray(accentAlpha) || Array.isArray(accent) || gradientFills) {
    // 弧ごとに色/不透明度を割り当て（波紋グラデ連動・導入の点滅波紋）。
    const prev = ctx.globalAlpha;
    p.accent.forEach((path, i) => {
      ctx.fillStyle = accCol(i);
      const a = Array.isArray(accentAlpha) ? accentAlpha[i] ?? 1 : accentAlpha;
      ctx.globalAlpha = prev * Math.max(0, Math.min(1, a));
      ctx.fill(path);
    });
    ctx.globalAlpha = prev;
  } else if (accentAlpha < 1) {
    ctx.fillStyle = solidAccent;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * Math.max(0, accentAlpha);
    for (const path of p.accent) ctx.fill(path);
    ctx.globalAlpha = prev;
  } else {
    ctx.fillStyle = solidAccent;
    for (const path of p.accent) ctx.fill(path);
  }
  // ® は文字と同色（＝インク色）。背景に応じた白/黒を letter で受け取る。
  ctx.fillStyle = letter;
  for (const path of p.mark) ctx.fill(path);
  ctx.restore();
}

// SVG 出力用。<g> でまとめた文字列を返す（イラレ編集可）。
export function moodMetrixSvg(
  x: number,
  y: number,
  scale: number,
  accent: MoodMetrixAccent,
  letter = "#ffffff",
  accentAlpha = 1,
): string {
  const g = (arr: string[], fill: string) =>
    arr.map((d) => `<path d="${d}" fill="${fill}"/>`).join("");
  const alpha = Math.max(0, Math.min(1, accentAlpha));
  const accentOpacity = alpha < 1 ? ` opacity="${Number(alpha.toFixed(4))}"` : "";
  let accentDefs = "";
  let gAccent: string;
  if (isAccentGradient(accent)) {
    const innerAlpha = clamp01(accent.innerAlpha ?? 1);
    const outerAlpha = clamp01(accent.outerAlpha ?? 1);
    const middleAlpha = (innerAlpha + outerAlpha) / 2;
    const stop = (offset: number, color: string, opacity: number) =>
      `<stop offset="${offset}" stop-color="${color}"${opacity < 1 ? ` stop-opacity="${Number(opacity.toFixed(4))}"` : ""}/>`;
    accentDefs =
      `<defs>` +
      `<linearGradient id="mood-accent-left" gradientUnits="userSpaceOnUse" x1="64" y1="0" x2="103" y2="0">` +
      stop(0, accent.outer, outerAlpha) + stop(0.5, accent.middle, middleAlpha) + stop(1, accent.inner, innerAlpha) +
      `</linearGradient>` +
      `<linearGradient id="mood-accent-right" gradientUnits="userSpaceOnUse" x1="196" y1="0" x2="231" y2="0">` +
      stop(0, accent.inner, innerAlpha) + stop(0.5, accent.middle, middleAlpha) + stop(1, accent.outer, outerAlpha) +
      `</linearGradient>` +
      `</defs>`;
    gAccent = ACCENT.map((d, i) =>
      `<path d="${d}" fill="url(#mood-accent-${i < 2 ? "right" : "left"})"${accentOpacity}/>`,
    ).join("");
  } else {
    // accent が配列なら弧ごとに個別 fill（[右内,右外,左内,左外]）、string なら従来どおり一律。
    gAccent = Array.isArray(accent)
      ? ACCENT.map((d, i) => `<path d="${d}" fill="${accent[i] ?? accent[0]}"${accentOpacity}/>`).join("")
      : ACCENT.map((d) => `<path d="${d}" fill="${accent}"${accentOpacity}/>`).join("");
  }
  return (
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">` +
    accentDefs +
    g(LETTERS, letter) +
    gAccent +
    g(MARK, letter) +
    `</g>`
  );
}
