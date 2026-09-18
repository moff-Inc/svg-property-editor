import DOMPurify from "dompurify";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { pickCodec, encodeDimensions } from "@/lib/media/h264";
import { MovWriter, MOV_CODEC_PRORES_4444, addCanvasFrameToMov } from "@/lib/media/movMuxer";
import { ProRes4444Encoder } from "@/lib/media/prores";
import { applyEdits } from "./apply";
import { ANIMATION_KEYFRAMES } from "./animations";
import type { EditsMap } from "./types";

// SVGアニメーションをブラウザ内で動画に書き出す（H.264/MP4 または 背景透過のMOV）。
// 方式: ライブと同一のSVGをオフスクリーンに構築 → 各フレームで CSS アニメを
// currentTime でシーク → spin は解析的に回転を、pulse/blink は getComputedStyle の
// opacity を各フレームのクローンへ焼き込み → data URL 経由でラスタライズ →
// WebCodecs VideoEncoder(avc) でエンコード → mp4-muxer で .mp4 コンテナ化。
// Cloudflare Workers では動画エンコード不可のため、あえてクライアント側で実行する。

const SVG_NS = "http://www.w3.org/2000/svg";
const KF_ID = "svged-export-kf";
const DEFAULT_DURATION_SEC = 2; // アニメ未指定時のクリップ長 / applyAnimation の既定と一致

// bytes は MOV のように書き出し途中でサイズが読める形式でのみ渡す。
export type VideoProgress = (done: number, total: number, bytes?: number) => void;

// "mov" は背景透過（Apple ProRes 4444）。H.264 はアルファを保持できない。
export type SvgVideoFormat = "mp4" | "mov";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseViewBox(svg: SVGSVGElement): Box {
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const p = vb.split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0)
      return { x: p[0], y: p[1], w: p[2], h: p[3] };
  }
  const w = parseFloat(svg.getAttribute("width") ?? "");
  const h = parseFloat(svg.getAttribute("height") ?? "");
  if (w > 0 && h > 0) return { x: 0, y: 0, w, h };
  return { x: 0, y: 0, w: 800, h: 600 };
}

// 移動/アニメーションで viewBox 外へ出た内容も含めた、サンプル時刻を通じての
// 描画範囲（SVG user 座標）。base(=viewBox) との和をとる。
//
// 計測は「幾何境界」(el.getBBox) を要素→SVGルートの行列(getScreenCTM)で user 座標へ
// 変換して行う。getScreenCTM は CSS アニメの transform も反映するため translate/scale/
// rotate やアニメの変位は捕捉しつつ、stroke 幅・filter 領域(実描画境界)は含めない。
// これにより「viewBox 端に接する stroke/filter 付き要素に、移動を伴わない編集(色変更や
// blink 等)を足しただけ」で誤ってカメラが引かれる=従来出力と不一致になる、を防ぐ。
async function measureContentExtent(
  svg: SVGSVGElement,
  anims: Animation[],
  eids: string[],
  sampleTimes: number[],
  base: Box,
): Promise<Box> {
  let minX = base.x;
  let minY = base.y;
  let maxX = base.x + base.w;
  let maxY = base.y + base.h;
  const rootCtm = svg.getScreenCTM();
  if (!rootCtm || eids.length === 0) {
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  const rootInv = rootCtm.inverse();
  // 要素参照はループ外で一度だけ解決
  const els = eids
    .map((id) => svg.querySelector<SVGGraphicsElement>(`[data-eid="${id}"]`))
    .filter((e): e is SVGGraphicsElement => e != null);
  for (let s = 0; s < sampleTimes.length; s++) {
    const t = sampleTimes[s];
    anims.forEach((a) => {
      try {
        a.currentTime = t * 1000;
        a.pause();
      } catch {
        // シーク不可のアニメは無視
      }
    });
    for (const el of els) {
      let bb: DOMRect;
      try {
        bb = el.getBBox();
      } catch {
        continue;
      }
      if (bb.width === 0 && bb.height === 0) continue;
      const elCtm = el.getScreenCTM();
      if (!elCtm) continue;
      const m = rootInv.multiply(elCtm); // 要素ローカル → SVGルート user 座標
      const corners: [number, number][] = [
        [bb.x, bb.y],
        [bb.x + bb.width, bb.y],
        [bb.x, bb.y + bb.height],
        [bb.x + bb.width, bb.y + bb.height],
      ];
      for (const [cx, cy] of corners) {
        const p = new DOMPoint(cx, cy).matrixTransform(m);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (s % 16 === 15) await new Promise((r) => setTimeout(r, 0)); // UIを止めない
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("フレーム画像のデコードに失敗しました"));
    img.src = url;
  });
}

export async function exportSvgVideo(opts: {
  baseSvg: string;
  edits: EditsMap;
  name: string;
  fps?: number;
  onProgress?: VideoProgress;
  format?: SvgVideoFormat;
}): Promise<void> {
  const { baseSvg, edits, name, fps = 30, onProgress } = opts;
  const format = opts.format ?? "mp4";

  if (format !== "mov" && (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined")) {
    throw new Error(
      "このブラウザは WebCodecs (VideoEncoder) に未対応です。Chrome / Edge / Safari 16.4+ でお試しください。",
    );
  }

  // 1. ライブと同一のSVGをオフスクリーンに構築（選択枠を含めないため live DOM は使わない）
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;pointer-events:none;";
  host.innerHTML = DOMPurify.sanitize(baseSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  const svg = host.querySelector("svg") as SVGSVGElement | null;
  if (!svg) throw new Error("SVG の解析に失敗しました");

  const kf = document.createElementNS(SVG_NS, "style");
  kf.setAttribute("id", KF_ID);
  kf.textContent = ANIMATION_KEYFRAMES;
  svg.insertBefore(kf, svg.firstChild);
  document.body.appendChild(host);

  try {
    applyEdits(svg, edits);

    // アニメーションが走っている全 [data-eid] を getComputedStyle で検出。
    // 組込プリセット(spin/pulse/blink)も生成SVGの独自 @keyframes も同じ扱い。
    const animatedEids: string[] = [];
    let maxAnimDur = 0;
    svg.querySelectorAll<SVGElement>("[data-eid]").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.animationName && cs.animationName !== "none") {
        const eid = el.getAttribute("data-eid");
        if (eid) animatedEids.push(eid);
        for (const tok of cs.animationDuration.split(",")) {
          const d = parseFloat(tok); // "4s" -> 4
          if (Number.isFinite(d) && d > maxAnimDur) maxAnimDur = d;
        }
      }
    });

    const vb = parseViewBox(svg);
    const w = vb.w;
    const h = vb.h;

    const duration = maxAnimDur > 0 ? maxAnimDur : DEFAULT_DURATION_SEC;
    const frameCount = Math.max(1, Math.round(duration * fps));

    const anims = svg.getAnimations({ subtree: true });

    // 移動/アニメーションが viewBox の外へ出ても切れないよう、全フレームの描画範囲に
    // 合わせて書き出しの viewBox を広げる（アスペクト比は維持＝カメラを引く）。
    // 何も範囲外へ出ない場合は viewBox を変えない（従来と同一の出力）。
    const eidsToMeasure = Array.from(
      new Set([...Object.keys(edits), ...animatedEids]),
    );
    if (eidsToMeasure.length > 0) {
      const nSamples = animatedEids.length > 0 ? Math.min(frameCount, 120) : 1;
      const sampleTimes = Array.from({ length: nSamples }, (_, k) =>
        nSamples > 1 ? (k / (nSamples - 1)) * duration : 0,
      );
      const ext = await measureContentExtent(svg, anims, eidsToMeasure, sampleTimes, vb);
      const exceeds =
        ext.x < vb.x - 0.5 ||
        ext.y < vb.y - 0.5 ||
        ext.x + ext.w > vb.x + vb.w + 0.5 ||
        ext.y + ext.h > vb.y + vb.h + 0.5;
      if (exceeds) {
        const mx = ext.w * 0.02;
        const my = ext.h * 0.02;
        let x = ext.x - mx;
        let y = ext.y - my;
        let ew = ext.w + mx * 2;
        let eh = ext.h + my * 2;
        // 元のアスペクト比に合わせて拡張し中央寄せ（出力の縦横比・解像度は不変）
        const target = w / h;
        if (ew / eh > target) {
          const neh = ew / target;
          y -= (neh - eh) / 2;
          eh = neh;
        } else {
          const newW = eh * target;
          x -= (newW - ew) / 2;
          ew = newW;
        }
        svg.setAttribute("viewBox", `${x} ${y} ${ew} ${eh}`);
        svg.setAttribute("width", String(ew));
        svg.setAttribute("height", String(eh));
      } else {
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(h));
      }
    } else {
      // data URL 経由の <img> が intrinsic size を持つよう明示
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
    }

    // 出力解像度は元の viewBox 比から決定（アスペクト比を維持しているため不変）
    const { sw, sh } = encodeDimensions(w, h);

    let muxer: Muxer<ArrayBufferTarget> | null = null;
    let encoder: VideoEncoder | null = null;
    let encodeError: unknown = null;
    const movWriter =
      format === "mov" ? new MovWriter({ width: sw, height: sh, fps, codec: MOV_CODEC_PRORES_4444 }) : null;
    const proresEncoder = format === "mov" ? new ProRes4444Encoder(sw, sh) : null;

    if (format === "mp4") {
      const codec = await pickCodec(sw, sh, fps);
      if (!codec) {
        throw new Error("対応する H.264 エンコーダが見つかりませんでした");
      }

      muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: sw, height: sh, frameRate: fps },
        fastStart: "in-memory",
      });

      const mx = muxer;
      encoder = new VideoEncoder({
        output: (chunk, meta) => mx.addVideoChunk(chunk, meta),
        error: (e) => {
          encodeError = e;
        },
      });
      const config = {
        codec,
        width: sw,
        height: sh,
        framerate: fps,
        bitrate: Math.min(20_000_000, Math.max(1_000_000, Math.round(sw * sh * fps * 0.12))),
        avc: { format: "avc" },
      } as VideoEncoderConfig;
      encoder.configure(config);
    }

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    // MOV は毎フレーム getImageData で読み戻す
    const ctx = canvas.getContext("2d", format === "mov" ? { willReadFrequently: true } : undefined);
    if (!ctx) throw new Error("Canvas 2D コンテキストを取得できませんでした");

    const frameDurUs = Math.round(1_000_000 / fps);

    for (let i = 0; i < frameCount; i++) {
      const t = i / fps; // 秒
      // 全アニメを当該時刻へシーク（pulse/blink の eased opacity 読み取りに必要）
      anims.forEach((a) => {
        try {
          a.currentTime = t * 1000;
          a.pause();
        } catch {
          // シーク不可のアニメは無視
        }
      });

      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.querySelector(`#${KF_ID}`)?.remove();

      // アニメ状態を各フレームのクローンへ焼き込む。シーク済みのライブ要素の
      // 算出スタイルを読み、transform/opacity をインライン化する。
      // spin=回転matrix+fill-box、pulse/blink=eased opacity、生成SVGの独自
      // アニメ(translate等)も同じ経路で正しく焼き込まれる。
      for (const eid of animatedEids) {
        const live = svg.querySelector<SVGElement>(`[data-eid="${eid}"]`);
        const target = clone.querySelector<SVGElement>(`[data-eid="${eid}"]`);
        if (!live || !target) continue;
        const cs = getComputedStyle(live);
        target.style.animation = "none";
        if (cs.transform && cs.transform !== "none") {
          target.style.transform = cs.transform;
          target.style.transformOrigin = cs.transformOrigin;
          target.style.setProperty(
            "transform-box",
            cs.getPropertyValue("transform-box"),
          );
        }
        target.style.opacity = cs.opacity;
      }

      // エディタ用データ属性を除去
      clone.querySelectorAll("*").forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          if (attr.name === "data-eid" || attr.name.startsWith("data-base-")) {
            el.removeAttribute(attr.name);
          }
        }
      });

      const svgStr = new XMLSerializer().serializeToString(clone);
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
      const img = await loadImage(url);

      ctx.clearRect(0, 0, sw, sh);
      if (format === "mp4") {
        // MP4(H.264) はアルファ非対応 → 白背景で合成。透過が要るなら MOV を使う。
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sw, sh);
      }
      ctx.drawImage(img, 0, 0, sw, sh);

      if (movWriter && proresEncoder) {
        addCanvasFrameToMov(movWriter, proresEncoder, ctx, sw, sh);
        onProgress?.(i + 1, frameCount, movWriter.byteLength);
      } else if (encoder) {
        const frame = new VideoFrame(canvas, {
          timestamp: i * frameDurUs,
          duration: frameDurUs,
        });
        encoder.encode(frame, { keyFrame: i % fps === 0 });
        frame.close();
        if (encodeError) throw encodeError;
        onProgress?.(i + 1, frameCount);
      }
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0)); // UIを止めない
    }

    let blob: Blob;
    let ext: string;
    if (movWriter) {
      blob = movWriter.finalize();
      ext = "mov";
    } else {
      await encoder!.flush();
      encoder!.close();
      if (encodeError) throw encodeError;
      muxer!.finalize();
      blob = new Blob([(muxer!.target as ArrayBufferTarget).buffer], { type: "video/mp4" });
      ext = "mp4";
    }
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = name.endsWith(`.${ext}`) ? name : `${name}.${ext}`;
    a.click();
    URL.revokeObjectURL(dlUrl);
  } finally {
    host.remove();
  }
}
