import { LayerCache, TAU, clamp } from "./engine";
import {
  createLiquidGlass,
  LIQUID_GLASS_DEFAULTS,
  LIQUID_GLASS_PRESETS,
} from "./liquidGlass";
import type { CanvasRenderer, ControlsSpec, Params } from "./types";

type Theme = "dark" | "system";
type Mood = "balanced" | "inspired" | "restful";

interface Palette {
  background: string;
  ink: string;
  muted: string;
  line: string;
  card: string;
  accent: string;
  tint: string;
}

const PALETTES: Record<Theme, Palette> = {
  dark: {
    background: "#101217", ink: "#f4f5fb", muted: "#9da3b3", line: "#2b2e38",
    card: "#1a1d25", accent: "#aca5ff", tint: "#26243a",
  },
  system: {
    background: "#ffffff", ink: "#20232d", muted: "#666c7a", line: "#e8e9ef",
    card: "#f3f4f7", accent: "#5751c9", tint: "#efedff",
  },
};

const MOODS: Record<Mood, { label: string; heading: string; score: number; change: number }> = {
  balanced: { label: "In balance", heading: "A little more in flow.", score: 84, change: 8 },
  inspired: { label: "Feeling inspired", heading: "Space for a new idea.", score: 92, change: 12 },
  restful: { label: "At your own pace", heading: "Make room for quiet.", score: 76, change: 4 },
};

export const MOCK_PREVIEW_DEFAULTS: Params = {
  mockTheme: "compare", mockMood: "balanced", energy: 78, calm: 92, focus: 86,
  variation: 2, bg: "#e9eaee",
};

export const MOCK_PREVIEW_PRESETS: Params[] = [
  { mockTheme: "dark" }, { mockTheme: "system" }, { mockTheme: "compare" },
];

export const MOCK_PREVIEW_CONTROLS: ControlsSpec = [
  ["ムード / MOOD", [
    ["mockMood", "ムード", "o", [["balanced", "バランス"], ["inspired", "インスピレーション"], ["restful", "リラックス"]]],
    ["energy", "Energy", "r", 0, 100, 1, "%"],
    ["calm", "Calm", "r", 0, 100, 1, "%"],
    ["focus", "Focus", "r", 0, 100, 1, "%"],
    ["variation", "数値のゆらぎ", "r", 0, 4, 1, ""],
  ]],
];

const SANS = "Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

function label(
  ctx: CanvasRenderingContext2D, value: string, x: number, y: number,
  size: number, color: string, weight = 400, align: CanvasTextAlign = "left", serif = false,
) {
  ctx.font = `${weight} ${size}px ${serif ? SERIF : SANS}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string | CanvasGradient) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, points: number[][], color: string, width = 1) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `${color}c0`);
  gradient.addColorStop(0.45, `${color}60`);
  gradient.addColorStop(1, `${color}00`);
  dot(ctx, x, y, radius, gradient);
}

function metricValue(params: Params, key: string, fallback: number, phase: number, offset: number) {
  const base = typeof params[key] === "number" ? params[key] : fallback;
  const variation = typeof params.variation === "number" ? params.variation : 2;
  return Math.round(clamp(base + Math.sin(TAU * phase + offset) * variation, 0, 100));
}

function statusBar(ctx: CanvasRenderingContext2D, palette: Palette) {
  label(ctx, "9:41", 30, 31, 13, palette.ink, 600);
  rect(ctx, 145, 15, 100, 25, 15, "#08090d");
  dot(ctx, 226, 27, 3, "#151b30");
  for (let i = 0; i < 4; i++) rect(ctx, 301 + i * 5, 30 - i * 3, 3, 3 + i * 3, 1, palette.ink);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.arc(334, 31, 5 + i * 4, Math.PI * 1.22, Math.PI * 1.78);
    ctx.stroke();
  }
  dot(ctx, 334, 31, 1.5, palette.ink);
  rect(ctx, 349, 23, 20, 10, 3, palette.muted);
  rect(ctx, 351, 25, 14, 6, 1, palette.background);
  rect(ctx, 370, 26, 2, 4, 1, palette.muted);
}

function metricCard(
  ctx: CanvasRenderingContext2D, x: number, y: number, kind: "energy" | "calm",
  value: number, phase: number, palette: Palette, dark: boolean,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, 167, 152, 22);
  ctx.clip();
  rect(ctx, x, y, 167, 152, 22, palette.card);
  const warm = kind === "energy";
  const drift = Math.sin(phase * TAU) * 10;
  glow(ctx, x + 129 + drift, y + 96, 85, warm ? "#ff875c" : "#22d8c5");
  glow(ctx, x + 155, y + 52 - drift, 69, warm ? "#e64fae" : "#566cf2");
  // Thin flowing contours distinguish the two moods without replacing the hero graphic.
  for (let i = 0; i < 6; i++) {
    const points: number[][] = [];
    for (let j = 0; j <= 36; j++) {
      const t = j / 36;
      points.push([
        x + 86 + t * 108,
        y + 66 + i * 7 + Math.sin(t * Math.PI * 2 + phase * TAU + i * 0.16) * (warm ? 25 : 14),
      ]);
    }
    line(ctx, points, dark ? "#ffffff35" : "#ffffffaa", 1);
  }
  label(ctx, warm ? "Energy" : "Calm", x + 16, y + 27, 14, palette.ink, 500);
  label(ctx, String(value), x + 16, y + 83, 42, palette.ink, 400);
  const numberWidth = ctx.measureText(String(value)).width;
  label(ctx, "%", x + 21 + numberWidth, y + 80, 13, palette.muted);
  label(ctx, warm ? "Ready to move" : "Room to breathe", x + 16, y + 135, 11, palette.ink);
  for (let i = 0; i < 16; i++) {
    const amplitude = 3 + (Math.sin(i * 0.64 + phase * TAU) + 1) * 4;
    rect(ctx, x + 17 + i * 4, y + 108 - amplitude / 2, 2, amplitude, 1, dark ? "#d6d8e1" : "#686b7e");
  }
  ctx.restore();
}

function navigation(ctx: CanvasRenderingContext2D, p: Palette) {
  line(ctx, [[24, 734], [366, 734]], p.line);
  rect(ctx, 31, 743, 102, 38, 19, p.tint);
  for (let i = 0; i < 4; i++) dot(ctx, 49 + (i % 2) * 6, 758 + Math.floor(i / 2) * 6, 2, p.accent);
  label(ctx, "Today", 72, 767, 12, p.accent, 600);
  line(ctx, [[176, 768], [176, 757], [180, 757], [180, 768]], p.muted, 1.6);
  line(ctx, [[187, 768], [187, 751], [191, 751], [191, 768]], p.muted, 1.6);
  label(ctx, "Trends", 204, 767, 12, p.muted);
  ctx.beginPath();
  ctx.arc(294, 757, 4, 0, TAU);
  ctx.strokeStyle = p.muted;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(294, 771, 7, Math.PI, TAU);
  ctx.stroke();
  label(ctx, "You", 310, 767, 12, p.muted);
  rect(ctx, 134, 792, 122, 4, 2, p.ink);
}

function drawPhone(
  ctx: CanvasRenderingContext2D, graphic: HTMLCanvasElement, theme: Theme,
  phase: number, params: Params,
) {
  const p = PALETTES[theme];
  const moodKey: Mood = params.mockMood === "inspired" || params.mockMood === "restful" ? params.mockMood : "balanced";
  const mood = MOODS[moodKey];
  const score = metricValue({ ...params, score: mood.score }, "score", mood.score, phase, 0);
  const energy = metricValue(params, "energy", 78, phase, 0.8);
  const calm = metricValue(params, "calm", 92, phase, 1.7);
  const focus = metricValue(params, "focus", 86, phase, 2.5);
  ctx.save();
  ctx.shadowColor = "#16182730";
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 16;
  rect(ctx, -6, -6, 402, 812, 54, theme === "dark" ? "#33353c" : "#c5c7cf");
  ctx.shadowColor = "transparent";
  rect(ctx, -3, -3, 396, 806, 51, theme === "dark" ? "#07080c" : "#f8f9fc");
  ctx.beginPath();
  ctx.roundRect(0, 0, 390, 800, 48);
  ctx.clip();
  rect(ctx, 0, 0, 390, 800, 48, p.background);
  statusBar(ctx, p);
  label(ctx, "mood", 24, 77, 27, p.ink, 600);
  label(ctx, "metrix", 95, 77, 27, p.ink, 400);
  dot(ctx, 352, 69, 16, p.tint);
  // Small four-point sparkle, repeated as a quiet brand detail.
  line(ctx, [[352, 60], [352, 78]], p.accent, 1.4);
  line(ctx, [[343, 69], [361, 69]], p.accent, 1.4);
  label(ctx, "YOUR DAILY LANDSCAPE", 24, 113, 10, p.muted, 600);
  label(ctx, "A moment for you", 366, 113, 10, p.muted, 400, "right");
  label(ctx, mood.heading, 24, 149, 27, p.ink, 400, "left", true);
  // Reuse the real LIQUID GLASS preset 02 renderer; the score occupies its hollow center.
  ctx.drawImage(graphic, 10, 153, 370, 370);
  label(ctx, "MOOD SCORE", 195, 307, 9, p.muted, 600, "center");
  label(ctx, String(score), 195, 365, 60, p.ink, 400, "center");
  label(ctx, "out of 100", 195, 385, 10, p.muted, 400, "center");
  rect(ctx, 121, 462, 148, 29, 15, p.tint);
  dot(ctx, 137, 476, 3, p.accent);
  label(ctx, mood.label, 200, 480, 12, p.accent, 500, "center");
  label(ctx, "Your rhythm", 24, 515, 17, p.ink, 600);
  label(ctx, `+${mood.change} pts from yesterday`, 366, 514, 10, p.muted, 400, "right");
  metricCard(ctx, 24, 530, "energy", energy, phase, p, theme === "dark");
  metricCard(ctx, 199, 530, "calm", calm, phase, p, theme === "dark");
  label(ctx, "Focus", 24, 714, 12, p.ink, 500);
  for (let i = 0; i < 35; i++) {
    const height = 5 + 11 * (0.5 + 0.5 * Math.sin(i * 0.22 + phase * TAU));
    rect(ctx, 94 + i * 6, 708 - height / 2, 3, height, 2, i / 35 < focus / 100 ? p.accent : p.line);
  }
  label(ctx, `${focus}%`, 366, 714, 15, p.ink, 500, "right");
  navigation(ctx, p);
  ctx.restore();
}

export function createMockPreview(): CanvasRenderer {
  const cache = new LayerCache();
  const liquid = { dark: createLiquidGlass(), system: createLiquidGlass() };
  return {
    render(ctx, W, H, phase, params) {
      const selected = params.mockTheme;
      const themes: Theme[] = selected === "dark" || selected === "system" ? [selected] : ["dark", "system"];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.filter = "none";
      ctx.fillStyle = "#e9eaee";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.scale(W / 1280, H / 720);
      const background = ctx.createLinearGradient(0, 0, 1280, 720);
      background.addColorStop(0, "#eeeff3");
      background.addColorStop(1, "#dfe1e8");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 1280, 720);
      label(ctx, "MOOD METRIX", 36, 36, 12, "#444858", 600);
      label(ctx, "A portrait of how you feel.", 36, 56, 11, "#717684");
      label(ctx, "MOBILE EXPERIENCE  /  01", 1244, 36, 10, "#717684", 400, "right");
      for (let i = 0; i < themes.length; i++) {
        const theme = themes[i];
        // Render at the actual output density (capped at 2x) in an independent layer.
        const size = Math.round(370 * Math.min(2, W / 1280));
        const layer = cache.get(`mock-${theme}`, size, size);
        liquid[theme].render(layer.x, size, size, phase, {
          ...LIQUID_GLASS_DEFAULTS,
          ...LIQUID_GLASS_PRESETS[1],
          bg: PALETTES[theme].background,
          wordmark: 0, transparent: 1, motion: 2,
        });
        const x = themes.length === 1 ? 484 : i === 0 ? 262 : 706;
        ctx.save();
        ctx.translate(x, 48);
        ctx.scale(0.8, 0.8);
        drawPhone(ctx, layer.c, theme, phase, params);
        ctx.restore();
        label(ctx, theme === "dark" ? "01  /  DARK" : "02  /  SYSTEM · WHITE", x + 156, 712, 10, "#5d6270", 500, "center");
      }
      label(ctx, "DESIGN PREVIEW", 36, 689, 9, "#717684", 500);
      label(ctx, "Illustrative mood data", 1244, 689, 9, "#717684", 400, "right");
      ctx.restore();
    },
  };
}
