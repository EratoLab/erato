import { describe, expect, it } from "vitest";

import {
  WORD_HOUSEKEEPING,
  wordHousekeepingDifferences,
  wordHousekeepingTokens,
} from "../wordHousekeeping";
import {
  createWordXmlComparison,
  removeWordRedetectedLanguage,
} from "../wordXmlComparison";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const part = (name: string, xml: string) =>
  `<pkg:part pkg:name="${name}" pkg:contentType="application/xml"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`;
const pkg = ({
  body,
  styles = "",
  settings = "",
  numbering = "",
}: {
  body: string;
  styles?: string;
  settings?: string;
  numbering?: string;
}) =>
  `<pkg:package xmlns:pkg="${PKG}">` +
  part(
    "/word/document.xml",
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
  ) +
  part("/word/styles.xml", `<w:styles xmlns:w="${W}">${styles}</w:styles>`) +
  part(
    "/word/settings.xml",
    `<w:settings xmlns:w="${W}">${settings}</w:settings>`,
  ) +
  part(
    "/word/numbering.xml",
    `<w:numbering xmlns:w="${W}" xmlns:w16cid="${CID}">${numbering}</w:numbering>`,
  ) +
  `</pkg:package>`;
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");
const bodyRead = (xml: string) => {
  const doc = parse(xml);
  return {
    fingerprint: createWordXmlComparison(doc, { bodyRead: true }).fingerprint(),
    housekeeping: wordHousekeepingTokens(doc),
  };
};

const ABSTRACTS = [0, 1]
  .map(
    (id) =>
      `<w:abstractNum w:abstractNumId="${id}"><w:lvl w:ilvl="0"><w:numFmt w:val="${id ? "decimal" : "bullet"}"/></w:lvl></w:abstractNum>`,
  )
  .join("");
const numbering = (durableId: string, abstractNumId = "0") =>
  `${ABSTRACTS}<w:num w:numId="1" w16cid:durableId="${durableId}"><w:abstractNumId w:val="${abstractNumId}"/></w:num>`;
const look = (val: string, flags: number[]) => {
  const [firstRow, lastRow, firstColumn, lastColumn, noHBand, noVBand] = flags;
  return `<w:tblLook w:val="${val}" w:firstRow="${firstRow}" w:lastRow="${lastRow}" w:firstColumn="${firstColumn}" w:lastColumn="${lastColumn}" w:noHBand="${noHBand}" w:noVBand="${noVBand}"/>`;
};
const LOOK_NONE = look("0000", [0, 0, 0, 0, 0, 0]);
const LOOK_DEFAULT = look("04A0", [1, 0, 1, 0, 0, 1]);
const LOOK_HEADER = look("0020", [1, 0, 0, 0, 0, 0]);
const table = (tableLook: string, style?: string) =>
  `<w:tbl><w:tblPr>${style ? `<w:tblStyle w:val="${style}"/>` : ""}<w:tblW w:w="0" w:type="auto"/>${tableLook}</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>`;
const GRID_STYLE = `<w:style w:type="table" w:styleId="GridTable4"><w:name w:val="Grid Table 4"/><w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr></w:tblStylePr></w:style>`;
const themeLanguage = (val: string, eastAsia = "ja-JP") =>
  `<w:themeFontLang w:val="${val}" w:eastAsia="${eastAsia}" w:bidi="ar-SA"/>`;

describe("WORD_HOUSEKEEPING", () => {
  it("names each entry's element, part, hosts and proving probe", () => {
    expect(new Set(WORD_HOUSEKEEPING.map((e) => e.id)).size).toBe(
      WORD_HOUSEKEEPING.length,
    );
    for (const entry of WORD_HOUSEKEEPING) {
      expect(entry.element).toBeTruthy();
      expect(entry.part).toMatch(/^\/word\//);
      expect(entry.hosts.length).toBeGreaterThan(0);
      expect(entry.probe).toMatch(/ERMAIN-9\d\d/);
    }
  });
});

describe("body-read housekeeping", () => {
  it("list-instance-id: reads a list instance alike whatever durableId a read gives it", () => {
    const a = bodyRead(pkg({ body: "<w:p/>", numbering: numbering("111") }));
    const b = bodyRead(pkg({ body: "<w:p/>", numbering: numbering("222") }));
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(wordHousekeepingDifferences(a.housekeeping, b.housekeeping)).toEqual(
      { "list-instance-id": 1 },
    );
  });

  it("list-instance-id: still sees a list instance pointed at another definition", () => {
    expect(
      bodyRead(pkg({ body: "<w:p/>", numbering: numbering("111", "1") }))
        .fingerprint,
    ).not.toBe(
      bodyRead(pkg({ body: "<w:p/>", numbering: numbering("111") }))
        .fingerprint,
    );
  });

  it("table-look: reads an unstyled table's look alike as unset, 0000 or 04A0", () => {
    const unset = bodyRead(pkg({ body: table("") }));
    const none = bodyRead(pkg({ body: table(LOOK_NONE) }));
    const fallback = bodyRead(pkg({ body: table(LOOK_DEFAULT) }));
    expect(none.fingerprint).toBe(unset.fingerprint);
    expect(fallback.fingerprint).toBe(unset.fingerprint);
    expect(
      wordHousekeepingDifferences(none.housekeeping, fallback.housekeeping),
    ).toEqual({ "table-look": 1 });
  });

  it("table-look: still sees the look of a table whose style has conditional formatting", () => {
    expect(
      bodyRead(
        pkg({ body: table(LOOK_NONE, "GridTable4"), styles: GRID_STYLE }),
      ).fingerprint,
    ).not.toBe(
      bodyRead(
        pkg({ body: table(LOOK_DEFAULT, "GridTable4"), styles: GRID_STYLE }),
      ).fingerprint,
    );
  });

  it("table-look: still sees any other look, even on an unstyled table", () => {
    const none = bodyRead(pkg({ body: table(LOOK_NONE) }));
    const header = bodyRead(pkg({ body: table(LOOK_HEADER) }));
    expect(header.fingerprint).not.toBe(none.fingerprint);
    expect(
      wordHousekeepingDifferences(none.housekeeping, header.housekeeping),
    ).toEqual({});
  });

  it("theme-font-language: reads the theme font language without its region", () => {
    const gb = bodyRead(
      pkg({ body: "<w:p/>", settings: themeLanguage("en-GB") }),
    );
    const us = bodyRead(
      pkg({ body: "<w:p/>", settings: themeLanguage("en-US") }),
    );
    expect(us.fingerprint).toBe(gb.fingerprint);
    expect(
      wordHousekeepingDifferences(gb.housekeeping, us.housekeeping),
    ).toEqual({ "theme-font-language": 1 });
  });

  it("theme-font-language: still sees another language or another East Asian language", () => {
    const gb = bodyRead(
      pkg({ body: "<w:p/>", settings: themeLanguage("en-GB") }),
    );
    const de = bodyRead(
      pkg({ body: "<w:p/>", settings: themeLanguage("de-DE") }),
    );
    expect(de.fingerprint).not.toBe(gb.fingerprint);
    expect(
      wordHousekeepingDifferences(gb.housekeeping, de.housekeeping),
    ).toEqual({});
    expect(
      bodyRead(
        pkg({ body: "<w:p/>", settings: themeLanguage("en-GB", "zh-CN") }),
      ).fingerprint,
    ).not.toBe(gb.fingerprint);
  });
});

describe("complete packages", () => {
  it("keep every body-read entry visible", () => {
    const fingerprint = (xml: string) =>
      createWordXmlComparison(parse(xml)).fingerprint();
    expect(
      fingerprint(pkg({ body: "<w:p/>", numbering: numbering("222") })),
    ).not.toBe(
      fingerprint(pkg({ body: "<w:p/>", numbering: numbering("111") })),
    );
    expect(fingerprint(pkg({ body: table(LOOK_DEFAULT) }))).not.toBe(
      fingerprint(pkg({ body: table(LOOK_NONE) })),
    );
    expect(
      fingerprint(pkg({ body: "<w:p/>", settings: themeLanguage("en-US") })),
    ).not.toBe(
      fingerprint(pkg({ body: "<w:p/>", settings: themeLanguage("en-GB") })),
    );
  });
});

describe("proofing-language", () => {
  const tag = (val: string, extra = "") =>
    `<w:rPr><w:lang w:val="${val}"${extra}/></w:rPr>`;
  const paragraph = (
    text: string,
    { style, lang }: { style?: string; lang?: string } = {},
  ) =>
    `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${lang ? tag(lang) : ""}</w:pPr><w:r>${lang ? tag(lang) : ""}<w:t>${text}</w:t></w:r></w:p>`;
  const kept = paragraph("Alpha is kept.", { lang: "en-US" });
  const german = paragraph("Charlie bleibt deutsch.");
  const original = pkg({
    body: kept + paragraph("Bravo is restyled.", { lang: "en-US" }) + german,
  });
  const written = (bravo: string, alpha = kept, charlie = german) =>
    pkg({ body: alpha + bravo + charlie });
  const compiled = written(
    paragraph("Bravo is restyled.", { style: "Heading2" }),
  );
  const fingerprint = (xml: string) => {
    const doc = parse(xml);
    const removed = removeWordRedetectedLanguage(doc, parse(original));
    return { fingerprint: createWordXmlComparison(doc).fingerprint(), removed };
  };

  it("leaves out the language Word re-detects on a paragraph the write produced", () => {
    const word = fingerprint(
      written(
        paragraph("Bravo is restyled.", { style: "Heading2", lang: "en-US" }),
      ),
    );
    expect(word.fingerprint).toBe(fingerprint(compiled).fingerprint);
    expect(word.removed).toBe(2);
  });

  it("still sees another language set on the written paragraph", () => {
    expect(
      fingerprint(
        written(
          paragraph("Bravo is restyled.", { style: "Heading2", lang: "fr-FR" }),
        ),
      ).fingerprint,
    ).not.toBe(fingerprint(compiled).fingerprint);
  });

  it("still sees a language set on paragraphs the write kept", () => {
    const restyled = paragraph("Bravo is restyled.", {
      style: "Heading2",
      lang: "en-US",
    });
    const base = fingerprint(written(restyled)).fingerprint;
    expect(
      fingerprint(
        written(restyled, paragraph("Alpha is kept.", { lang: "fr-FR" })),
      ).fingerprint,
    ).not.toBe(base);
    expect(
      fingerprint(
        written(
          restyled,
          kept,
          paragraph("Charlie bleibt deutsch.", { lang: "en-US" }),
        ),
      ).fingerprint,
    ).not.toBe(base);
  });

  it("still sees a language that sets more than w:val", () => {
    const withScripts = written(
      `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r>${tag("en-US", ' w:eastAsia="ja-JP"')}<w:t>Bravo is restyled.</w:t></w:r></w:p>`,
    );
    expect(fingerprint(withScripts).fingerprint).not.toBe(
      fingerprint(compiled).fingerprint,
    );
  });
});
