import { describe, expect, it } from "vitest";

import {
  WORD_HOUSEKEEPING,
  normalizeWordPeopleList,
  normalizeWordPlaceholderEntries,
  normalizeWordRevisionIds,
  wordHousekeepingDifferences,
  wordHousekeepingTokens,
  wordPackageRoots,
  wordPlaceholderImportIssue,
} from "../wordHousekeeping";
import {
  createWordXmlComparison,
  removeWordDetectedLanguages,
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

describe("placeholder-entries", () => {
  // As Word for Mac 16.114 and Word PC 16.0.20430 export them (ERMAIN-980 dump-p1, dump-p2).
  const DATE = "63FB08E7FE97794DB32A1946C74B1837";
  const CLIENT = "0721F0149502C4499FFF6165A451B8A3";
  const DEFAULT = "DefaultPlaceholder_-1854013440";
  const BASE_STYLES = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="character" w:styleId="PlaceholderText"><w:name w:val="Placeholder Text"/><w:rPr><w:color w:val="666666"/></w:rPr></w:style>`;
  const macStyle = (name: string) =>
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${name}"><w:name w:val="${name}"/><w:rsid w:val="00A4708B"/></w:style>`;
  const pcStyle = (name: string) =>
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${name}"><w:name w:val="${name}"/><w:rsid w:val="00CC415A"/><w:rPr><w:lang w:eastAsia="en-DE"/></w:rPr></w:style>`;
  const control = (name: string, text: string, id: number) =>
    `<w:p><w:sdt><w:sdtPr><w:id w:val="${id}"/><w:placeholder><w:docPart w:val="${name}"/></w:placeholder><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt></w:p>`;
  const entry = (
    name: string,
    text: string,
    {
      guid = `{${name.slice(0, 8)}-0000-0000-0000-000000000000}`,
      pStyle = "",
      type = "bbPlcHdr",
      run = "",
    } = {},
  ) =>
    `<w:docPart><w:docPartPr><w:name w:val="${name}"/><w:category><w:name w:val="General"/><w:gallery w:val="placeholder"/></w:category><w:types><w:type w:val="${type}"/></w:types><w:behaviors><w:behavior w:val="content"/></w:behaviors><w:guid w:val="${guid}"/></w:docPartPr><w:docPartBody><w:p>${pStyle ? `<w:pPr><w:pStyle w:val="${pStyle}"/></w:pPr>` : ""}<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/>${run}</w:rPr><w:t>${text}</w:t></w:r></w:p></w:docPartBody></w:docPart>`;
  const glossaryPackage = ({
    controls,
    entries,
    styles = "",
    header = "",
  }: {
    controls: string;
    entries: string;
    styles?: string;
    header?: string;
  }) =>
    pkg({ body: controls }).replace(
      "</pkg:package>",
      part(
        "/word/glossary/document.xml",
        `<w:glossaryDocument xmlns:w="${W}"><w:docParts>${entries}</w:docParts></w:glossaryDocument>`,
      ) +
        part(
          "/word/glossary/styles.xml",
          `<w:styles xmlns:w="${W}">${BASE_STYLES}${styles}</w:styles>`,
        ) +
        (header
          ? part("/word/header1.xml", `<w:hdr xmlns:w="${W}">${header}</w:hdr>`)
          : "") +
        "</pkg:package>",
    );
  const exported = glossaryPackage({
    controls:
      control(DATE, "Enter the date here.", 1) +
      control(CLIENT, "Name of the client.", 2) +
      control(DEFAULT, "Click or tap here to enter text.", 3) +
      control(DATE, "Enter the date here.", 4),
    entries:
      entry(DEFAULT, "Click or tap here to enter text.") +
      entry(DATE, "Enter the date here.") +
      entry(CLIENT, "Name of the client."),
  });
  /** One import: fresh names and guids, entries in their controls' order, one entry style each. */
  const imported = (
    names = [
      "E28BAED8315E4A0FB8B866031B1F0A57",
      "C7D2B603EF3D4B19A1C2D3E4F5061728",
      "8B8B3A61919F4C2D8E7F6A5B4C3D2E1F",
    ],
    style = macStyle,
    texts = [
      "Enter the date here.",
      "Name of the client.",
      "Click or tap here to enter text.",
    ],
    extraStyles = "",
  ) =>
    glossaryPackage({
      controls:
        control(names[0], texts[0], 1) +
        control(names[1], texts[1], 2) +
        control(names[2], texts[2], 3) +
        control(names[0], texts[0], 4),
      entries: names
        .map((name, i) => entry(name, texts[i], { pStyle: name }))
        .join(""),
      styles: extraStyles + names.map(style).join(""),
    });
  const compare = (
    expected: string,
    actual: string,
    replaced?: string,
  ): { renamed: number; same: boolean } => {
    const [a, b] = [expected, actual].map(parse);
    const renamed = normalizeWordPlaceholderEntries(
      wordPackageRoots(a),
      wordPackageRoots(b),
      replaced === undefined ? undefined : wordPackageRoots(parse(replaced)),
    );
    const print = (doc: Document) => createWordXmlComparison(doc).fingerprint();
    return { renamed, same: print(a) === print(b) };
  };

  it("reads an import alike: renamed entries and controls, new order, Word's entry styles", () => {
    expect(compare(exported, imported())).toEqual({ renamed: 3, same: true });
    expect(compare(exported, imported(undefined, pcStyle))).toEqual({
      renamed: 3,
      same: true,
    });
  });

  it("reads a Revert alike: the entry styles the replaced package already held stay out", () => {
    const applied = imported();
    const restoredNames = [
      "1A8203258796433C9D1E2F3A4B5C6D7E",
      "C8E03CB2564F4A1B2C3D4E5F60718293",
      "A72C64F957384B5C6D7E8F90A1B2C3D4",
    ];
    const leftovers = [
      "E28BAED8315E4A0FB8B866031B1F0A57",
      "C7D2B603EF3D4B19A1C2D3E4F5061728",
      "8B8B3A61919F4C2D8E7F6A5B4C3D2E1F",
    ]
      .map(macStyle)
      .join("");
    const restored = imported(restoredNames, macStyle, undefined, leftovers);
    expect(compare(exported, restored, applied).same).toBe(true);
    expect(compare(exported, restored).same).toBe(false);
  });

  it("still sees changed placeholder text, a formatted entry style, a missing entry and swapped entries", () => {
    const changedText = imported(undefined, macStyle, [
      "Enter the date here.",
      "Name of the customer.",
      "Click or tap here to enter text.",
    ]);
    expect(compare(exported, changedText).same).toBe(false);
    const bold = imported(undefined, (name) =>
      macStyle(name).replace("</w:style>", "<w:rPr><w:b/></w:rPr></w:style>"),
    );
    expect(compare(exported, bold).same).toBe(false);
    const missing = imported().replace(
      '<w:docPart w:val="C7D2B603EF3D4B19A1C2D3E4F5061728"/>',
      '<w:docPart w:val="00000000000000000000000000000000"/>',
    );
    expect(compare(exported, missing)).toEqual({ renamed: 0, same: false });
    const swapped = imported(
      [
        "C7D2B603EF3D4B19A1C2D3E4F5061728",
        "E28BAED8315E4A0FB8B866031B1F0A57",
        "8B8B3A61919F4C2D8E7F6A5B4C3D2E1F",
      ],
      macStyle,
      [
        "Name of the client.",
        "Enter the date here.",
        "Click or tap here to enter text.",
      ],
    );
    expect(compare(exported, swapped).same).toBe(false);
  });

  it("still sees a shared entry split in two", () => {
    const split = imported().replace(
      '<w:sdtPr><w:id w:val="4"/><w:placeholder><w:docPart w:val="E28BAED8315E4A0FB8B866031B1F0A57"/>',
      '<w:sdtPr><w:id w:val="4"/><w:placeholder><w:docPart w:val="C7D2B603EF3D4B19A1C2D3E4F5061728"/>',
    );
    expect(compare(exported, split)).toEqual({ renamed: 0, same: false });
  });

  it("names the measured shapes before an import, and what lies outside them", () => {
    const issue = (xml: string) =>
      wordPlaceholderImportIssue(wordPackageRoots(parse(xml)));
    expect(issue(exported)).toBeUndefined();
    expect(issue(imported())).toBeUndefined();
    expect(issue(pkg({ body: "<w:p/>" }))).toBeUndefined();
    expect(
      issue(pkg({ body: control(DATE, "Enter the date here.", 1) })),
    ).toBeUndefined();
    const plain = (controls: string, entries: string, header = "") =>
      glossaryPackage({ controls, entries, header });
    expect(
      issue(
        plain(
          control(DATE, "Enter the date here.", 1),
          entry(DATE, "Enter the date here.") +
            entry(CLIENT, "Name of the client."),
        ),
      ),
    ).toBe("unreferenced-entry");
    expect(
      issue(
        plain(
          control(DATE, "Enter the date here.", 1),
          entry(DATE, "Enter the date here.", { type: "autoTxt" }),
        ),
      ),
    ).toBe("entry-shape");
    expect(
      issue(
        plain(
          control(DATE, "Enter the date here.", 1) +
            control(CLIENT, "Name of the client.", 2),
          entry(DATE, "Enter the date here."),
        ),
      ),
    ).toBe("missing-entry");
    expect(
      issue(
        plain(
          control(DATE, "Enter the date here.", 1),
          entry(DATE, "Enter the date here.") +
            entry(CLIENT, "Name of the client."),
          control(CLIENT, "Name of the client.", 2),
        ),
      ),
    ).toBe("story");
    expect(
      issue(
        plain(
          `<w:sdt><w:sdtContent>${control(DATE, "Enter the date here.", 1)}</w:sdtContent></w:sdt>`,
          entry(DATE, "Enter the date here."),
        ),
      ),
    ).toBe("nested");
  });
});

describe("glossary-rsids", () => {
  // Two exports of one unedited document by Word for Mac (ERMAIN-974 drift-notes).
  const rsids = (first: string) =>
    `<w:rsids><w:rsidRoot w:val="00786A3F"/><w:rsid w:val="${first}"/><w:rsid w:val="00786A3F"/><w:rsid w:val="00DB43C7"/><w:rsid w:val="00ED083C"/></w:rsids>`;
  const glossary = ({
    body = "<w:p/>",
    tabStop = "720",
    revisions = rsids("002C1862"),
    placeholder = "Enter the date here.",
  } = {}) =>
    pkg({ body }).replace(
      "</pkg:package>",
      part(
        "/word/glossary/settings.xml",
        `<w:settings xmlns:w="${W}"><w:view w:val="normal"/><w:defaultTabStop w:val="${tabStop}"/>${revisions}<w:themeFontLang w:val="en-DE"/><w:decimalSymbol w:val=","/></w:settings>`,
      ) +
        part(
          "/word/glossary/document.xml",
          `<w:glossaryDocument xmlns:w="${W}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="D3D05F838BB4A54490E3EABEDBBDBC10"/><w:category><w:name w:val="General"/><w:gallery w:val="placeholder"/></w:category><w:types><w:type w:val="bbPlcHdr"/></w:types></w:docPartPr><w:docPartBody><w:p w:rsidR="00ED083C" w:rsidRDefault="00786A3F"><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>${placeholder}</w:t></w:r></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`,
        ) +
        "</pkg:package>",
    );
  const fingerprint = (xml: string) =>
    createWordXmlComparison(parse(xml)).fingerprint();

  it("reads the glossary's settings alike whatever rsids an export gives them", () => {
    expect(fingerprint(glossary({ revisions: rsids("00514891") }))).toBe(
      fingerprint(glossary()),
    );
    expect(fingerprint(glossary({ revisions: "" }))).toBe(
      fingerprint(glossary()),
    );
  });

  it("still sees a change to the glossary's settings, its placeholder text or the body", () => {
    const base = fingerprint(glossary());
    expect(fingerprint(glossary({ tabStop: "1440" }))).not.toBe(base);
    expect(fingerprint(glossary({ placeholder: "Pick a date." }))).not.toBe(
      base,
    );
    expect(
      fingerprint(glossary({ body: "<w:p><w:r><w:t>Later</w:t></w:r></w:p>" })),
    ).not.toBe(base);
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

  it("removeWordDetectedLanguages drops each language in Word's detected form, wherever it sits", () => {
    const scripts = `<w:p><w:r>${tag("en-US", ' w:eastAsia="ja-JP"')}<w:t>Delta.</w:t></w:r></w:p>`;
    const styles = `<w:docDefaults><w:rPrDefault>${tag("de-DE")}</w:rPrDefault></w:docDefaults>`;
    const doc = parse(
      pkg({
        body: kept + paragraph("Bravo.", { lang: "fr-FR" }) + german + scripts,
        styles,
      }),
    );

    expect(removeWordDetectedLanguages(doc)).toBe(4);
    expect(createWordXmlComparison(doc).fingerprint()).toBe(
      createWordXmlComparison(
        parse(
          pkg({
            body:
              paragraph("Alpha is kept.") +
              paragraph("Bravo.") +
              german +
              scripts,
            styles,
          }),
        ),
      ).fingerprint(),
    );
  });

  it("counts a commented paragraph as kept though an import renumbered its comment", () => {
    const commented = (id: string) =>
      `<w:p><w:pPr>${tag("en-US")}</w:pPr><w:commentRangeStart w:id="${id}"/><w:r>${tag("en-US")}<w:t>Delta has a comment.</w:t></w:r><w:commentRangeEnd w:id="${id}"/><w:r>${tag("en-US")}<w:commentReference w:id="${id}"/></w:r></w:p>`;
    expect(
      removeWordRedetectedLanguage(
        parse(pkg({ body: kept + commented("4") })),
        parse(pkg({ body: kept + commented("6") })),
      ),
    ).toBe(0);
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

describe("revision-id", () => {
  const revisions = (ids: string[]) =>
    parse(
      pkg({
        body: `<w:p><w:del w:id="${ids[0]}" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del><w:ins w:id="${ids[1]}" w:author="A"><w:r><w:t>new</w:t></w:r></w:ins><w:moveFromRangeStart w:id="${ids[2]}" w:author="A" w:name="m"/><w:moveFromRangeEnd w:id="${ids[2]}"/></w:p>`,
      }),
    );
  const normalized = (doc: Document) => {
    normalizeWordRevisionIds([doc.documentElement]);
    return createWordXmlComparison(doc).fingerprint();
  };

  it("numbers revision marks by order, keeping the marks of one move together", () => {
    const doc = revisions(["13", "14", "20"]);
    expect(normalizeWordRevisionIds([doc.documentElement])).toEqual([
      "13",
      "14",
      "20",
      "20",
    ]);
    expect(
      Array.from(doc.getElementsByTagNameNS(W, "*"))
        .filter((e) => e.hasAttributeNS(W, "id"))
        .map((e) => e.getAttributeNS(W, "id")),
    ).toEqual(["revision-0", "revision-1", "revision-2", "revision-2"]);
    expect(normalized(revisions(["6", "7", "9"]))).toBe(
      normalized(revisions(["13", "14", "20"])),
    );
  });

  it("still sees a revision by someone else", () => {
    const other = revisions(["6", "7", "9"]);
    other
      .getElementsByTagNameNS(W, "del")[0]
      .setAttributeNS(W, "w:author", "B");
    expect(normalized(other)).not.toBe(
      normalized(revisions(["13", "14", "20"])),
    );
  });
});

describe("people-list", () => {
  const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
  const person = (author: string, provider = "None") =>
    `<w15:person w15:author="${author}"><w15:presenceInfo w15:providerId="${provider}" w15:userId="${author}"/></w15:person>`;
  const roots = (persons: string[], authors: string[]) => {
    const doc = parse(
      `<root xmlns:w="${W}" xmlns:w15="${W15}"><w15:people>${persons.join("")}</w15:people><w:comments>${authors
        .map((a, i) => `<w:comment w:id="${i}" w:author="${a}"/>`)
        .join("")}</w:comments></root>`,
    );
    return {
      people: doc.getElementsByTagNameNS(W15, "people")[0],
      comments: doc.getElementsByTagNameNS(W, "comments")[0],
    };
  };
  const after = (persons: string[], authors: string[]) => {
    const { people, comments } = roots(persons, authors);
    normalizeWordPeopleList(people, comments);
    return new XMLSerializer().serializeToString(people);
  };

  it("keeps one entry per author with a comment left, in any order Word writes them", () => {
    const { people, comments } = roots(
      [person("Maya"), person("Max", "AD"), person("Lena")],
      ["Maya", "Lena", "Maya"],
    );
    expect(normalizeWordPeopleList(people, comments)).toBe(true);
    expect(
      Array.from(people.children).map((p) => p.getAttributeNS(W15, "author")),
    ).toEqual(["Lena", "Maya"]);
    expect(after([person("Lena"), person("Maya")], ["Maya", "Lena"])).toBe(
      after([person("Maya"), person("Lena")], ["Lena", "Maya"]),
    );
  });

  it("still sees another entry for an author with comments, or a missing one", () => {
    const base = after([person("Maya"), person("Lena")], ["Maya", "Lena"]);
    expect(
      after([person("Maya", "AD"), person("Lena")], ["Maya", "Lena"]),
    ).not.toBe(base);
    expect(after([person("Maya")], ["Maya", "Lena"])).not.toBe(base);
  });
});
