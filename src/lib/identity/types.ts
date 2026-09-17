// canvas 系ジェネレータ（05/07）の共通契約。原典のコントロール tuple
// [key,label,type,...] (buildPanel HTML:2233-2299) を判別可能ユニオンで型付け。

export type Control =
  | readonly [key: string, label: string, t: "r", min: number, max: number, step: number, unit: string]
  | readonly [key: string, label: string, t: "k"]
  | readonly [key: string, label: string, t: "n"]
  | readonly [key: string, label: string, t: "c"]
  | readonly [key: string, label: string, t: "s", options: readonly string[]]
  | readonly [key: string, label: string, t: "o", options: readonly (readonly [string, string])[]];

export type ControlGroup = readonly [
  title: string,
  controls: readonly Control[],
  visibleWhen?: { readonly key: string; readonly equals: number | string },
];
export type ControlsSpec = readonly ControlGroup[];

// number/string に加え、LIQUID GLASS の circles[] など配列値も保持できるようにする
// （配列は ControlsPanel の編集対象外。JSON保存はそのまま可）。
export type ParamValue = number | string | unknown[];
export type Params = Record<string, ParamValue>;

export interface CanvasRenderer {
  // 1フレームを ctx に描画（phase 0..1 の純粋関数）
  render(ctx: CanvasRenderingContext2D, W: number, H: number, phase: number, params: Params): void;
  // 対応レンダラは編集可能なベクターSVGを生成（イラレ編集可）。無ければ埋め込みSVG。
  toSvg?(o: { phase: number; loopSeconds: number; params: Params }): string;
  // 導入（出現）アニメの長さ（秒）。renderIntro を持つレンダラのみ設定。
  introSeconds?: number;
  // パラメータで導入尺を調整するレンダラ向け。未実装時は introSeconds を使う。
  getIntroSeconds?(params: Params): number;
  // 導入アニメの1フレーム。t01=導入進行(0..1), phase=通常ループ位相（連続させて渡す）。
  // t01=1 のフレームは render(phase) とピクセル一致すること（ループへ段差なく接続）。
  renderIntro?(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    t01: number,
    phase: number,
    params: Params,
  ): void;
}

// 1つのモード（= かつての単一 CanvasContent 相当）
export interface CanvasMode {
  value: string; // "xyz" | "hex-halo" | "liquid-glass" ...
  label: string;
  defaults: Params;
  presets: Params[];
  controls: ControlsSpec;
  create(): CanvasRenderer; // レンダラ実体（インスタンスごとにキャッシュを保持）
}

// モード切替を持つコンテンツ（単一モードでも modes.length===1 で表現）
export interface MultiModeContent {
  slug: string;
  no: string;
  title: string;
  bgKey: string;
  modes: CanvasMode[];
}
