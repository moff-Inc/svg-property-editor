// Apple ProRes 4444 (fourcc 'ap4h') エンコーダ。RGBA の canvas フレームを
// アルファ付きのまま ProRes フレームへ符号化する。
//
// なぜ必要か:
//   ブラウザの VideoEncoder(WebCodecs) は H.264 も VP9 もアルファを保持できない。
//   一方 macOS の AVFoundation は QuickTime PNG も Animation(RLE) も既にデコードを
//   落としており（ffmpeg が書いた同形式も QuickTime Player で開けない）、
//   「ブラウザで作れて QuickTime / Final Cut / After Effects / Premiere / DaVinci
//   すべてで開ける、アルファ付き動画」は実質 ProRes 4444 しかない。
//
// ビットストリームは FFmpeg の prores_aw エンコーダ(proresenc_anatoliy.c)と
// 同じ構成にしてある。DCT も同じ ff_jpeg_fdct_islow_10 を移植しているので、
// 量子化・エントロピー符号化の結果が既存デコーダとそのまま噛み合う。
//
// フレーム構造:
//   frame header(148B: 量子化マトリクス含む) → picture header(8B) →
//   スライスサイズ表(be16 × スライス数) → スライス本体
//   スライス = ヘッダ(8B) + Y + Cb + Cr（DCT+量子化+VLC）+ A（差分RLE・非DCT）

const SLICE_MB_WIDTH = 8; // 1スライス = 最大8マクロブロック（= 128px）
const MB_SIZE = 16; // マクロブロックは 16x16 px

// 進行（プログレッシブ）用のジグザグ相当スキャン順
const PROGRESSIVE_SCAN = new Uint8Array([
   0,  1,  8,  9,  2,  3, 10, 11,
  16, 17, 24, 25, 18, 19, 26, 27,
   4,  5, 12, 20, 13,  6,  7, 14,
  21, 28, 29, 22, 15, 23, 30, 31,
  32, 33, 40, 48, 41, 34, 35, 42,
  49, 56, 57, 50, 43, 36, 37, 44,
  51, 58, 59, 52, 45, 38, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
]);

// 4444 プロファイルの量子化マトリクス（輝度・色差で同一）
const QMAT_4444 = new Uint8Array([
  4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 5,
  4, 4, 4, 4, 4, 4, 5, 5,
  4, 4, 4, 4, 4, 5, 5, 6,
  4, 4, 4, 4, 5, 5, 6, 7,
  4, 4, 4, 4, 5, 6, 7, 7,
]);

const FIRST_DC_CB = 0xb8;
const DC_CODEBOOK = new Uint8Array([0x04, 0x28, 0x28, 0x4d, 0x4d, 0x70, 0x70]);
const RUN_TO_CB = new Uint8Array([
  0x06, 0x06, 0x05, 0x05, 0x04, 0x29, 0x29, 0x29,
  0x29, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x4c,
]);
const LEVEL_TO_CB = new Uint8Array([0x04, 0x0a, 0x05, 0x06, 0x04, 0x28, 0x28, 0x28, 0x28, 0x4c]);

// 4444 プロファイルのレート制御パラメータ（スライス単位で qp を上下させる）
const QP_START = 1;
const QP_END = 5;
const BITRATE_UNIT = 7000;

/* ---------------- ビット出力 ---------------- */

class BitWriter {
  private buf: Uint8Array;
  private start = 0;
  private pos = 0;
  private acc = 0;
  private accBits = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  // buf の offset から書き始める（スライスごとに使い回す）
  reset(offset: number): void {
    this.start = offset;
    this.pos = offset;
    this.acc = 0;
    this.accBits = 0;
  }

  // val の下位 n ビットを書く。n は 0..32、val は符号付きでもよい。
  put(n: number, val: number): void {
    let remaining = n;
    while (remaining > 0) {
      const take = Math.min(8 - this.accBits, remaining);
      remaining -= take;
      const bits = (val >>> remaining) & ((1 << take) - 1);
      this.acc = (this.acc << take) | bits;
      this.accBits += take;
      if (this.accBits === 8) {
        this.buf[this.pos++] = this.acc & 0xff;
        this.acc = 0;
        this.accBits = 0;
      }
    }
  }

  // バイト境界まで 0 詰めして、書いたバイト数を返す
  flush(): number {
    if (this.accBits > 0) {
      this.buf[this.pos++] = (this.acc << (8 - this.accBits)) & 0xff;
      this.acc = 0;
      this.accBits = 0;
    }
    return this.pos - this.start;
  }
}

// ProRes の可変長符号。codebook が Rice 符号と指数ゴロム符号の切り替え点を持つ。
function putVlc(w: BitWriter, codebook: number, value: number): void {
  const switchBits = (codebook & 3) + 1;
  const riceOrder = codebook >> 5;
  const expOrder = (codebook >> 2) & 7;
  const switchVal = switchBits << riceOrder;

  if (value >= switchVal) {
    const v = value - switchVal + (1 << expOrder);
    const exponent = 31 - Math.clz32(v);
    w.put(exponent - expOrder + switchBits, 0);
    w.put(exponent + 1, v);
  } else {
    const exponent = value >> riceOrder;
    if (exponent) w.put(exponent, 0);
    w.put(1, 1);
    if (riceOrder) w.put(riceOrder, value);
  }
}

// 符号を最下位ビットへ折り返す（0, -1, 1, -2, 2 … → 0, 1, 2, 3, 4 …）
const makeCode = (x: number) => (x * 2) ^ (x >> 31);

/* ---------------- DCT ---------------- */

// FFmpeg の ff_jpeg_fdct_islow_10 の移植（CONST_BITS=13 / PASS1_BITS=1）。
// 出力は真の DCT の 4 倍スケール。全画素が v のとき DC = 32v になり、
// 10bit の中点 512 がちょうど 0x4000 に対応する（DC 符号化がこれを引く）。
const FIX_0_298631336 = 2446;
const FIX_0_390180644 = 3196;
const FIX_0_541196100 = 4433;
const FIX_0_765366865 = 6270;
const FIX_0_899976223 = 7373;
const FIX_1_175875602 = 9633;
const FIX_1_501321110 = 12299;
const FIX_1_847759065 = 15137;
const FIX_1_961570560 = 16069;
const FIX_2_053119869 = 16819;
const FIX_2_562915447 = 20995;
const FIX_3_072711026 = 25172;

function fdct(d: Int16Array, off: number): void {
  // Pass 1: 行
  for (let i = 0; i < 8; i++) {
    const p = off + i * 8;
    const tmp0 = d[p] + d[p + 7];
    let tmp7 = d[p] - d[p + 7];
    const tmp1 = d[p + 1] + d[p + 6];
    let tmp6 = d[p + 1] - d[p + 6];
    const tmp2 = d[p + 2] + d[p + 5];
    let tmp5 = d[p + 2] - d[p + 5];
    const tmp3 = d[p + 3] + d[p + 4];
    let tmp4 = d[p + 3] - d[p + 4];

    const tmp10 = tmp0 + tmp3;
    const tmp13 = tmp0 - tmp3;
    const tmp11 = tmp1 + tmp2;
    const tmp12 = tmp1 - tmp2;

    d[p] = (tmp10 + tmp11) * 2; // << PASS1_BITS
    d[p + 4] = (tmp10 - tmp11) * 2;

    let z1 = (tmp12 + tmp13) * FIX_0_541196100;
    d[p + 2] = (z1 + tmp13 * FIX_0_765366865 + 2048) >> 12; // CONST_BITS - PASS1_BITS
    d[p + 6] = (z1 + tmp12 * -FIX_1_847759065 + 2048) >> 12;

    z1 = tmp4 + tmp7;
    let z2 = tmp5 + tmp6;
    let z3 = tmp4 + tmp6;
    let z4 = tmp5 + tmp7;
    const z5 = (z3 + z4) * FIX_1_175875602;

    tmp4 = tmp4 * FIX_0_298631336;
    tmp5 = tmp5 * FIX_2_053119869;
    tmp6 = tmp6 * FIX_3_072711026;
    tmp7 = tmp7 * FIX_1_501321110;
    z1 = z1 * -FIX_0_899976223;
    z2 = z2 * -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;

    d[p + 7] = (tmp4 + z1 + z3 + 2048) >> 12;
    d[p + 5] = (tmp5 + z2 + z4 + 2048) >> 12;
    d[p + 3] = (tmp6 + z2 + z3 + 2048) >> 12;
    d[p + 1] = (tmp7 + z1 + z4 + 2048) >> 12;
  }

  // Pass 2: 列（OUT_SHIFT = PASS1_BITS + 1 = 2）
  for (let i = 0; i < 8; i++) {
    const p = off + i;
    const tmp0 = d[p] + d[p + 56];
    let tmp7 = d[p] - d[p + 56];
    const tmp1 = d[p + 8] + d[p + 48];
    let tmp6 = d[p + 8] - d[p + 48];
    const tmp2 = d[p + 16] + d[p + 40];
    let tmp5 = d[p + 16] - d[p + 40];
    const tmp3 = d[p + 24] + d[p + 32];
    let tmp4 = d[p + 24] - d[p + 32];

    const tmp10 = tmp0 + tmp3;
    const tmp13 = tmp0 - tmp3;
    const tmp11 = tmp1 + tmp2;
    const tmp12 = tmp1 - tmp2;

    d[p] = (tmp10 + tmp11 + 2) >> 2;
    d[p + 32] = (tmp10 - tmp11 + 2) >> 2;

    let z1 = (tmp12 + tmp13) * FIX_0_541196100;
    d[p + 16] = (z1 + tmp13 * FIX_0_765366865 + 16384) >> 15; // CONST_BITS + OUT_SHIFT
    d[p + 48] = (z1 + tmp12 * -FIX_1_847759065 + 16384) >> 15;

    z1 = tmp4 + tmp7;
    let z2 = tmp5 + tmp6;
    let z3 = tmp4 + tmp6;
    let z4 = tmp5 + tmp7;
    const z5 = (z3 + z4) * FIX_1_175875602;

    tmp4 = tmp4 * FIX_0_298631336;
    tmp5 = tmp5 * FIX_2_053119869;
    tmp6 = tmp6 * FIX_3_072711026;
    tmp7 = tmp7 * FIX_1_501321110;
    z1 = z1 * -FIX_0_899976223;
    z2 = z2 * -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;

    d[p + 56] = (tmp4 + z1 + z3 + 16384) >> 15;
    d[p + 40] = (tmp5 + z2 + z4 + 16384) >> 15;
    d[p + 24] = (tmp6 + z2 + z3 + 16384) >> 15;
    d[p + 8] = (tmp7 + z1 + z4 + 16384) >> 15;
  }
}

/* ---------------- エンコーダ本体 ---------------- */

export class ProRes4444Encoder {
  readonly width: number;
  readonly height: number;
  private readonly mbWidth: number;
  private readonly mbHeight: number;
  private readonly slicesPerLine: number;
  private readonly sliceCount: number;

  // 10bit の YCbCr 平面と 16bit のアルファ平面
  private readonly planeY: Uint16Array;
  private readonly planeU: Uint16Array;
  private readonly planeV: Uint16Array;
  private readonly planeA: Uint16Array;

  // スライス1本ぶんの作業領域（16行 × 最大128px）
  private readonly fillY: Uint16Array;
  private readonly fillU: Uint16Array;
  private readonly fillV: Uint16Array;
  private readonly fillA: Int16Array;
  private readonly blocksY: Int16Array;
  private readonly blocksU: Int16Array;
  private readonly blocksV: Int16Array;

  // qp 1..16 ぶんのスケール済み量子化マトリクス
  private readonly qmat: Int32Array[];
  private readonly out: Uint8Array;
  private readonly writer: BitWriter;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) {
      throw new Error("ProRes: 幅と高さは16以上の整数である必要があります");
    }
    if (width & 1) throw new Error("ProRes: 幅は偶数である必要があります");
    this.width = width;
    this.height = height;
    this.mbWidth = (width + 15) >> 4;
    this.mbHeight = (height + 15) >> 4;

    // 1行あたりのスライス数: 8,4,2,1 MB の貪欲分割
    let perLine = 0;
    let rem = this.mbWidth;
    for (let i = 3; i >= 0; i--) {
      perLine += rem >> i;
      rem &= (1 << i) - 1;
    }
    this.slicesPerLine = perLine;
    this.sliceCount = perLine * this.mbHeight;

    const px = width * height;
    this.planeY = new Uint16Array(px);
    this.planeU = new Uint16Array(px);
    this.planeV = new Uint16Array(px);
    this.planeA = new Uint16Array(px);

    const fillSize = SLICE_MB_WIDTH * MB_SIZE * MB_SIZE; // 128 × 16
    this.fillY = new Uint16Array(fillSize);
    this.fillU = new Uint16Array(fillSize);
    this.fillV = new Uint16Array(fillSize);
    this.fillA = new Int16Array(fillSize);
    this.blocksY = new Int16Array(fillSize);
    this.blocksU = new Int16Array(fillSize);
    this.blocksV = new Int16Array(fillSize);

    this.qmat = [];
    for (let qp = 1; qp <= 16; qp++) {
      const m = new Int32Array(64);
      for (let i = 0; i < 64; i++) m[i] = QMAT_4444[i] * qp;
      this.qmat.push(m);
    }

    // FFmpeg と同じ上限見積り（実際にはこれよりずっと小さい）
    const aligned = ((width + 15) & ~15) * ((height + 15) & ~15);
    this.out = new Uint8Array(aligned * 16 + 65536);
    this.writer = new BitWriter(this.out);
  }

  // RGBA8（ストレートアルファ）1枚 → ProRes フレーム 1つ
  encodeFrame(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
    if (rgba.length < this.width * this.height * 4) {
      throw new Error("ProRes: 画素データが足りません");
    }
    this.convert(rgba);
    const size = this.writeFrame();
    return this.out.slice(0, size);
  }

  /* --- RGBA → BT.709 リミテッドレンジの 10bit YCbCr + 16bit アルファ --- */
  private convert(rgba: Uint8Array | Uint8ClampedArray): void {
    const { planeY, planeU, planeV, planeA } = this;
    const n = this.width * this.height;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const r = rgba[o];
      const g = rgba[o + 1];
      const b = rgba[o + 2];
      const a = rgba[o + 3];
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0..255
      // 10bit リミテッドレンジ: Y=64..940 / C=64..960（512 が無彩色）
      let yy = Math.round(y * 3.435294 + 64);
      let cb = Math.round((b - y) * 1.893452 + 512);
      let cr = Math.round((r - y) * 2.231318 + 512);
      if (yy < 64) yy = 64; else if (yy > 940) yy = 940;
      if (cb < 64) cb = 64; else if (cb > 960) cb = 960;
      if (cr < 64) cr = 64; else if (cr > 960) cr = 960;
      planeY[i] = yy;
      planeU[i] = cb;
      planeV[i] = cr;
      // アルファは 8bit → 16bit へ full-range で拡張（0→0, 255→65535）。
      // ProRes 4444 のアルファ平面は DCT を通らないので、ここが唯一の量子化点。
      planeA[i] = a * 257;
    }
  }

  /* --- スライスの作業領域へ切り出す。右端・下端は最終画素を複製して埋める --- */
  private subimage(
    src: Uint16Array,
    dst: Uint16Array | Int16Array,
    x: number,
    y: number,
    dstWidth: number,
  ): void {
    const boxW = Math.min(this.width - x, dstWidth);
    const boxH = Math.min(this.height - y, MB_SIZE);
    let s = y * this.width + x;
    let d = 0;
    for (let i = 0; i < boxH; i++) {
      let j = 0;
      for (; j < boxW; j++) dst[d + j] = src[s + j];
      const last = dst[d + boxW - 1];
      for (; j < dstWidth; j++) dst[d + j] = last;
      s += this.width;
      d += dstWidth;
    }
    const lastLine = d - dstWidth;
    for (let i = boxH; i < MB_SIZE; i++) {
      for (let j = 0; j < dstWidth; j++) dst[d + j] = dst[lastLine + j];
      d += dstWidth;
    }
  }

  /* --- 平面の 16x16 マクロブロックを 8x8 ブロック4つに割って DCT --- */
  private planeDct(src: Uint16Array, blocks: Int16Array, stride: number, mbCount: number, chroma: boolean): void {
    // ブロックの並びは輝度と色差(4:4:4)で異なる。FFmpeg の calc_plane_dct と同順。
    // （FFmpeg 側はバイト単位のポインタ演算。ここは uint16 要素単位なので半分の値になる）
    const down = 8 * stride;
    const order = chroma ? [0, down, 8, down + 8] : [0, 8, down, down + 8];
    let block = 0;
    let s = 0;
    for (let mb = 0; mb < mbCount; mb++) {
      for (let k = 0; k < 4; k++) {
        const base = s + order[k];
        for (let row = 0; row < 8; row++) {
          const sp = base + row * stride;
          const bp = block + row * 8;
          for (let col = 0; col < 8; col++) blocks[bp + col] = src[sp + col];
        }
        fdct(blocks, block);
        block += 64;
      }
      s += MB_SIZE; // 次のマクロブロック（16px 右）
    }
  }

  /* --- 1平面ぶんの DC + AC を符号化して、書いたバイト数を返す --- */
  private encodePlane(blocks: Int16Array, blocksPerSlice: number, offset: number, qmat: Int32Array): number {
    const w = this.writer;
    w.reset(offset);

    // DC: 先頭は絶対値、以降は直前との差分（符号の向きを引き継ぐ）
    const scale = qmat[0];
    let codebook = 5;
    let prevDc = Math.trunc((blocks[0] - 0x4000) / scale);
    putVlc(w, FIRST_DC_CB, makeCode(prevDc));
    let sign = 0;
    for (let i = 1; i < blocksPerSlice; i++) {
      const dc = Math.trunc((blocks[i * 64] - 0x4000) / scale);
      let delta = dc - prevDc;
      const newSign = delta >> 31;
      delta = (delta ^ sign) - sign;
      const code = makeCode(delta);
      putVlc(w, DC_CODEBOOK[codebook], code);
      codebook = Math.min(code, 6);
      sign = newSign;
      prevDc = dc;
    }

    // AC: スキャン順に全ブロックを横断し、ゼロの連長(run)と値(level)を符号化
    const maxCoeffs = blocksPerSlice << 6;
    let prevRun = 4;
    let prevLevel = 2;
    let run = 0;
    for (let i = 1; i < 64; i++) {
      const pos = PROGRESSIVE_SCAN[i];
      const q = qmat[pos];
      for (let idx = pos; idx < maxCoeffs; idx += 64) {
        const level = Math.trunc(blocks[idx] / q);
        if (level) {
          const absLevel = level < 0 ? -level : level;
          putVlc(w, RUN_TO_CB[prevRun], run);
          putVlc(w, LEVEL_TO_CB[prevLevel], absLevel - 1);
          w.put(1, level >> 31);
          prevRun = run < 15 ? run : 15;
          prevLevel = absLevel < 9 ? absLevel : 9;
          run = 0;
        } else {
          run++;
        }
      }
    }
    return w.flush();
  }

  /* --- アルファ平面。DCT は使わず 16bit 差分＋連長でロスレスに符号化 --- */
  private encodeAlpha(mbCount: number, offset: number): number {
    const w = this.writer;
    w.reset(offset);
    const a = this.fillA;
    const numCoeffs = mbCount * 256;

    let prev = 0xffff;
    let cur = a[0];
    this.putAlphaDiff(cur, prev);
    prev = cur;
    let run = 0;
    for (let idx = 1; idx < numCoeffs; idx++) {
      cur = a[idx];
      if (cur !== prev) {
        this.putAlphaRun(run);
        this.putAlphaDiff(cur, prev);
        prev = cur;
        run = 0;
      } else {
        run++;
      }
    }
    this.putAlphaRun(run);
    return w.flush();
  }

  private putAlphaDiff(cur: number, prev: number): void {
    const w = this.writer;
    let diff = (cur - prev) & 0xffff;
    if (diff >= 0x10000 - 64) diff -= 0x10000;
    if (diff < -64 || diff > 64 || !diff) {
      w.put(1, 1);
      w.put(16, diff);
    } else {
      w.put(1, 0);
      w.put(6, (diff < 0 ? -diff : diff) - 1);
      w.put(1, diff < 0 ? 1 : 0);
    }
  }

  private putAlphaRun(run: number): void {
    const w = this.writer;
    if (run) {
      w.put(1, 0);
      if (run < 0x10) w.put(4, run);
      else w.put(15, run);
    } else {
      w.put(1, 1);
    }
  }

  /* --- スライス1本。戻り値はスライス全体のバイト数 --- */
  private encodeSlice(mbX: number, mbY: number, mbCount: number, offset: number, qp: number): { size: number; qp: number } {
    const hdrSize = 8; // アルファありは v サイズも書くので 8 バイト
    const dstWidth = mbCount * MB_SIZE;
    const x = mbX * MB_SIZE;
    const y = mbY * MB_SIZE;

    // 端のスライスも同じ経路で扱えるよう、常に作業領域へ切り出す
    this.subimage(this.planeY, this.fillY, x, y, dstWidth);
    this.subimage(this.planeU, this.fillU, x, y, dstWidth);
    this.subimage(this.planeV, this.fillV, x, y, dstWidth);
    this.subimage(this.planeA, this.fillA, x, y, dstWidth);

    this.planeDct(this.fillY, this.blocksY, dstWidth, mbCount, false);
    this.planeDct(this.fillU, this.blocksU, dstWidth, mbCount, true);
    this.planeDct(this.fillV, this.blocksV, dstWidth, mbCount, true);

    const blocksPerSlice = mbCount * 4;
    const dataStart = offset + hdrSize;

    let ySize = 0;
    let uSize = 0;
    let vSize = 0;
    const encodeAt = (q: number) => {
      const m = this.qmat[q - 1];
      ySize = this.encodePlane(this.blocksY, blocksPerSlice, dataStart, m);
      uSize = this.encodePlane(this.blocksU, blocksPerSlice, dataStart + ySize, m);
      vSize = this.encodePlane(this.blocksV, blocksPerSlice, dataStart + ySize + uSize, m);
      return ySize + uSize + vSize;
    };

    // レート制御: スライスが目標サイズに収まるまで qp を上下させる
    const tgtBits = (mbCount * BITRATE_UNIT) >> 2;
    const lowBytes = (tgtBits - (tgtBits >> 3)) >> 3;
    const highBytes = (tgtBits + (tgtBits >> 3)) >> 3;
    let sliceSize = encodeAt(qp);
    while (sliceSize > highBytes && qp < QP_END) sliceSize = encodeAt(++qp);
    while (sliceSize < lowBytes && qp > QP_START) sliceSize = encodeAt(--qp);

    const aSize = this.encodeAlpha(mbCount, dataStart + sliceSize);

    const out = this.out;
    out[offset] = hdrSize << 3;
    out[offset + 1] = qp;
    out[offset + 2] = (ySize >> 8) & 0xff;
    out[offset + 3] = ySize & 0xff;
    out[offset + 4] = (uSize >> 8) & 0xff;
    out[offset + 5] = uSize & 0xff;
    out[offset + 6] = (vSize >> 8) & 0xff;
    out[offset + 7] = vSize & 0xff;

    return { size: hdrSize + sliceSize + aSize, qp };
  }

  /* --- ピクチャ（= 1フレームの映像本体） --- */
  private writePicture(offset: number): number {
    const out = this.out;
    const hdrSize = 8;
    const tableOffset = offset + hdrSize;
    let dataOffset = tableOffset + this.sliceCount * 2;

    let qp = QP_START;
    let sliceIndex = 0;
    for (let mbY = 0; mbY < this.mbHeight; mbY++) {
      let mbX = 0;
      while (mbX < this.mbWidth) {
        let mbCount = SLICE_MB_WIDTH;
        while (this.mbWidth - mbX < mbCount) mbCount >>= 1;
        const r = this.encodeSlice(mbX, mbY, mbCount, dataOffset, qp);
        qp = r.qp;
        const t = tableOffset + sliceIndex * 2;
        out[t] = (r.size >> 8) & 0xff;
        out[t + 1] = r.size & 0xff;
        sliceIndex++;
        dataOffset += r.size;
        mbX += mbCount;
      }
    }

    const pictureSize = dataOffset - offset;
    out[offset] = hdrSize << 3;
    out[offset + 1] = (pictureSize >>> 24) & 0xff;
    out[offset + 2] = (pictureSize >>> 16) & 0xff;
    out[offset + 3] = (pictureSize >>> 8) & 0xff;
    out[offset + 4] = pictureSize & 0xff;
    out[offset + 5] = (this.sliceCount >> 8) & 0xff;
    out[offset + 6] = this.sliceCount & 0xff;
    out[offset + 7] = 3 << 4; // log2(SLICE_MB_WIDTH) << 4
    return pictureSize;
  }

  /* --- フレームヘッダ（148バイト・量子化マトリクス込み）とフレーム全体 --- */
  private writeFrame(): number {
    const out = this.out;
    const headerSize = 148;
    let p = 0;
    const u8 = (v: number) => {
      out[p++] = v & 0xff;
    };
    const u16 = (v: number) => {
      out[p++] = (v >> 8) & 0xff;
      out[p++] = v & 0xff;
    };
    const u32 = (v: number) => {
      out[p++] = (v >>> 24) & 0xff;
      out[p++] = (v >>> 16) & 0xff;
      out[p++] = (v >>> 8) & 0xff;
      out[p++] = v & 0xff;
    };
    const str4 = (s: string) => {
      for (let i = 0; i < 4; i++) out[p++] = s.charCodeAt(i) & 0xff;
    };

    u32(0); // フレームサイズ。ピクチャを書いた後に埋める
    str4("icpf");
    u16(headerSize);
    u16(1); // version: アルファありは 1
    str4("svge"); // vendor
    u16(this.width);
    u16(this.height);
    u8(0x80 | 0x40); // プログレッシブ + 4:4:4 クロマ
    u8(0); // reserved
    u8(1); // color primaries: BT.709
    u8(1); // transfer characteristics: BT.709
    u8(1); // matrix coefficients: BT.709
    u8(0x02); // 16bit アルファあり
    u8(0); // reserved
    u8(3); // 輝度・色差の量子化マトリクスを両方書く
    out.set(QMAT_4444, p);
    p += 64;
    out.set(QMAT_4444, p);
    p += 64;

    const pictureSize = this.writePicture(p);
    const frameSize = 8 + headerSize + pictureSize;
    out[0] = (frameSize >>> 24) & 0xff;
    out[1] = (frameSize >>> 16) & 0xff;
    out[2] = (frameSize >>> 8) & 0xff;
    out[3] = frameSize & 0xff;
    return frameSize;
  }
}
