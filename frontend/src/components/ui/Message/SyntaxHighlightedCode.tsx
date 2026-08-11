import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";

import { useTheme } from "@/components/providers/ThemeProvider";
import {
  DEFAULT_DARK_CODE_HIGHLIGHT_PRESET,
  DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET,
  resolvePrismCodeTheme,
} from "@/config/codeHighlightThemes";

const BASE_BLOCK_CODE_CUSTOM_STYLE = {
  margin: 0,
  overflow: "visible",
} as const;

interface SyntaxHighlightedCodeProps {
  code: string;
  language?: string;
}

/** Shared Prism renderer used by Markdown code blocks and Mermaid's code view. */
export function SyntaxHighlightedCode({
  code,
  language,
}: SyntaxHighlightedCodeProps) {
  const { effectiveTheme, theme } = useTheme();
  const fallbackPreset =
    effectiveTheme === "dark"
      ? DEFAULT_DARK_CODE_HIGHLIGHT_PRESET
      : DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET;
  const syntaxTheme = resolvePrismCodeTheme(
    theme.codeHighlight.preset,
    fallbackPreset,
  );
  const blockCustomStyle = {
    ...BASE_BLOCK_CODE_CUSTOM_STYLE,
    ...theme.codeHighlight.blockStyle,
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
