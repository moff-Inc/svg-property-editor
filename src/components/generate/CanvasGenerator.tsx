"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { MULTI_CONTENTS } from "@/lib/identity/registry";
import type { CanvasRenderer, Params } from "@/lib/identity/types";
import ControlsPanel from "./ControlsPanel";
import {
  exportCanvasMp4,
  exportCanvasPng,
  exportCanvasSvg,
} from "@/lib/identity/exportCanvasVideo";
import { saveGenerator } from "@/lib/identity/persist";
import { downloadSvg } from "@/lib/svg/serialize";
import "./orbitype.css";

export interface GenInitial {
  id: string;
  name: string;
  params: Params; // 保存された params（mode を含む）
}

const EXPORT_W = 1280;
const EXPORT_H = 720;

// スライダー進捗（--fill）。
function fill(num: number, min: number, max: number): CSSProperties {
  const pct = max > min ? ((num - min) / (max - min)) * 100 : 0;
  return { "--fill": `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties;
}

function getIntroSeconds(renderer: CanvasRenderer | null | undefined, params: Params): number {
  return renderer?.getIntroSeconds?.(params) ?? renderer?.introSeconds ?? 0;
}

export default function CanvasGenerator({
  slug,
  initial,
}: {
  slug: string;
  initial?: GenInitial;
}) {
  const content = MULTI_CONTENTS[slug];
  if (!content) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-zinc-500">このコンテンツは準備中です。</p>
        <Link
          href="/generate"
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/[.03] dark:border-white/20 dark:hover:bg-white/[.06]"
        >
          ← テンプレ一覧へ
        </Link>
      </div>
    );
  }
  return <CanvasGeneratorInner slug={slug} initial={initial} />;
}

function CanvasGeneratorInner({ slug, initial }: { slug: string; initial?: GenInitial }) {
  const content = MULTI_CONTENTS[slug];

  // 保存済みの mode が現存しない（削除されたモード等）場合は先頭モードへ正規化する。
  // 正規化せずに mode state へ残すと、書き出しファイル名や再保存に旧モード名が混入する。
  const savedMode = typeof initial?.params?.mode === "string" ? initial.params.mode : null;
  const baseMode = content.modes.find((m) => m.value === savedMode) ?? content.modes[0];
  const initialMode = baseMode.value;

  const [mode, setMode] = useState(initialMode);
  const active = content.modes.find((m) => m.value === mode) ?? content.modes[0];
  const isMockPreview = mode === "mock-preview";
  // このモードが導入（出現）アニメに対応するか（ref を読まずに判定）。
  const activeHasIntro = useMemo(() => !!active.create().renderIntro, [active]);

  const [params, setParams] = useState<Params>(() => {
    const init: Params = initial?.params ? { ...initial.params } : {};
    delete (init as Record<string, unknown>).mode;
    // 正規化が起きたときだけ、旧モードの残骸キーを捨てる（通常のレコードは素通し）
    if (savedMode !== null && savedMode !== initialMode) {
      for (const k of Object.keys(init)) if (!(k in baseMode.defaults)) delete init[k];
    }
    return { ...baseMode.defaults, ...init };
  });
  const [name, setName] = useState(initial?.name ?? content.title);
  const [genId, setGenId] = useState<string | null>(initial?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // アクセシビリティ: 「視差効果を減らす」設定では自動再生しない（手動再生は可）。
  const [playing, setPlaying] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [loopSeconds, setLoopSeconds] = useState(12);
  const [fps, setFps] = useState(60);
  const [bitrateMbps, setBitrateMbps] = useState(40);
  const [mp4Pct, setMp4Pct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  if (rendererRef.current == null) {
    rendererRef.current = active.create();
  }

  const paramsRef = useRef(params);
  const playingRef = useRef(playing);
  const loopRef = useRef(loopSeconds);
  const phaseRef = useRef(0);
  const exportingRef = useRef(false);
  // 導入（出現）アニメの再生状態。introActive の間は renderIntro を描画する。
  const introActiveRef = useRef(false);
  const introElapsedRef = useRef(0);
  const seekRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    paramsRef.current = params;
    playingRef.current = playing;
    loopRef.current = loopSeconds;
  }, [params, playing, loopSeconds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 高解像度表示: プレビューの実ピクセルを devicePixelRatio 倍で描画（上限2倍）。
    // 書き出し（PNG/MP4/SVG）は専用キャンバスを使うため解像度は従来どおり。
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (dpr !== 1) {
      canvas.width = Math.round(EXPORT_W * dpr);
      canvas.height = Math.round(EXPORT_H * dpr);
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      raf = requestAnimationFrame(tick);
      if (exportingRef.current) return;
      const r = rendererRef.current;
      const introSecs = getIntroSeconds(r, paramsRef.current);
      if (playingRef.current) {
        phaseRef.current = (phaseRef.current + dt / loopRef.current) % 1;
        if (introActiveRef.current) {
          introElapsedRef.current += dt;
          if (introSecs <= 0 || introElapsedRef.current >= introSecs) introActiveRef.current = false;
        }
      }
      const inIntro = introActiveRef.current && !!r?.renderIntro && introSecs > 0;
      if (inIntro && r?.renderIntro) {
        r.renderIntro(
          ctx,
          canvas.width,
          canvas.height,
          introElapsedRef.current / introSecs,
          phaseRef.current,
          paramsRef.current,
        );
      } else if (r) {
        r.render(ctx, canvas.width, canvas.height, phaseRef.current, paramsRef.current);
      }
      // 再生バーは通常ループの位相に同期。導入中はシークが飛ばないよう更新しない。
      const seek = seekRef.current;
      if (!inIntro && seek && (playingRef.current || document.activeElement !== seek)) {
        seek.value = String(phaseRef.current);
        seek.style.setProperty("--fill", `${(phaseRef.current * 100).toFixed(1)}%`);
      }
      if (timeRef.current) {
        timeRef.current.textContent = inIntro
          ? `導入 ${introElapsedRef.current.toFixed(1)}s / ${introSecs.toFixed(1)}s`
          : `${(phaseRef.current * loopRef.current).toFixed(1)}s / ${loopRef.current.toFixed(1)}s`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function switchMode(v: string) {
    const m = content.modes.find((x) => x.value === v);
    if (!m) return;
    setMode(v);
    setParams({ ...m.defaults });
    rendererRef.current = m.create();
    phaseRef.current = 0;
    introActiveRef.current = false;
    introElapsedRef.current = 0;
    setSaved(false);
  }

  // 導入（出現）アニメを頭から再生し、そのまま通常ループへ接続する。
  function playIntro() {
    const r = rendererRef.current;
    if (!r?.renderIntro || getIntroSeconds(r, paramsRef.current) <= 0) return;
    introElapsedRef.current = 0;
    introActiveRef.current = true;
    phaseRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
  }

  function applyPatch(patch: Params) {
    setParams((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  // 再生バーでのシーク（停止してその位置を表示。書き出しは phaseRef を使用）
  function seekTo(v: number) {
    introActiveRef.current = false; // 手動シーク時は導入を打ち切りループを表示
    // スライダーは [0,1] に制限済み。右端(1)で 0 へ折り返さないよう wrap ではなく clamp。
    phaseRef.current = Math.min(Math.max(v, 0), 1);
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
    }
    if (seekRef.current) {
      seekRef.current.value = String(phaseRef.current);
      seekRef.current.style.setProperty("--fill", `${(phaseRef.current * 100).toFixed(1)}%`);
    }
    if (timeRef.current) {
      timeRef.current.textContent = `${(phaseRef.current * loopRef.current).toFixed(1)}s / ${loopRef.current.toFixed(1)}s`;
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const id = await saveGenerator({
        id: genId,
        slug,
        name: name.trim() || content.title,
        // mode は最後に置く（同名パラメータがあってもモード名が消えないように）
        params: { ...params, mode },
      });
      setGenId(id);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleMp4() {
    if (mp4Pct !== null) return;
    setMp4Pct(0);
    setError(null);
    exportingRef.current = true;
    try {
      const r = active.create();
      const introSecs = getIntroSeconds(r, paramsRef.current);
      // 導入アニメ ON（intro=1 かつ対応レンダラ）のときは動画先頭に一度含める。
      const introOn =
        Boolean((paramsRef.current as Record<string, unknown>).intro) &&
        !!r.renderIntro &&
        introSecs > 0;
      await exportCanvasMp4({
        paint: (ctx, W, H, phase) => r.render(ctx, W, H, phase, paramsRef.current),
        width: EXPORT_W,
        height: EXPORT_H,
        fps,
        loopSeconds,
        bitrateMbps,
        name: `identity_${content.no}_${mode}`,
        onProgress: (d, t) => setMp4Pct(Math.round((d / t) * 100)),
        introSeconds: introOn ? introSecs : undefined,
        paintIntro:
          introOn && r.renderIntro
            ? (ctx, W, H, t01, phase) => r.renderIntro!(ctx, W, H, t01, phase, paramsRef.current)
            : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "MP4の書き出しに失敗しました");
    } finally {
      setMp4Pct(null);
      exportingRef.current = false;
    }
  }

  async function handlePng() {
    setError(null);
    try {
      const r = active.create();
      await exportCanvasPng(
        (ctx, W, H, phase) => r.render(ctx, W, H, phase, paramsRef.current),
        phaseRef.current,
        `identity_${content.no}_${mode}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "PNGの書き出しに失敗しました");
    }
  }

  function handleSvg() {
    setError(null);
    try {
      const r = active.create();
      if (r.toSvg) {
        // ベクターSVG（イラレ編集可: XYZ=図形、HEX/LIQUID=各ドットを図形化）
        downloadSvg(
          name.trim() || content.title,
          r.toSvg({ phase: phaseRef.current, loopSeconds, params: paramsRef.current }),
        );
        return;
      }
      // 非対応レンダラ: 現在フレームを高解像度で埋め込んだ SVG（ピクセル等価）
      exportCanvasSvg(
        (ctx, W, H, phase) => r.render(ctx, W, H, phase, paramsRef.current),
        phaseRef.current,
        `identity_${content.no}_${mode}`,
        EXPORT_W * 2,
        EXPORT_H * 2,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "SVGの書き出しに失敗しました");
    }
  }

  return (
    <div className="gen">
      {/* ---------- topbar ---------- */}
      <div className="gen-topbar">
        <div className="gen-nav">
          <Link href="/generate" className="gen-brand" title="テンプレ一覧へ戻る">
            <span className="gen-brand-mark">
              <i />
              <i />
              <i />
            </span>
            TEMPLATE
          </Link>
          <Link href="/" className="gen-tbtn" title="ホームに戻る">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
              <path
                d="M3 11.5 12 4l9 7.5M5.5 10v9h13v-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            ホーム
          </Link>
        </div>

        <div className="gen-project-meta">
          <span className="gen-title">
            {content.no} · {content.title}
          </span>
          <span className={`gen-status${playing ? "" : " is-off"}`}>
            <i />
            {playing ? "LIVE" : "PAUSED"} · {active.label}
          </span>
        </div>

        <div className="gen-actions">
          <input
            className="gen-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            placeholder="名前"
          />
          <button className="gen-tbtn" onClick={handleSave} disabled={saving}>
            {saving ? "…" : saved ? "SAVED" : "SAVE"}
          </button>
          <button className="gen-tbtn" onClick={handleSvg}>
            SVG
          </button>
          <button className="gen-tbtn" onClick={handlePng}>
            PNG
          </button>
          <button className="gen-export" onClick={handleMp4} disabled={mp4Pct !== null}>
            <span>{mp4Pct !== null ? `書き出し中 ${mp4Pct}%` : "MP4を書き出し"}</span>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* ---------- workspace ---------- */}
      <div className="gen-workspace">
        {/* stage: 画面内固定（スクロールしない） */}
        <div className="gen-stage-wrap">
          <div className="gen-stage-toolbar">
            <span>
              {content.no} / {active.label}
            </span>
            <span>
              {EXPORT_W}×{EXPORT_H}
            </span>
          </div>
          <div className="gen-stage">
            <canvas
              ref={canvasRef}
              width={EXPORT_W}
              height={EXPORT_H}
              className="gen-canvas"
              style={{ aspectRatio: "16 / 9" }}
              role="img"
              aria-label={isMockPreview
                ? `MOOD METRIXのモバイルモック。${params.mockTheme === "dark" ? "ダーク" : params.mockTheme === "system" ? "システム（ホワイト）" : "ダークとシステム（ホワイト）の比較"}。中央にLIQUID GLASSのパターン2、下部にEnergy・Calm・Focusのサンプル指標。表示内容は右側のコントロールで変更できます。`
                : `${active.label}のアニメーションプレビュー`}
            >
              プレビューの表示にはCanvasに対応したブラウザが必要です。
            </canvas>
          </div>
          <div className="gen-transport">
            <button
              className="gen-play"
              onClick={() => setPlaying((v) => !v)}
              title={playing ? "停止" : "再生"}
              aria-label={playing ? "停止" : "再生"}
            >
              {playing ? (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            {activeHasIntro && Boolean((params as Record<string, unknown>).intro) && (
              <button
                className="gen-tbtn gen-intro-btn"
                onClick={playIntro}
                title="導入アニメを頭から再生"
              >
                導入から再生
              </button>
            )}
            <input
              ref={seekRef}
              className="gen-seek"
              type="range"
              min={0}
              max={1}
              step={0.001}
              defaultValue={0}
              aria-label="再生位置"
              onPointerDown={() => {
                if (playingRef.current) {
                  playingRef.current = false;
                  setPlaying(false);
                }
              }}
              onInput={(e) => seekTo(Number(e.currentTarget.value))}
            />
            {error && <span className="gen-err">{error}</span>}
            <span ref={timeRef} className="gen-time" />
          </div>
        </div>

        {/* inspector: プロパティ変更部（唯一のスクロール領域） */}
        <aside className="gen-inspector">
          <div className="gen-inspector-head">
            <div>
              <div className="gen-eyebrow">IDENTITY / {content.no}</div>
              <h1>{active.label}</h1>
            </div>
          </div>

          {content.modes.length > 1 && (
            <div className="gen-section">
              <div className="gen-section-title">
                <h2>モード / MODE</h2>
              </div>
              <div className="gen-mode-switch">
                {content.modes.map((m) => (
                  <button
                    key={m.value}
                    className={m.value === mode ? "is-active" : ""}
                    onClick={() => switchMode(m.value)}
                    aria-pressed={m.value === mode}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isMockPreview && (
            <div className="gen-section">
              <div className="gen-section-title">
                <h2>外観 / APPEARANCE</h2>
              </div>
              <div className="gen-mock-themes" role="group" aria-label="モックの外観">
                {[
                  ["dark", "ダーク"],
                  ["system", "システム（ホワイト）"],
                  ["compare", "2タイプを比較"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={params.mockTheme === value}
                    onClick={() => applyPatch({ mockTheme: value })}
                  >
                    <span className={`gen-mock-swatch is-${value}`} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
              <p className="gen-mock-description">
                LIQUID GLASSのパターン2を中心にしたモバイルUI。
                システムはホワイト固定です。ムードと数値はデモ用に調整できます。
              </p>
            </div>
          )}

          <div className="gen-section">
            <div className="gen-section-title">
              <h2>出力 / OUTPUT</h2>
            </div>
            <div className="gen-row">
              <span>ループ長</span>
              <output>{loopSeconds}s</output>
              <input
                type="range"
                min={2}
                max={20}
                step={1}
                value={loopSeconds}
                style={fill(loopSeconds, 2, 20)}
                onChange={(e) => setLoopSeconds(Number(e.target.value))}
              />
            </div>
            <div className="gen-field">
              <span>FPS</span>
              <select
                className="gen-select"
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              >
                <option value={24}>24</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </div>
            <div className="gen-row">
              <span>ビットレート</span>
              <output>{bitrateMbps} Mbps</output>
              <input
                type="range"
                min={4}
                max={40}
                step={1}
                value={bitrateMbps}
                style={fill(bitrateMbps, 4, 40)}
                onChange={(e) => setBitrateMbps(Number(e.target.value))}
              />
            </div>
          </div>

          <ControlsPanel spec={active.controls} params={params} onChange={applyPatch} />

          {!isMockPreview && <div className="gen-section">
            <div className="gen-section-title">
              <h2>プリセット / PRESETS</h2>
              <span>{active.presets.length}</span>
            </div>
            <div className="gen-preset-grid">
              {active.presets.map((preset, i) => {
                // カラーパターン等 dotColor を持つプリセットは色スウォッチで表示。
                // gradient プリセットは内側→外側の2色でグラデーション表示。
                const rec = preset as Record<string, unknown>;
                const c1 = typeof rec.dotColor === "string" ? (rec.dotColor as string) : null;
                const c2 = typeof rec.dotColor2 === "string" ? (rec.dotColor2 as string) : null;
                const c3 = typeof rec.dotColor3 === "string" ? (rec.dotColor3 as string) : null;
                const swatch =
                  rec.dotSource === "gradient3" && c1 && c2
                    ? `linear-gradient(135deg, ${c2}, ${c3 ?? c1}, ${c1})`
                    : rec.dotSource === "gradient" && c1 && c2
                      ? `linear-gradient(135deg, ${c2}, ${c1})`
                      : c1;
                return (
                  <button
                    key={i}
                    className="gen-preset"
                    onClick={() => applyPatch({ ...preset })}
                    title={c1 ?? undefined}
                    style={
                      swatch
                        ? { background: swatch, borderColor: "transparent", color: "rgba(0,0,0,.5)" }
                        : undefined
                    }
                  >
                    {"0" + (i + 1)}
                  </button>
                );
              })}
            </div>
          </div>}

          <p className="gen-note">
            {isMockPreview
              ? "再生・停止とシークはグラフィック、カード、数値に連動します。PNG / MP4はモック全体を書き出します。モックのSVGは画像を埋め込む形式です。"
              : "再生バーで位置を合わせて停止すると、その瞬間が SVG / PNG に書き出されます。SVGは図形を編集できます。メッシュは4色のグラデーションとマスクで再現しています。"}
          </p>
        </aside>
      </div>
    </div>
  );
}
