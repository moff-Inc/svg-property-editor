"use client";

import type { CSSProperties } from "react";
import type { ControlsSpec, Params, ParamValue } from "@/lib/identity/types";

// 数値文字列は number 化（buildPanel HTML:2253/2274 と同じ挙動）。
// "full"/"inner" 等は NaN → 文字列のまま。
function coerce(v: string): ParamValue {
  const n = Number(v);
  return v.trim() !== "" && !Number.isNaN(n) ? n : v;
}

// スライダーの進捗（--fill: %）。orbitype のトラック塗り分け用。
function fillStyle(num: number, min: number, max: number): CSSProperties {
  const pct = max > min ? ((num - min) / (max - min)) * 100 : 0;
  return { "--fill": `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties;
}

export default function ControlsPanel({
  spec,
  params,
  defaults,
  onChange,
}: {
  spec: ControlsSpec;
  params: Params;
  defaults: Params;
  onChange: (patch: Params) => void;
}) {
  return (
    <>
      {spec.map(([title, controls, visibleWhen]) => (
        visibleWhen && (params[visibleWhen.key] ?? defaults[visibleWhen.key]) !== visibleWhen.equals ? null :
        <div key={title} className="gen-section">
          <div className="gen-section-title">
            <h2>{title}</h2>
          </div>
          {controls.map((ctl) => {
            const key = ctl[0];
            const label = ctl[1];
            // HMR直後や古い保存データで新規キーが未設定でも、入力へNaN/undefinedを渡さない。
            const val = params[key] ?? defaults[key];

            if (ctl[2] === "r") {
              const [, , , min, max, step, unit] = ctl;
              const raw = typeof val === "number" ? val : Number(val);
              const num = Number.isFinite(raw) ? raw : min;
              return (
                <div key={key} className="gen-row">
                  <span>{label}</span>
                  <output>
                    {num.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}
                    {unit}
                  </output>
                  <input
                    type="range"
                    aria-label={label}
                    min={min}
                    max={max}
                    step={step}
                    value={num}
                    style={fillStyle(num, min, max)}
                    onChange={(e) => onChange({ [key]: Number(e.target.value) })}
                  />
                </div>
              );
            }

            if (ctl[2] === "k") {
              const color = typeof val === "string" ? val : "#000000";
              return (
                <div key={key} className="gen-color-row">
                  <span>{label}</span>
                  <label className="gen-swatch">
                    <i style={{ background: color }} />
                    <input
                      type="color"
                      aria-label={label}
                      value={color}
                      onChange={(e) => onChange({ [key]: e.target.value })}
                    />
                  </label>
                </div>
              );
            }

            if (ctl[2] === "n") {
              return (
                <div key={key} className="gen-field">
                  <span>{label}</span>
                  <input
                    className="gen-number"
                    type="number"
                    step={1}
                    value={typeof val === "number" ? val : Number(val) || 0}
                    onChange={(e) => onChange({ [key]: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
              );
            }

            if (ctl[2] === "c") {
              return (
                <div key={key} className="gen-switch-row">
                  <span>{label}</span>
                  <label className="gen-switch">
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={!!val}
                      onChange={(e) => onChange({ [key]: e.target.checked ? 1 : 0 })}
                    />
                    <i />
                  </label>
                </div>
              );
            }

            // "s" | "o"
            const options =
              ctl[2] === "s" ? ctl[3].map((o) => [o, o] as const) : ctl[3];
            return (
              <div key={key} className="gen-field">
                <span>{label}</span>
                <select
                  className="gen-select"
                  aria-label={label}
                  value={String(val)}
                  onChange={(e) => onChange({ [key]: coerce(e.target.value) })}
                >
                  {options.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
