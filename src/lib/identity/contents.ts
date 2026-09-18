// /generate ピッカー & ディスパッチャ用のメタ情報（サーバ安全）。
// すべて canvas ベースのマルチモードコンテンツ（詳細は registry.ts / 各モジュール）。

export interface GenerateContentMeta {
  slug: string;
  no: string;
  title: string;
  blurb: string;
}

export const GENERATE_CONTENTS: GenerateContentMeta[] = [
  {
    slug: "xyz-line",
    no: "02",
    title: "XYZ LINE",
    blurb: "面取り四角形とXYZライン。4点の色を編集できるメッシュグラデーションにも対応。SVG／MP4／PNG。",
  },
  {
    slug: "hex-liquid",
    no: "05",
    title: "GRAPHIC LOGO",
    blurb: "リキッドグラスとドットフィールドをモード切替。ベクターSVG（各ドット）／MP4／PNG。",
  },
];

export function getContentMeta(slug: string): GenerateContentMeta | undefined {
  return GENERATE_CONTENTS.find((c) => c.slug === slug);
}
