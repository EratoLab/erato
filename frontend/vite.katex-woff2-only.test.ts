import { describe, expect, it } from "vitest";

import { keepKatexWoff2Sources } from "./vite.katex-woff2-only";

describe("keepKatexWoff2Sources", () => {
  it("keeps only the woff2 source of a font face", () => {
    const css =
      '@font-face{font-family:KaTeX_AMS;src:url(fonts/KaTeX_AMS-Regular.woff2) format("woff2"),url(fonts/KaTeX_AMS-Regular.woff) format("woff"),url(fonts/KaTeX_AMS-Regular.ttf) format("truetype")}';
    expect(keepKatexWoff2Sources(css)).toBe(
      '@font-face{font-family:KaTeX_AMS;src:url(fonts/KaTeX_AMS-Regular.woff2) format("woff2")}',
    );
  });

  it("leaves a stylesheet with only woff2 sources alone", () => {
    const css = 'src:url(fonts/a.woff2) format("woff2")}';
    expect(keepKatexWoff2Sources(css)).toBe(css);
  });
});
