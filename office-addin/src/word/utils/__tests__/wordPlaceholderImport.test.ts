import { wordSourceReadRefs } from "@erato/frontend/word-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import { packageXml } from "../../../test/mocks/word/authoringFixtures";
import { parseWordXml } from "../wordDocumentPackageCodec";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import { wordFullDocumentDifferences } from "../wordFullDocumentComparison";
import { wordWholeDocumentWrite } from "../wordInPlaceRoute";

import type { WordDocumentPlan } from "@erato/frontend/word-review";

afterEach(() => vi.unstubAllGlobals());

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const DATE = "63FB08E7FE97794DB32A1946C74B1837";
const DEFAULT = "DefaultPlaceholder_-1854013440";
/** A control in its paragraph, as Word for Mac captures it once it has tagged the language. */
const control = (name: string, text: string, id: number) =>
  `<w:p><w:pPr><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr><w:sdt><w:sdtPr><w:id w:val="${id}"/><w:placeholder><w:docPart w:val="${name}"/></w:placeholder><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt></w:p>`;
const entry = (name: string, text: string, pStyle = "") =>
  `<w:docPart><w:docPartPr><w:name w:val="${name}"/><w:category><w:name w:val="General"/><w:gallery w:val="placeholder"/></w:category><w:types><w:type w:val="bbPlcHdr"/></w:types><w:behaviors><w:behavior w:val="content"/></w:behaviors><w:guid w:val="{${name.slice(0, 8)}-0000-0000-0000-000000000000}"/></w:docPartPr><w:docPartBody><w:p>${pStyle ? `<w:pPr><w:pStyle w:val="${pStyle}"/></w:pPr>` : ""}<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:docPartBody></w:docPart>`;
const part = (name: string, type: string, xml: string) =>
  `<pkg:part pkg:name="${name}" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`;
const GLOSSARY_STYLES = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="character" w:styleId="PlaceholderText"><w:name w:val="Placeholder Text"/><w:rPr><w:color w:val="666666"/></w:rPr></w:style>`;
const entryStyle = (name: string) =>
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${name}"><w:name w:val="${name}"/><w:rsid w:val="00A4708B"/></w:style>`;

/** As Word for Mac exports a form: the glossary's parts come before the main document's. */
function form(
  names: [string, string] = [DATE, DEFAULT],
  pStyles = false,
  styles = "",
): string {
  const body =
    `<w:p><w:r><w:t>Alpha: plain paragraph.</w:t></w:r></w:p>` +
    control(names[0], "Enter the date here.", 1) +
    control(names[1], "Click or tap here to enter text.", 2) +
    `<w:p><w:r><w:t>Omega: plain paragraph.</w:t></w:r></w:p>`;
  const entries = [
    entry(
      names[1],
      "Click or tap here to enter text.",
      pStyles ? names[1] : "",
    ),
    entry(names[0], "Enter the date here.", pStyles ? names[0] : ""),
  ];
  return packageXml(body).replace(
    `<pkg:package xmlns:pkg="${PKG}">`,
    `<pkg:package xmlns:pkg="${PKG}">` +
      part(
        "/word/glossary/styles.xml",
        "styles",
        `<w:styles xmlns:w="${W}">${GLOSSARY_STYLES}${styles}</w:styles>`,
      ) +
      part(
        "/word/glossary/document.xml",
        "document.glossary",
        `<w:glossaryDocument xmlns:w="${W}"><w:docParts>${entries.join("")}</w:docParts></w:glossaryDocument>`,
      ),
  );
}

const fragment = (xml: string) =>
  Array.from(
    parseWordXml(`<w:root xmlns:w="${W}">${xml}</w:root>`).documentElement
      .children,
  );

/** What Word writes back after importing `xml`: each entry renamed, its controls re-pointed, the
 * entries in their controls' order, and one empty entry-named style per entry. */
function asWordImports(
  xml: string,
  names: [string, string],
  leftovers = "",
  edit: (doc: Document) => void = () => {},
): string {
  const doc = parseWordXml(xml);
  const glossary = Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
    (p) => p.getAttributeNS(PKG, "name") === "/word/glossary/document.xml",
  )!;
  glossary
    .getElementsByTagNameNS(W, "docParts")[0]
    .replaceChildren(
      ...fragment(
        entry(names[0], "Enter the date here.", names[0]) +
          entry(names[1], "Click or tap here to enter text.", names[1]),
      ),
    );
  const links = Array.from(doc.getElementsByTagNameNS(W, "docPart")).filter(
    (e) => e.parentElement?.localName === "placeholder",
  );
  links[0].setAttributeNS(W, "w:val", names[0]);
  links[1].setAttributeNS(W, "w:val", names[1]);
  const styles = Array.from(doc.getElementsByTagNameNS(PKG, "part"))
    .find((p) => p.getAttributeNS(PKG, "name") === "/word/glossary/styles.xml")!
    .getElementsByTagNameNS(W, "styles")[0];
  styles.replaceChildren(
    ...fragment(
      `${GLOSSARY_STYLES}${leftovers}${names.map(entryStyle).join("")}`,
    ),
  );
  edit(doc);
  return new XMLSerializer().serializeToString(doc);
}

function capture(xml = form()) {
  const snapshot = captureWordAuthoringSnapshot(xml, "doc-A", "Off", true);
  snapshot.read = new Set(wordSourceReadRefs(snapshot));
  snapshot.readToken = "read-proof";
  return snapshot;
}
function plan(
  snapshot: ReturnType<typeof capture>,
  change: "restyle" | "drop-control",
): WordDocumentPlan {
  const refs = snapshot.blocks.map((b) => b.ref);
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries:
      change === "restyle"
        ? [
            {
              kind: "replace",
              source: [refs[0]],
              blocks: [
                {
                  id: "h",
                  type: "heading",
                  level: 2,
                  text: "Alpha: plain paragraph.",
                },
              ],
            },
            { kind: "keep", source: refs.slice(1) },
          ]
        : [
            { kind: "keep", source: refs.slice(0, 2) },
            { kind: "keep", source: refs.slice(3) },
          ],
    deleted:
      change === "restyle" ? [] : [{ source: [refs[2]], reason: "Not needed" }],
  };
}
const partXml = (xml: string, name: string) => {
  const p = Array.from(
    parseWordXml(xml).getElementsByTagNameNS(PKG, "part"),
  ).find((e) => e.getAttributeNS(PKG, "name") === name);
  return p ? new XMLSerializer().serializeToString(p) : "";
};

const APPLIED: [string, string] = [
  "E28BAED8315E4A0FB8B866031B1F0A57",
  "8B8B3A61919F4C2D8E7F6A5B4C3D2E1F",
];
const RESTORED: [string, string] = [
  "1A8203258796433C9D1E2F3A4B5C6D7E",
  "A72C64F957384B5C6D7E8F90A1B2C3D4",
];

describe("whole-document import of a form with placeholder text", () => {
  it("writes a new heading style into the main styles, not the glossary's listed first", () => {
    const original = form();
    const compiled = compileWordDocumentPlan(
      plan(capture(original), "restyle"),
      capture(original),
    );
    expect(partXml(compiled, "/word/styles.xml")).toContain(
      'w:styleId="Heading2"',
    );
    expect(partXml(compiled, "/word/glossary/styles.xml")).toBe(
      partXml(original, "/word/glossary/styles.xml"),
    );
  });

  it("verifies Word's renamed placeholder entries after Apply and after Revert", () => {
    const original = form();
    const snapshot = capture(original);
    const compiled = compileWordDocumentPlan(
      plan(snapshot, "restyle"),
      snapshot,
    );
    const applied = asWordImports(compiled, APPLIED);
    expect(
      wordFullDocumentDifferences(
        compiled,
        applied,
        true,
        "strict",
        false,
        original,
      ),
    ).toEqual({
      parts: [],
      locations: [],
      adjustments: [],
      housekeeping: { "placeholder-entries": 2 },
    });
    const restored = asWordImports(
      original,
      RESTORED,
      APPLIED.map(entryStyle).join(""),
    );
    expect(
      wordFullDocumentDifferences(
        original,
        restored,
        false,
        "strict",
        false,
        applied,
      ).parts,
    ).toEqual([]);
  });

  it("still sees a changed placeholder text after the import", () => {
    const original = form();
    const snapshot = capture(original);
    const compiled = compileWordDocumentPlan(
      plan(snapshot, "restyle"),
      snapshot,
    );
    const changed = asWordImports(compiled, APPLIED, "", (doc) => {
      const glossary = doc.getElementsByTagNameNS(W, "glossaryDocument")[0];
      glossary.getElementsByTagNameNS(W, "t")[0].textContent = "Enter a date.";
    });
    expect(
      wordFullDocumentDifferences(
        compiled,
        changed,
        false,
        "strict",
        false,
        original,
      ).parts,
    ).toContain("/word/glossary/document.xml");
  });

  it("refuses before writing an import that would leave a placeholder entry unused, on desktop only", () => {
    const snapshot = capture();
    const write = (change: "restyle" | "drop-control") => {
      const p = plan(snapshot, change);
      return wordWholeDocumentWrite(
        { route: "import" },
        p,
        snapshot,
        { wholeDocumentImport: "allowed" },
        compileWordDocumentPlan(p, snapshot),
      );
    };
    for (const platform of ["PC", "Mac"]) {
      vi.stubGlobal("Office", { context: { diagnostics: { platform } } });
      expect(write("restyle")).toEqual({ write: "allowed" });
      expect(write("drop-control")).toEqual({
        write: "refuse",
        reason: "placeholders-unverified",
      });
    }
    vi.stubGlobal("Office", {
      context: { diagnostics: { platform: "OfficeOnline" } },
    });
    expect(write("drop-control")).toEqual({ write: "allowed" });
  });
});
