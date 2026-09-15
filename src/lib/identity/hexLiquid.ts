// 05 HEX HALO + 08 LIQUID GLASS をモード切替で1コンテンツに統合。
import type { MultiModeContent, Params } from "./types";
import {
  HEX_HALO_DEFAULTS,
  HEX_HALO_PRESETS,
  HEX_HALO_CONTROLS,
  createHexHalo,
} from "./hexHalo";
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
  title: "LIQUID GLASS / HEX HALO",
  bgKey: "bg",
  modes: [
    {
      value: "liquid-glass",
      label: "LIQUID GLASS",
      defaults: LIQUID_GLASS_DEFAULTS as unknown as Params,
      presets: LIQUID_GLASS_PRESETS as unknown as Params[],
      controls: LIQUID_GLASS_CONTROLS,
      create: createLiquidGlass,
    },
    {
      value: "hex-halo",
      label: "HEX HALO",
      defaults: HEX_HALO_DEFAULTS as unknown as Params,
      presets: HEX_HALO_PRESETS as unknown as Params[],
      controls: HEX_HALO_CONTROLS,
      create: createHexHalo,
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
