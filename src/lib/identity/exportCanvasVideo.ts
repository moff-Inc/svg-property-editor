import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { pickCodec, encodeDimensions } from "@/lib/media/h264";
import { MovWriter, MOV_CODEC_PRORES_4444, addCanvasFrameToMov } from "@/lib/media/movMuxer";
import { ProRes4444Encoder } from "@/lib/media/prores";

// canvas コンテンツ(05/07)の書き出し。WebCodecs+mp4-muxer で決定論的に H.264/MP4 化
// （phase を固定ステップで進め frameCount 枚を正確にエンコード）。WebCodecs 非対応時は
// MediaRecorder にフォールバック（実時間キャプチャ・WebMになる場合あり）。
//
// 背景透過が必要なときは "mov"（Apple ProRes 4444）を選ぶ。H.264 も VP9(WebCodecs) も
// アルファを保持できないため、MP4 では透過を出力できない。

export type FramePainter = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  phase: number,
) => void;
// 導入（出現）用ペインタ。t01=導入進行(0..1), phase=通常ループ位相（連続）。
export type IntroPainter = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t01: number,
  phase: number,
) => void;
// done/total はフレーム数。bytes は MOV のようにサイズが読めない形式で、
// 途中経過のファイルサイズを UI に出すために渡す。
export type Progress = (done: number, total: number, bytes?: number) => void;

export type VideoFormat = "mp4" | "mov";

function downloadBlob(blob: Blob, name: string, ext: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(`.${ext}`) ? name : `${name}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportCanvasVideo(opts: {
  paint: FramePainter;
  width: number;
  height: number;
  fps: number;
  loopSeconds: number;
  bitrateMbps: number;
  name: string;
  onProgress?: Progress;
  // 動画の先頭に一度だけ再生する導入（出現）アニメ。省略時は従来どおりループのみ。
  introSeconds?: number;
  paintIntro?: IntroPainter;
  // "mov" は背景透過（Apple ProRes 4444）。既定は従来どおり "mp4"。
  format?: VideoFormat;
}): Promise<void> {
  const { paint, width, height, fps, loopSeconds, bitrateMbps, name, onProgress } = opts;
  const format = opts.format ?? "mp4";
  const introSeconds = opts.paintIntro && opts.introSeconds ? opts.introSeconds : 0;
  const paintIntro = opts.paintIntro;
  // MP4 は H.264 の制約（Level 4.0 / 偶数寸法）に合わせて丸める。ProRes は解像度の
  // 上限がないので指定サイズのまま（幅だけは偶数である必要がある）。
  const { sw, sh } =
    format === "mov"
      ? { sw: Math.max(16, Math.round(width / 2) * 2), sh: Math.max(16, Math.round(height)) }
      : encodeDimensions(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  // MOV は毎フレーム getImageData で読み戻すので willReadFrequently を立てる
  const ctx = canvas.getContext("2d", format === "mov" ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error("Canvas 2D コンテキストを取得できませんでした");

  const introFrames = Math.round(introSeconds * fps);
  // 導入フレーム＋ループ1周（loopSeconds ぶんで phase が 0..1 を一周＝末尾はシームレス）
  const loopFrames = Math.max(1, Math.round(loopSeconds * fps));
  const frameCount = introFrames + loopFrames;
  const frameDurUs = Math.round(1_000_000 / fps);
  // フレーム i を描画。phase は全フレームで単一の通し時計を使う（導入→ループの
  // 継ぎ目でも phase が連続＝回転が飛ばない）。ループ区間(loopFrames本)は phase を
  // ちょうど1.0周ぶん進めるので区間単体でもシームレス。導入無効時は従来と同一列。
  const paintFrame = (fi: number) => {
    const tSec = fi / fps;
    const phase = (tSec / loopSeconds) % 1;
    if (introFrames > 0 && fi < introFrames && paintIntro) {
      paintIntro(ctx, sw, sh, tSec / introSeconds, phase);
    } else {
      paint(ctx, sw, sh, phase);
    }
  };
  const bitrate = Math.min(40_000_000, Math.max(1_000_000, Math.round(bitrateMbps * 1_000_000)));

  // --- MOV: 背景透過（Apple ProRes 4444 / 全フレームがキーフレーム） ---
  if (format === "mov") {
    const encoder = new ProRes4444Encoder(sw, sh);
    const writer = new MovWriter({ width: sw, height: sh, fps, codec: MOV_CODEC_PRORES_4444 });
    for (let i = 0; i < frameCount; i++) {
      // 透過を残すため、毎フレーム完全にクリアしてから描く（レンダラ側が
      // 背景を塗らない設定＝transparent のときだけ透過が残る）。
      ctx.clearRect(0, 0, sw, sh);
      paintFrame(i);
      addCanvasFrameToMov(writer, encoder, ctx, sw, sh);
      onProgress?.(i + 1, frameCount, writer.byteLength);
      await new Promise((r) => setTimeout(r, 0)); // UIを止めない
    }
    downloadBlob(writer.finalize(), name, "mov");
    return;
  }

  // --- WebCodecs（決定論的・推奨） ---
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    const codec = await pickCodec(sw, sh, fps);
    if (!codec) throw new Error("対応する H.264 エンコーダが見つかりませんでした");

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: sw, height: sh, frameRate: fps },
      fastStart: "in-memory",
    });
    let encodeError: unknown = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        encodeError = e;
      },
    });
    const config = {
      codec,
      width: sw,
      height: sh,
      framerate: fps,
      bitrate,
      avc: { format: "avc" },
    } as VideoEncoderConfig;
    encoder.configure(config);

    for (let i = 0; i < frameCount; i++) {
      paintFrame(i);
      const frame = new VideoFrame(canvas, {
        timestamp: i * frameDurUs,
        duration: frameDurUs,
      });
      encoder.encode(frame, { keyFrame: i % fps === 0 });
      frame.close();
      if (encodeError) throw encodeError;
      onProgress?.(i + 1, frameCount);
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    await encoder.flush();
    encoder.close();
    if (encodeError) throw encodeError;
    muxer.finalize();
    downloadBlob(new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: "video/mp4" }), name, "mp4");
    return;
  }

  // --- フォールバック: MediaRecorder（実時間・MP4不可時はWebM） ---
  const mimes = [
    "video/mp4;codecs=avc1.640028",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  const canRecord =
    typeof MediaRecorder !== "undefined" &&
    typeof canvas.captureStream === "function";
  const mime = canRecord ? mimes.find((m) => MediaRecorder.isTypeSupported(m)) : undefined;
  if (!mime) {
    throw new Error(
      "この環境は動画書き出しに未対応です（WebCodecs / MediaRecorder いずれも利用不可）。PNG書き出しをお使いください。",
    );
  }
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((res) => {
    rec.onstop = () => res();
  });
  rec.start();
  const start = performance.now();
  const totalSeconds = introSeconds + loopSeconds;
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const tSec = (now - start) / 1000;
      if (tSec >= totalSeconds) {
        paint(ctx, sw, sh, 0.9999);
        resolve();
        return;
      }
      if (introFrames > 0 && tSec < introSeconds && paintIntro) {
        paintIntro(ctx, sw, sh, tSec / introSeconds, (tSec / loopSeconds) % 1);
      } else {
        // 導入→ループも単一の通し時計で連続（phase を 0 に戻さない）。
        paint(ctx, sw, sh, (tSec / loopSeconds) % 1);
      }
      onProgress?.(Math.min(frameCount, Math.round((tSec / totalSeconds) * frameCount)), frameCount);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await stopped;
  const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
  downloadBlob(new Blob(chunks, { type: mime }), name, ext);
}

export async function exportCanvasPng(
  paint: FramePainter,
  phase: number,
  name = "identity",
  w = 2560,
  h = 1440,
): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D コンテキストを取得できませんでした");
  paint(ctx, w, h, phase);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (blob) downloadBlob(blob, name, "png");
}

// raster コンテンツの SVG 書き出し: 現在フレームを PNG にして <image> で埋め込んだ
// 正当な .svg を生成する（ベクター化不可のため静止1フレーム）。
export function exportCanvasSvg(
  paint: FramePainter,
  phase: number,
  name = "identity",
  w = 1280,
  h = 720,
): void {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D コンテキストを取得できませんでした");
  paint(ctx, w, h, phase);
  const dataUrl = canvas.toDataURL("image/png");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<image width="${w}" height="${h}" href="${dataUrl}" xlink:href="${dataUrl}"/></svg>`;
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), name, "svg");
}
