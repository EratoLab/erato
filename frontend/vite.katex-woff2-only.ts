import type { Plugin } from "vite";

const KATEX_STYLESHEET = /\/katex\/dist\/katex(?:\.min)?\.css(?:\?|$)/;
const LEGACY_FONT_SOURCE =
  /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g;

/** KaTeX's stylesheet with only the woff2 source of each font face. */
export function keepKatexWoff2Sources(css: string): string {
  return css.replace(LEGACY_FONT_SOURCE, "");
}

/**
 * Library mode inlines every font a stylesheet names as base64. KaTeX names
 * each face three times, and every webview the library runs in loads the
 * woff2 source, so the woff and ttf copies only add about 1 MB. A KaTeX
 * version that writes its sources differently fails the build here instead
 * of silently bringing them back.
 */
export function katexWoff2OnlyPlugin(): Plugin {
  return {
    name: "erato:katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!KATEX_STYLESHEET.test(id)) return null;
      const css = keepKatexWoff2Sources(code);
      if (css === code) {
        this.error(`No woff or ttf font source found to remove in ${id}`);
      }
      return { code: css, map: null };
    },
  };
}
