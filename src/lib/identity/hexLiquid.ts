// 05 GRAPHIC LOGO を単一コンテンツとして提供。
import type { MultiModeContent, Params } from "./types";
import {
  LIQUID_GLASS_DEFAULTS,
  LIQUID_GLASS_PRESETS,
  LIQUID_GLASS_CONTROLS,
  createLiquidGlass,
} from "./liquidGlass";
import {
  createMockPreview,
  MOCK_PREVIEW_DEFAULTS,
  MOCK_PREVIEW_PRESETS,
  MOCK_PREVIEW_CONTROLS,
} from "./mockPreview";

export const HEX_LIQUID: MultiModeContent = {
  slug: "hex-liquid",
  no: "05",
  title: "GRAPHIC LOGO",
  bgKey: "bg",
  modes: [
    {
      value: "liquid-glass",
      label: "GRAPHIC LOGO",
      defaults: LIQUID_GLASS_DEFAULTS as unknown as Params,
      presets: LIQUID_GLASS_PRESETS as unknown as Params[],
      controls: LIQUID_GLASS_CONTROLS,
      create: createLiquidGlass,
    },
    {
      value: "mock-preview",
      label: "MOCK PREVIEW",
      defaults: MOCK_PREVIEW_DEFAULTS,
      presets: MOCK_PREVIEW_PRESETS,
      controls: MOCK_PREVIEW_CONTROLS,
      create: createMockPreview,
    },
  ],
};
