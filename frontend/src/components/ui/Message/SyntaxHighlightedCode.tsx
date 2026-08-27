import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";

import { useTheme } from "@/components/providers/ThemeProvider";
import {
  DEFAULT_DARK_CODE_HIGHLIGHT_PRESET,
  DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET,
  resolvePrismCodeTheme,
} from "@/config/codeHighlightThemes";

import type React from "react";

const BASE_BLOCK_CODE_CUSTOM_STYLE = {
  margin: 0,
  overflow: "visible",
} as const;

/** Where a Prism preset keeps the block's own box styling. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS selector
const PRISM_BLOCK_KEY = 'pre[class*="language-"]';

/** Blanks the surface on the element that scrolls, leaving padding in place. */
const HOISTED_SURFACE: React.CSSProperties = {
  background: "transparent",
  border: 0,
  borderRadius: 0,
};

interface SyntaxHighlightedCodeProps {
  code: string;
  language?: string;
  /**
   * Whether this element paints its own box. `hoisted` says an ancestor paints
   * it instead, which is what keeps the corners rounded once code scrolls
   * horizontally: this element is sized to its content, so its own right-hand
   * corners sit past the visible edge.
   */
  surface?: "own" | "hoisted";
}

function useResolvedCodeTheme() {
  const { effectiveTheme, theme } = useTheme();
  const fallbackPreset =
    effectiveTheme === "dark"
      ? DEFAULT_DARK_CODE_HIGHLIGHT_PRESET
      : DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET;
  return {
    syntaxTheme: resolvePrismCodeTheme(
      theme.codeHighlight.preset,
      fallbackPreset,
    ),
    blockStyle: theme.codeHighlight.blockStyle,
  };
}

/**
 * The box styling a code block would paint on itself, for an ancestor to paint
 * on its behalf. Pair it with `surface="hoisted"`.
 */
export function useCodeBlockSurfaceStyle(): React.CSSProperties {
  const { syntaxTheme, blockStyle } = useResolvedCodeTheme();
  const resolved = { ...syntaxTheme[PRISM_BLOCK_KEY], ...blockStyle };
  // Presets disagree on which of `background` and `backgroundColor` they set,
  // and the two must be collapsed into one key rather than both emitted:
  // switching preset re-applies the shorthand and then blanks the longhand,
  // which leaves the box with no background at all.
  return {
    background: resolved.backgroundColor ?? resolved.background,
    border: resolved.border,
    borderRadius: resolved.borderRadius,
  };
}

/** Shared Prism renderer used by Markdown code blocks and Mermaid's code view. */
export function SyntaxHighlightedCode({
  code,
  language,
  surface = "own",
}: SyntaxHighlightedCodeProps) {
  const { syntaxTheme, blockStyle } = useResolvedCodeTheme();
  const blockCustomStyle = {
    ...BASE_BLOCK_CODE_CUSTOM_STYLE,
    ...blockStyle,
    ...(surface === "hoisted" ? HOISTED_SURFACE : null),
  };

  return (
    <SyntaxHighlighter
      customStyle={blockCustomStyle}
      language={language === "" ? undefined : language}
      PreTag="div"
      style={syntaxTheme}
    >
      {code}
    </SyntaxHighlighter>
  );
}

// Keep the props type available to colocated tests and future host overrides.
export type { SyntaxHighlightedCodeProps };
