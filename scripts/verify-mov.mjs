// 背景透過MOV（QuickTime PNG）書き出しの検証ハーネス。
// png.ts / movMuxer.ts を esbuild でバンドルして直接呼ぶ（verify-liquid-glass.mjs と同方式）。
//
//   node scripts/verify-mov.mjs
//
// ffmpeg / ffprobe があれば、書き出した .mov を実際にデコードして
// 「アルファ込みでロスレスに往復するか」まで確認する（無ければ構造検査のみ）。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const sourceDir = new URL('../src/lib/media/', import.meta.url).pathname;
const bundle = await build({
  stdin: {
    contents: `export { encodeRgbaPng } from './png';\nexport { MovPngWriter, buildQuickTimePngMovie } from './movMuxer';`,
    resolveDir: sourceDir,
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { encodeRgbaPng, MovPngWriter, buildQuickTimePngMovie } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const W = 320, H = 240, FPS = 30, N = 30;

// 動く円（内側=不透明 / 縁=半透明 / 外側=完全透明）。透過の3状態を全部含む。
const expectedPixel = (i, x, y) => {
  const cx = W / 2 + Math.cos((i / N) * Math.PI * 2) * 60;
  const cy = H / 2 + Math.sin((i / N) * Math.PI * 2) * 40;
  const d = Math.hypot(x - cx, y - cy);
  const a = d < 50 ? 255 : d < 70 ? Math.round(255 * (1 - (d - 50) / 20)) : 0;
  return [255, Math.round((x / W) * 255), 40, a];
};

const frameRgba = (i) => {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) rgba.set(expectedPixel(i, x, y), (y * W + x) * 4);
  }
  return rgba;
};

// ── PNG: 必ず RGBA8（カラータイプ6 / 8bit）で符号化される ───────────────────
{
  const png = await encodeRgbaPng(frameRgba(0), W, H);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG シグネチャ');
  assert.equal(Buffer.from(png.subarray(12, 16)).toString('latin1'), 'IHDR');
  const ihdr = Buffer.from(png.subarray(16, 29));
  assert.equal(ihdr.readUInt32BE(0), W);
  assert.equal(ihdr.readUInt32BE(4), H);
  assert.equal(ihdr[8], 8, 'bit depth = 8');
  assert.equal(ihdr[9], 6, 'color type = 6 (RGBA)');

  // 全画素不透明でもアルファチャンネルを落とさない（MOV 途中で pix_fmt が揺れない）
  const opaque = new Uint8Array(W * H * 4).fill(255);
  const png2 = await encodeRgbaPng(opaque, W, H);
  assert.equal(Buffer.from(png2.subarray(16, 29))[9], 6, '不透明フレームも color type 6');
}

// ── MOV: 構造 ─────────────────────────────────────────────────────────────
const writer = new MovPngWriter({ width: W, height: H, fps: FPS });
for (let i = 0; i < N; i++) writer.addFrame(await encodeRgbaPng(frameRgba(i), W, H));
assert.equal(writer.frameCount, N);
const blob = writer.finalize();
assert.equal(blob.type, 'video/quicktime');
const mov = Buffer.from(await blob.arrayBuffer());

const atoms = (buf, start, end) => {
  const found = [];
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    let hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(off + 8)); hdr = 16; }
    if (size === 0) size = end - off;
    found.push({ type: buf.toString('latin1', off + 4, off + 8), off, size, hdr });
    if (size <= 0) break;
    off += size;
  }
  return found;
};
const find = (list, type) => list.find((a) => a.type === type);
const children = (buf, a) => atoms(buf, a.off + a.hdr, a.off + a.size);

const top = atoms(mov, 0, mov.length);
assert.deepEqual(top.map((a) => a.type), ['ftyp', 'wide', 'mdat', 'moov'], 'トップレベルの並び');
assert.equal(mov.toString('latin1', 8, 12), 'qt  ', 'major brand = qt');

const moov = find(top, 'moov');
const trak = find(children(mov, moov), 'trak');
const mdia = find(children(mov, trak), 'mdia');
const minf = find(children(mov, mdia), 'minf');
const stbl = find(children(mov, minf), 'stbl');
const stblKids = children(mov, stbl);
assert.deepEqual(stblKids.map((a) => a.type), ['stsd', 'stts', 'stsc', 'stsz', 'stco'], 'stbl の中身');
// 全フレームがキーフレームなので stss は書かない（= 全同期サンプル扱い）
assert.equal(find(stblKids, 'stss'), undefined, 'stss は書かない');

const stsd = find(stblKids, 'stsd');
const entry = stsd.off + 16; // stsd ヘッダ + version/flags + entry_count
assert.equal(mov.toString('latin1', entry + 4, entry + 8), 'png ', "fourcc = 'png '");
assert.equal(mov.readUInt16BE(entry + 32), W, 'stsd width');
assert.equal(mov.readUInt16BE(entry + 34), H, 'stsd height');
// depth は compressorname(32B) の直後。32 = アルファチャンネルあり。
assert.equal(mov.readUInt16BE(entry + 82), 32, 'depth = 32 (アルファあり)');
assert.equal(mov.readUInt16BE(entry + 84), 0xffff, 'color table id = -1');

// mdhd: timescale = fps * 1000、duration = フレーム数 * 1000（= ちょうど N/FPS 秒）
const mdhd = find(children(mov, mdia), 'mdhd');
assert.equal(mov.readUInt32BE(mdhd.off + 20), FPS * 1000, 'mdhd timescale');
assert.equal(mov.readUInt32BE(mdhd.off + 24), N * 1000, 'mdhd duration');

// stsz の各サンプルサイズが実データと一致し、stco が mdat 本体を指す
const stsz = find(stblKids, 'stsz');
assert.equal(mov.readUInt32BE(stsz.off + 16), N, 'stsz sample count');
const mdat = find(top, 'mdat');
const stco = find(stblKids, 'stco');
assert.equal(mov.readUInt32BE(stco.off + 16), mdat.off + mdat.hdr, 'stco = mdat 本体の先頭');
let cursor = mdat.off + mdat.hdr;
for (let i = 0; i < N; i++) {
  const size = mov.readUInt32BE(stsz.off + 20 + i * 4);
  assert.equal(mov.toString('latin1', cursor + 12, cursor + 16), 'IHDR', `サンプル${i}が PNG で始まる`);
  cursor += size;
}
assert.equal(cursor, mdat.off + mdat.size, 'サンプルサイズの合計 = mdat のサイズ');

// 0枚は明示的にエラー（無音で壊れた .mov を作らない）
assert.throws(() => buildQuickTimePngMovie([], { width: W, height: H, fps: FPS }), /フレームが1枚もありません/);

console.log(`構造OK: ${N}フレーム / ${(mov.length / 1024).toFixed(0)}KB`);

// ── デコード: ffmpeg があればアルファ込みロスレス往復を確認 ──────────────────
const has = (bin) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
if (!has('ffprobe') || !has('ffmpeg')) {
  console.log('ffmpeg/ffprobe が無いためデコード検証はスキップしました');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'verify-mov-'));
  try {
    const file = join(dir, 'out.mov');
    writeFileSync(file, mov);
    const probe = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name,codec_tag_string,pix_fmt,width,height,nb_frames,avg_frame_rate',
      '-of', 'default=noprint_wrappers=1', file,
    ]).toString();
    const kv = Object.fromEntries(probe.trim().split('\n').map((l) => l.split('=')));
    assert.equal(kv.codec_name, 'png');
    assert.equal(kv.codec_tag_string.trim(), 'png');
    assert.equal(kv.pix_fmt, 'rgba', 'アルファ付きで認識される');
    assert.equal(Number(kv.width), W);
    assert.equal(Number(kv.height), H);
    assert.equal(Number(kv.nb_frames), N);
    assert.equal(kv.avg_frame_rate, `${FPS}/1`);

    // 全フレームを RGBA 生データへ戻して元と1バイト単位で比較
    const raw = join(dir, 'out.raw');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
    const got = readFileSync(raw);
    assert.equal(got.length, W * H * 4 * N, '復号フレーム数');
    let semi = 0;
    for (let i = 0; i < N; i++) {
      const base = i * W * H * 4;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const o = base + (y * W + x) * 4;
          const e = expectedPixel(i, x, y);
          if (e[3] > 0 && e[3] < 255) semi++;
          for (let k = 0; k < 4; k++) {
            assert.equal(got[o + k], e[k], `frame${i} (${x},${y}) ch${k}`);
          }
        }
      }
    }
    assert.ok(semi > 0, '半透明ピクセルを含むテストであること');
    console.log(`デコードOK: 全${N}フレームがアルファ込みでロスレス一致（半透明画素 平均 ${Math.round(semi / N)}/フレーム）`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
