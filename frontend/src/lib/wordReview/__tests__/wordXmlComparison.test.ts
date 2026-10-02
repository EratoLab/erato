import { describe, expect, it } from "vitest";

import { createWordXmlComparison } from "../wordXmlComparison";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NBSP = String.fromCharCode(0xa0);
const paragraph = (text: string, preserve = false) =>
  `<w:p xmlns:w="${W}"><w:r><w:t${preserve ? ' xml:space="preserve"' : ""}>${text}</w:t></w:r></w:p>`;
const signature = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return createWordXmlComparison(doc).signature(doc.documentElement);
};

describe("word text signatures", () => {
  it("trims only XML whitespace from text without xml:space", () => {
    expect(signature(paragraph(" \t\r\nStatus \n"))).toBe(
      signature(paragraph("Status")),
    );
    expect(signature(paragraph(`${NBSP}Status`))).not.toBe(
      signature(paragraph("Status")),
    );
    expect(signature(paragraph(" Status ", true))).not.toBe(
      signature(paragraph("Status", true)),
    );
  });
});
