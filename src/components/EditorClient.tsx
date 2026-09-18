"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import SvgCanvas from "./SvgCanvas";
import PropertyPanel from "./PropertyPanel";
import SaveStatus from "./SaveStatus";
import { useAutoSave } from "@/lib/hooks/useAutoSave";
import { serializeSvg, downloadSvg } from "@/lib/svg/serialize";
import { exportSvgVideo, type SvgVideoFormat } from "@/lib/svg/exportVideo";
import type { EditsMap, ElementEdit } from "@/lib/svg/types";
import "./generate/orbitype.css";

export default function EditorClient({
  docId,
  name,
  baseSvg,
  initialEdits,
  updatedAt,
}: {
  docId: string;
  name: string;
  baseSvg: string;
  initialEdits: EditsMap;
  updatedAt: string;
}) {
  const [edits, setEdits] = useState<EditsMap>(initialEdits);
  const [selectedEid, setSelectedEid] = useState<string | null>(null);
  const [restore, setRestore] = useState<EditsMap | null>(null);
  const [videoFormat, setVideoFormat] = useState<SvgVideoFormat>("mp4");
  const [videoPct, setVideoPct] = useState<number | null>(null);
  const [videoBytes, setVideoBytes] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const saveState = useAutoSave(docId, edits);

  // マウント時: サーバより新しいローカル下書きがあれば復元を提案
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`svged:draft:${docId}`);
      if (!raw) return;
      const draft = JSON.parse(raw) as { edits: EditsMap; ts: number };
      const serverTs = Date.parse(updatedAt);
      if (
        draft.ts > serverTs &&
        JSON.stringify(draft.edits) !== JSON.stringify(initialEdits)
      ) {
        // マウント時に外部(localStorage)を読んで復元候補を提示する正当な用途
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRestore(draft.edits);
      }
    } catch {
      // 破損時は無視
    }
  }, [docId, updatedAt, initialEdits]);

  const updateEdit = useCallback(
    (patch: Partial<ElementEdit>) => {
      if (!selectedEid) return;
      setEdits((prev) => ({
        ...prev,
        [selectedEid]: { ...(prev[selectedEid] ?? {}), ...patch },
      }));
    },
    [selectedEid],
  );

  const resetSelected = useCallback(() => {
    if (!selectedEid) return;
    setEdits((prev) => {
      const next = { ...prev };
      delete next[selectedEid];
      return next;
    });
  }, [selectedEid]);

  const currentEdit: ElementEdit = selectedEid
    ? (edits[selectedEid] ?? {})
    : {};

  function handleExport() {
    const svg = containerRef.current?.querySelector(
      "svg",
    ) as SVGSVGElement | null;
    if (!svg) return;
    downloadSvg(name, serializeSvg(svg));
  }

  async function handleExportVideo() {
    if (videoPct !== null) return; // 実行中は多重起動を防ぐ
    setVideoPct(0);
    setVideoBytes(0);
    try {
      await exportSvgVideo({
        baseSvg,
        edits,
        name,
        format: videoFormat,
        onProgress: (done, total, bytes) => {
          setVideoPct(Math.round((done / total) * 100));
          if (bytes !== undefined) setVideoBytes(bytes);
        },
      });
    } catch (e) {
      alert(
        `${videoFormat.toUpperCase()}の書き出しに失敗しました:\n${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setVideoPct(null);
    }
  }

  return (
    <div className="gen editor-shell">
      <div className="gen-topbar">
        <Link href="/" className="gen-brand" title="一覧へ戻る">
          <span className="gen-brand-mark">
            <i />
            <i />
            <i />
          </span>
          SVG PROPERTY EDITOR
        </Link>

        <div className="gen-project-meta">
          <span className="gen-title">{name}</span>
        </div>

        <div className="gen-actions">
          <SaveStatus state={saveState} />
          <button className="gen-tbtn" onClick={handleExport}>
            SVG
          </button>
          <select
            className="gen-select"
            value={videoFormat}
            onChange={(e) => setVideoFormat(e.target.value as SvgVideoFormat)}
            disabled={videoPct !== null}
            aria-label="動画の書き出し形式"
            title="MOVはSVGの透明部分を残したまま書き出します（QuickTime PNG / ロスレス）"
          >
            <option value="mp4">MP4</option>
            <option value="mov">MOV / 透過</option>
          </select>
          <button
            className="gen-export"
            onClick={handleExportVideo}
            disabled={videoPct !== null}
          >
            <span>
              {videoPct !== null
                ? `書き出し中 ${videoPct}%${videoBytes ? ` · ${(videoBytes / 1024 / 1024).toFixed(1)}MB` : ""}`
                : `${videoFormat.toUpperCase()}を書き出し`}
            </span>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
            </svg>
          </button>
        </div>
      </div>

      {restore && (
        <div className="gen-banner">
          <span>保存されていないローカル下書きがあります。復元しますか？</span>
          <span className="gen-banner-actions">
            <button
              className="is-primary"
              onClick={() => {
                setEdits(restore);
                setRestore(null);
              }}
            >
              復元
            </button>
            <button onClick={() => setRestore(null)}>破棄</button>
          </span>
        </div>
      )}

      <div className="gen-workspace">
        <div className="gen-stage-wrap">
          <div className="gen-stage-toolbar">
            <span>{name}</span>
            <span>SVG EDIT</span>
          </div>
          <SvgCanvas
            baseSvg={baseSvg}
            edits={edits}
            selectedEid={selectedEid}
            onSelect={setSelectedEid}
            containerRef={containerRef}
          />
          <div className="gen-stage-footer">
            <span>{selectedEid ? `選択: ${selectedEid}` : "要素を選択"}</span>
            <span>CLICK TO SELECT</span>
          </div>
        </div>

        <aside className="gen-inspector">
          <PropertyPanel
            selectedEid={selectedEid}
            edit={currentEdit}
            onChange={updateEdit}
            onReset={resetSelected}
          />
        </aside>
      </div>
    </div>
  );
}
