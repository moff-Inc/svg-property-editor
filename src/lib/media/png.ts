// RGBA8 PNG エンコーダ。背景透過MOV（QuickTime PNG）用に、各フレームを
// 「必ずカラータイプ6(RGBA)・8bit」の PNG へ符号化する。
//
// canvas.toBlob("image/png") を使わない理由:
//   1. ブラウザは全画素が不透明なフレームでアルファチャンネルを落とすことがあり、
//      MOV の途中でピクセルフォーマットが揺れる（編集ソフト側で透過が外れる）。
//   2. toBlob は非同期かつ実装依存で、ストレート/乗算済みアルファの扱いが不透明。
//      getImageData は仕様上ストレートアルファなので、そこから直接組み立てる。
// 圧縮は CompressionStream("deflate")（= zlib 形式 / RFC1950）に任せる。

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// PNG チャンク（length + type + data + CRC）を組み立てる
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// 各スキャンラインに Paeth フィルタ(type 4)を適用する。フィルタ選択の総当たりは
// 1フレームあたり数百万バイトの走査を4回繰り返すため採用せず、グラデーション主体の
// 素材で安定して縮む Paeth に固定している。
function filterPaeth(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  const rowBytes = w * 4;
  const out = new Uint8Array((rowBytes + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const row = y * rowBytes;
    const prev = row - rowBytes;
    out[o++] = 4; // Paeth
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= 4 ? rgba[row + x - 4] : 0; // 左
      const b = y > 0 ? rgba[prev + x] : 0; // 上
      const c = y > 0 && x >= 4 ? rgba[prev + x - 4] : 0; // 左上
      const p = a + b - c;
      const pa = p > a ? p - a : a - p;
      const pb = p > b ? p - b : b - p;
      const pc = p > c ? p - c : c - p;
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[o++] = (rgba[row + x] - pred) & 0xff;
    }
  }
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function isPngEncoderSupported(): boolean {
  return typeof CompressionStream !== "undefined";
}

// ストレートアルファの RGBA バイト列 → PNG（カラータイプ6 / 8bit）
export async function encodeRgbaPng(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolour with alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = await deflate(filterPaeth(rgba, width, height));

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
