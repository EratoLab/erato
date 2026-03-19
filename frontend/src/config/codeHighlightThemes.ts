import nightOwl from "react-syntax-highlighter/dist/esm/styles/prism/night-owl";
import nord from "react-syntax-highlighter/dist/esm/styles/prism/nord";
import okaidia from "react-syntax-highlighter/dist/esm/styles/prism/okaidia";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import vs from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";

export const PRISM_CODE_THEME_STYLES = {
  vs,
  "vsc-dark-plus": vscDarkPlus,
  "one-light": oneLight,
  "one-dark": oneDark,
  "night-owl": nightOwl,
  nord,
  okaidia,
} as const;

export const PRISM_CODE_THEME_PRESETS = Object.keys(
  PRISM_CODE_THEME_STYLES,
) as Array<keyof typeof PRISM_CODE_THEME_STYLES>;

export type PrismCodeThemePreset = keyof typeof PRISM_CODE_THEME_STYLES;

export const DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET: PrismCodeThemePreset = "vs";
export const DEFAULT_DARK_CODE_HIGHLIGHT_PRESET: PrismCodeThemePreset =
  "vsc-dark-plus";

export const isPrismCodeThemePreset = (
  value: string,
): value is PrismCodeThemePreset => value in PRISM_CODE_THEME_STYLES;

export const resolvePrismCodeTheme = (
  preset: string | undefined,
  fallbackPreset: PrismCodeThemePreset,
) =>
  preset && isPrismCodeThemePreset(preset)
    ? PRISM_CODE_THEME_STYLES[preset]
    : PRISM_CODE_THEME_STYLES[fallbackPreset];
