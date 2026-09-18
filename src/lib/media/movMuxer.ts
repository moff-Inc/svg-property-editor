// QuickTime(.mov) マクサ。アルファ付き映像を編集ソフトへ渡すためのコンテナを組む。
//
// なぜ自前で書くのか:
//   ブラウザの VideoEncoder(WebCodecs) は H.264/VP9 いずれもアルファを保持できず、
//   mp4-muxer も ISO BMFF/映像コーデック前提。背景透過の動画を
//   (After Effects / Premiere / Final Cut / DaVinci / QuickTime) へ渡すには、
//   アルファを運べるコンテナを自前で組む必要がある。
//
// 構造（ffmpeg の `-f mov` 出力に合わせてある）:
//   ftyp('qt  ') / wide / mdat(サンプルを連結) / moov > trak > mdia > minf > stbl
// 全サンプルがキーフレームなので stss は書かない（= 全同期サンプル扱い）。
// コーデックは fourcc と compressorname だけの差なので MovCodec で差し替える。

import { ProRes4444Encoder } from "./prores";

const MOVIE_TIMESCALE = 1000;
const FRAME_UNITS = 1000; // 1フレーム当たりのメディア時間単位（timescale = fps * これ）
const U32_MAX = 0xffffffff;

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u16(n: number): Uint8Array {
  const a = new Uint8Array(2);
  new DataView(a.buffer).setUint16(0, n);
  return a;
}

function u32(n: number): Uint8Array {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, n >>> 0);
  return a;
}

function u64(n: number): Uint8Array {
  const a = new Uint8Array(8);
  new DataView(a.buffer).setBigUint64(0, BigInt(n));
  return a;
}

// 16.16 固定小数
const fixed16 = (n: number) => u32(Math.round(n * 65536));

const zeros = (n: number) => new Uint8Array(n);

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([u32(8 + body.length), ascii(type), body]);
}

function fullBox(type: string, version: number, flags: number, ...payload: Uint8Array[]): Uint8Array {
  return box(type, new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...payload);
}

// 単位行列（QuickTime の表示変換）
const IDENTITY_MATRIX = concat([
  u32(0x00010000), u32(0), u32(0),
  u32(0), u32(0x00010000), u32(0),
  u32(0), u32(0), u32(0x40000000),
]);

// 32バイト固定長の Pascal 文字列（compressorname）
function compressorName(name: string): Uint8Array {
  const out = new Uint8Array(32);
  const s = name.slice(0, 31);
  out[0] = s.length;
  for (let i = 0; i < s.length; i++) out[1 + i] = s.charCodeAt(i) & 0xff;
  return out;
}

// QuickTime 形式の hdlr（component type + subtype + Pascal 名）
function qtHdlr(componentType: string, subtype: string, name: string): Uint8Array {
  return fullBox(
    "hdlr",
    0,
    0,
    ascii(componentType),
    ascii(subtype),
    zeros(12), // manufacturer / flags / flags mask
    new Uint8Array([name.length]),
    ascii(name),
  );
}

// 映像の VisualSampleEntry。depth=32 が「アルファあり」の signal。
function visualSampleEntry(codec: MovCodec, width: number, height: number): Uint8Array {
  return box(
    codec.fourcc,
    zeros(6), // reserved
    u16(1), // data_reference_index
    u16(0), // version
    u16(0), // revision level
    zeros(4), // vendor
    u32(0x200), // temporal quality
    u32(0x200), // spatial quality
    u16(width),
    u16(height),
    u32(0x00480000), // horizontal resolution 72dpi
    u32(0x00480000), // vertical resolution 72dpi
    u32(0), // data size
    u16(1), // frame count
    compressorName(codec.name),
    u16(32), // depth: 32 = RGBA（アルファチャンネルあり）
    u16(0xffff), // color table id: -1 = なし
    box("pasp", u32(1), u32(1)), // 正方ピクセル
  );
}

// 格納するコーデック。fourcc は4文字、name は stsd の compressorname に入る表示名。
export interface MovCodec {
  fourcc: string;
  name: string;
}

// Apple ProRes 4444。QuickTime / Final Cut / After Effects / Premiere / DaVinci が
// アルファ付きでデコードできる。QuickTime PNG と Animation(RLE) は macOS の
// AVFoundation が既にデコードを落としているため使わない。
export const MOV_CODEC_PRORES_4444: MovCodec = { fourcc: "ap4h", name: "Apple ProRes 4444" };

export interface MovMovieOptions {
  width: number;
  height: number;
  fps: number;
  codec: MovCodec;
}

// 符号化済みフレーム列 → .mov の Blob。frames は 1フレーム=1サンプル。
export function buildQuickTimeMovie(
  frames: readonly Blob[],
  { width, height, fps, codec }: MovMovieOptions,
): Blob {
  if (frames.length === 0) throw new Error("フレームが1枚もありません");

  const mediaTimescale = Math.round(fps * FRAME_UNITS);
  const mediaDuration = frames.length * FRAME_UNITS;
  const movieDuration = Math.round((frames.length / fps) * MOVIE_TIMESCALE);

  let mdatBytes = 0;
  for (const f of frames) mdatBytes += f.size;

  // mdat が 4GB を超える場合のみ 64bit サイズ（size=1 + largesize）で書く
  const large = mdatBytes + 8 > U32_MAX;
  const mdatHeader = large
    ? concat([u32(1), ascii("mdat"), u64(mdatBytes + 16)])
    : concat([u32(mdatBytes + 8), ascii("mdat")]);

  const ftyp = box("ftyp", ascii("qt  "), u32(0x200), ascii("qt  "));
  const wide = box("wide");
  // 先頭サンプルの絶対オフセット = ftyp + wide + mdat ヘッダ
  const firstSampleOffset = ftyp.length + wide.length + mdatHeader.length;

  const sizes: Uint8Array[] = frames.map((f) => u32(f.size));
  const stbl = box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), visualSampleEntry(codec, width, height)),
    fullBox("stts", 0, 0, u32(1), u32(frames.length), u32(FRAME_UNITS)),
    // 全サンプルを1チャンクに収める（mdat は連続領域なので分割の必要がない）
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(frames.length), u32(1)),
    fullBox("stsz", 0, 0, u32(0), u32(frames.length), ...sizes),
    firstSampleOffset > U32_MAX
      ? fullBox("co64", 0, 0, u32(1), u64(firstSampleOffset))
      : fullBox("stco", 0, 0, u32(1), u32(firstSampleOffset)),
  );

  const minf = box(
    "minf",
    fullBox("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0)), // graphics mode / opcolor
    qtHdlr("dhlr", "url ", "DataHandler"),
    box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
    stbl,
  );

  const mdia = box(
    "mdia",
    fullBox("mdhd", 0, 0, u32(0), u32(0), u32(mediaTimescale), u32(mediaDuration), u16(0x55c4), u16(0)),
    qtHdlr("mhlr", "vide", "VideoHandler"),
    minf,
  );

  const trak = box(
    "trak",
    // flags 3 = track enabled | in movie
    fullBox(
      "tkhd",
      0,
      3,
      u32(0), // creation time
      u32(0), // modification time
      u32(1), // track id
      u32(0), // reserved
      u32(movieDuration),
      zeros(8), // reserved
      u16(0), // layer
      u16(0), // alternate group
      u16(0), // volume（映像は0）
      u16(0), // reserved
      IDENTITY_MATRIX,
      fixed16(width),
      fixed16(height),
    ),
    mdia,
  );

  const moov = box(
    "moov",
    fullBox(
      "mvhd",
      0,
      0,
      u32(0), // creation time
      u32(0), // modification time
      u32(MOVIE_TIMESCALE),
      u32(movieDuration),
      u32(0x00010000), // rate 1.0
      u16(0x0100), // volume 1.0
      u16(0), // reserved
      zeros(8), // reserved
      IDENTITY_MATRIX,
      zeros(24), // pre_defined
      u32(2), // next track id
    ),
    trak,
  );

  return new Blob([ftyp as BlobPart, wide as BlobPart, mdatHeader as BlobPart, ...frames, moov as BlobPart], {
    type: "video/quicktime",
  });
}

// フレームを逐次受け取って .mov にまとめる。受け取った時点で Blob 化するので、
// 長尺でも実データはブラウザ側（必要ならディスク）に置かれ JS ヒープを圧迫しない。
export class MovWriter {
  private readonly frames: Blob[] = [];
  private readonly options: MovMovieOptions;
  private bytes = 0;

  constructor(options: MovMovieOptions) {
    this.options = options;
  }

  addFrame(sample: Uint8Array | Blob): void {
    const blob = sample instanceof Blob ? sample : new Blob([sample as BlobPart]);
    this.frames.push(blob);
    this.bytes += blob.size;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  // ここまでに積んだサンプルの合計バイト数（進捗表示の目安に使う）
  get byteLength(): number {
    return this.bytes;
  }

  finalize(): Blob {
    return buildQuickTimeMovie(this.frames, this.options);
  }
}

// canvas の現在の内容を1フレームとして追加する。getImageData はストレートアルファを
// 返すので、透過（clearRect のまま残した領域）がそのまま MOV のアルファになる。
export function addCanvasFrameToMov(
  writer: MovWriter,
  encoder: ProRes4444Encoder,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const { data } = ctx.getImageData(0, 0, width, height);
  writer.addFrame(encoder.encodeFrame(data));
}
