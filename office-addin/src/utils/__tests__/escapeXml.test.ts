import { describe, expect, it } from "vitest";

import { escapeXml } from "../escapeXml";

describe("escapeXml", () => {
  it("escapes every XML-significant character exactly once", () => {
    expect(escapeXml(`Tom & "Jerry" <O'Neil> &amp;`)).toBe(
      "Tom &amp; &quot;Jerry&quot; &lt;O&apos;Neil&gt; &amp;amp;",
    );
  });

  it("round-trips through an attribute value", () => {
    const value = `a"b'c<d>&e`;
    const doc = new DOMParser().parseFromString(
      `<x v="${escapeXml(value)}">${escapeXml(value)}</x>`,
      "application/xml",
    );
    expect(doc.documentElement.getAttribute("v")).toBe(value);
    expect(doc.documentElement.textContent).toBe(value);
  });
});
