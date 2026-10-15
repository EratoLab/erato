import { describe, expect, it } from "vitest";

import { wordPackageHoldsHiddenText } from "../wordCommentHiddenText";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const pkg = (paragraph: string, styles = "") =>
  `<?xml version="1.0" standalone="yes"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="${W}"><w:body>${paragraph}</w:body></w:document></pkg:xmlData></pkg:part>${
    styles
      ? `<pkg:part pkg:name="/word/styles.xml"><pkg:xmlData><w:styles xmlns:w="${W}">${styles}</w:styles></pkg:xmlData></pkg:part>`
      : ""
  }</pkg:package>`;

const run = (rPr: string, text = "words") =>
  `<w:p><w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t>${text}</w:t></w:r></w:p>`;

describe("wordPackageHoldsHiddenText", () => {
  it("finds a hidden run however Word spells it, and not a switched-off one", () => {
    expect(wordPackageHoldsHiddenText(pkg(run("")))).toBe(false);
    expect(wordPackageHoldsHiddenText(pkg(run("<w:b/>")))).toBe(false);
    for (const rPr of [
      "<w:vanish/>",
      "<w:vanish />",
      '<w:vanish w:val="1"/>',
      "<w:specVanish/>",
      "<w:webHidden/>",
    ])
      expect(wordPackageHoldsHiddenText(pkg(run(rPr)))).toBe(true);
    for (const off of ["0", "false", "off"])
      expect(
        wordPackageHoldsHiddenText(pkg(run(`<w:vanish w:val="${off}"/>`))),
      ).toBe(false);
  });

  it("counts a hidden paragraph mark", () => {
    expect(
      wordPackageHoldsHiddenText(
        pkg(
          "<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>",
        ),
      ),
    ).toBe(true);
  });

  it("follows a style, through basedOn, and the document defaults", () => {
    const hiding = `<w:style w:type="character" w:styleId="Secret"><w:rPr><w:vanish/></w:rPr></w:style><w:style w:type="character" w:styleId="Child"><w:basedOn w:val="Secret"/></w:style><w:style w:type="character" w:styleId="Plain"><w:rPr><w:b/></w:rPr></w:style>`;
    expect(
      wordPackageHoldsHiddenText(pkg(run('<w:rStyle w:val="Child"/>'), hiding)),
    ).toBe(true);
    expect(
      wordPackageHoldsHiddenText(pkg(run('<w:rStyle w:val="Plain"/>'), hiding)),
    ).toBe(false);
    expect(wordPackageHoldsHiddenText(pkg(run(""), hiding))).toBe(false);
    expect(
      wordPackageHoldsHiddenText(
        pkg(
          run(""),
          "<w:docDefaults><w:rPrDefault><w:rPr><w:vanish/></w:rPr></w:rPrDefault></w:docDefaults>",
        ),
      ),
    ).toBe(true);
  });

  it("counts a package that does not parse as hidden", () => {
    expect(wordPackageHoldsHiddenText("<pkg:package")).toBe(true);
  });
});
