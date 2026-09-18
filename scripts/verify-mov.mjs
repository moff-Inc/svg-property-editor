// 背景透過MOV（Apple ProRes 4444）書き出しの検証ハーネス。
// prores.ts / movMuxer.ts を esbuild でバンドルして直接呼ぶ（verify-liquid-glass.mjs と同方式）。
//
//   node scripts/verify-mov.mjs
//
// ffmpeg があれば、書き出した .mov を実際にデコードして
//   - アルファがロスレスに往復するか（ProRes 4444 のアルファ平面は非DCT）
//   - 色の誤差が許容内か（YCbCr 10bit + DCT 量子化を通るのでロスレスではない）
// まで確認する。macOS では AVFoundation（= QuickTime Player / Final Cut の実体）が
// 実際に再生できるかも確認する。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const sourceDir = new URL('../src/lib/media/', import.meta.url).pathname;
const bundle = await build({
  stdin: {
    contents: `export { ProRes4444Encoder } from './prores';\nexport { MovWriter, MOV_CODEC_PRORES_4444, buildQuickTimeMovie } from './movMuxer';`,
    resolveDir: sourceDir,
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { ProRes4444Encoder, MovWriter, MOV_CODEC_PRORES_4444, buildQuickTimeMovie } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const W = 320, H = 240, FPS = 30, N = 8;

// 透過の3状態（不透明 / 半透明 / 完全透明）と、動く円・グラデーションを全部含む絵。
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

// ── エンコード ────────────────────────────────────────────────────────────
const encoder = new ProRes4444Encoder(W, H);
const writer = new MovWriter({ width: W, height: H, fps: FPS, codec: MOV_CODEC_PRORES_4444 });
for (let i = 0; i < N; i++) writer.addFrame(encoder.encodeFrame(frameRgba(i)));
assert.equal(writer.frameCount, N);
const blob = writer.finalize();
assert.equal(blob.type, 'video/quicktime');
const mov = Buffer.from(await blob.arrayBuffer());

// ── MOV: 構造 ─────────────────────────────────────────────────────────────
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
assert.equal(mov.toString('latin1', entry + 4, entry + 8), 'ap4h', "fourcc = 'ap4h' (ProRes 4444)");
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
  // ProRes フレームは 先頭4Bがフレームサイズ、続く4Bが 'icpf'
  assert.equal(mov.readUInt32BE(cursor), size, `サンプル${i}のフレームサイズがstszと一致`);
  assert.equal(mov.toString('latin1', cursor + 4, cursor + 8), 'icpf', `サンプル${i}が icpf で始まる`);
  cursor += size;
}
assert.equal(cursor, mdat.off + mdat.size, 'サンプルサイズの合計 = mdat のサイズ');

// 0枚は明示的にエラー（無音で壊れた .mov を作らない）
assert.throws(
  () => buildQuickTimeMovie([], { width: W, height: H, fps: FPS, codec: MOV_CODEC_PRORES_4444 }),
  /フレームが1枚もありません/,
);

console.log(`構造OK: ${N}フレーム / ${(mov.length / 1024).toFixed(0)}KB (${(mov.length / N / 1024).toFixed(0)}KB/frame)`);

// ── デコード ──────────────────────────────────────────────────────────────
const has = (bin) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const dir = mkdtempSync(join(tmpdir(), 'verify-mov-'));
const file = join(dir, 'out.mov');
writeFileSync(file, mov);
try {
  if (!has('ffprobe') || !has('ffmpeg')) {
    console.log('ffmpeg/ffprobe が無いためデコード検証はスキップしました');
  } else {
    const probe = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name,codec_tag_string,pix_fmt,width,height,nb_frames,avg_frame_rate',
      '-of', 'default=noprint_wrappers=1', file,
    ]).toString();
    const kv = Object.fromEntries(probe.trim().split('\n').map((l) => l.split('=')));
    assert.equal(kv.codec_name, 'prores');
    assert.equal(kv.codec_tag_string.trim(), 'ap4h');
    assert.ok(/^yuva444p1[02]le$/.test(kv.pix_fmt), `アルファ付き 4:4:4 として認識される: ${kv.pix_fmt}`);
    assert.equal(Number(kv.width), W);
    assert.equal(Number(kv.height), H);
    assert.equal(Number(kv.nb_frames), N);
    assert.equal(kv.avg_frame_rate, `${FPS}/1`);

    // 全フレームを RGBA 生データへ戻して元と比較
    const raw = join(dir, 'out.raw');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
    const got = readFileSync(raw);
    assert.equal(got.length, W * H * 4 * N, '復号フレーム数');

    let semi = 0, maxColorErr = 0, sumColorErr = 0, samples = 0, maxAlphaErr = 0;
    for (let i = 0; i < N; i++) {
      const base = i * W * H * 4;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const o = base + (y * W + x) * 4;
          const e = expectedPixel(i, x, y);
          if (e[3] > 0 && e[3] < 255) semi++;
          // アルファ平面は DCT を通らないので、完全透明・完全不透明は必ず保たれる。
          // 中間値は ffmpeg の復号が 16bit→12bit→8bit と丸めるため ±1 ずれうる
          // （ffmpeg 自身の prores_ks 出力でも同じ挙動）。
          const aErr = Math.abs(got[o + 3] - e[3]);
          if (e[3] === 0 || e[3] === 255) {
            assert.equal(got[o + 3], e[3], `frame${i} (${x},${y}) alpha 端点`);
          } else {
            assert.ok(aErr <= 1, `frame${i} (${x},${y}) alpha 誤差 ${aErr}`);
          }
          if (aErr > maxAlphaErr) maxAlphaErr = aErr;
          // 色は YCbCr 10bit + DCT を通るので誤差を許容。完全透明部は色を問わない。
          if (e[3] === 0) continue;
          for (let k = 0; k < 3; k++) {
            const err = Math.abs(got[o + k] - e[k]);
            if (err > maxColorErr) maxColorErr = err;
            sumColorErr += err;
            samples++;
          }
        }
      }
    }
    assert.ok(semi > 0, '半透明ピクセルを含むテストであること');
    const avgErr = sumColorErr / samples;
    assert.ok(maxColorErr <= 4, `色の最大誤差が大きすぎる: ${maxColorErr}`);
    assert.ok(avgErr <= 1.5, `色の平均誤差が大きすぎる: ${avgErr}`);
    console.log(
      `デコードOK: 全${N}フレーム（半透明画素 平均 ${Math.round(semi / N)}/フレーム）` +
      ` アルファ誤差 最大${maxAlphaErr} / 色の誤差 最大${maxColorErr} 平均${avgErr.toFixed(2)} (8bit階調)`,
    );
  }

  // ── 端数サイズ: 16の倍数でない幅・高さ（端のマクロブロックを複製で埋める経路） ──
  if (has('ffmpeg')) {
    const w2 = 250, h2 = 150; // どちらも16の倍数でない
    const enc2 = new ProRes4444Encoder(w2, h2);
    const wr2 = new MovWriter({ width: w2, height: h2, fps: 30, codec: MOV_CODEC_PRORES_4444 });
    const src = new Uint8Array(w2 * h2 * 4);
    const px2 = (x, y) => [x & 0xff, y & 0xff, 200, x < w2 / 2 ? 255 : 0];
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) src.set(px2(x, y), (y * w2 + x) * 4);
    wr2.addFrame(enc2.encodeFrame(src));
    const f2 = join(dir, 'odd.mov');
    writeFileSync(f2, Buffer.from(await wr2.finalize().arrayBuffer()));
    const raw2 = join(dir, 'odd.raw');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f2, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw2]);
    const got2 = readFileSync(raw2);
    assert.equal(got2.length, w2 * h2 * 4, '端数サイズでもフレームサイズが合う');
    let maxErr2 = 0;
    for (let y = 0; y < h2; y++) {
      for (let x = 0; x < w2; x++) {
        const o = (y * w2 + x) * 4;
        const e = px2(x, y);
        assert.equal(got2[o + 3], e[3], `端数 (${x},${y}) alpha`);
        if (e[3] === 0) continue;
        for (let k = 0; k < 3; k++) maxErr2 = Math.max(maxErr2, Math.abs(got2[o + k] - e[k]));
      }
    }
    assert.ok(maxErr2 <= 4, `端数サイズの色誤差が大きすぎる: ${maxErr2}`);
    console.log(`端数サイズOK: ${w2}x${h2} でもアルファ完全一致 / 色の誤差 最大${maxErr2}`);
  }

  // ── macOS: AVFoundation（QuickTime Player / Final Cut の実体）で開けるか ──
  if (process.platform === 'darwin') {
    const swift = join(dir, 'probe.swift');
    writeFileSync(swift, `
import AVFoundation
import Foundation
let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let sem = DispatchSemaphore(value: 0)
var ok = false, detail = ""
Task {
    do {
        let playable = try await asset.load(.isPlayable)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let gen = AVAssetImageGenerator(asset: asset)
        _ = try await gen.image(at: .zero)
        ok = playable && tracks.count == 1
        detail = "playable=\\(playable) tracks=\\(tracks.count) decode=OK"
    } catch { detail = "ERROR \\((error as NSError).code): \\((error as NSError).localizedDescription)" }
    print(detail)
    sem.signal()
}
sem.wait()
exit(ok ? 0 : 1)
`);
    try {
      execFileSync('swiftc', ['-O', swift, '-o', join(dir, 'probe')], { stdio: 'ignore' });
      const out = execFileSync(join(dir, 'probe'), [file]).toString().trim();
      console.log(`AVFoundation OK: ${out}`);
    } catch (e) {
      if (e.code === 'ENOENT') console.log('swiftc が無いため AVFoundation 検証はスキップしました');
      else throw new Error(`AVFoundation が再生できません: ${e.stdout?.toString().trim() ?? e.message}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
