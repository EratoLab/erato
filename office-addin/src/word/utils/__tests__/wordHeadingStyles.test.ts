import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
  W,
} from "../../../test/mocks/word/authoringFixtures";
import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordSourceReadRefs,
} from "../wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";

const standardDefaults =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style>';
const all = (parent: Element | Document, name: string) =>
  Array.from(parent.getElementsByTagNameNS(W, name));
const child = (parent: Element | undefined, name: string) =>
  Array.from(parent?.children ?? []).find(
    (node) => node.namespaceURI === W && node.localName === name,
  );
const val = (element: Element | undefined, attribute = "val") =>
  element?.getAttributeNS(W, attribute);
const serialize = (node: Node) => new XMLSerializer().serializeToString(node);

function compile(stylesXml: string, level = 2) {
  const doc = new DOMParser().parseFromString(
    packageXml(paragraph("Original document")),
    "application/xml",
  );
  const styles = all(doc, "styles")[0];
  const definitions = new DOMParser().parseFromString(
    `<w:styles xmlns:w="${W}">${stylesXml}</w:styles>`,
    "application/xml",
  );
  styles.replaceChildren(
    ...Array.from(definitions.documentElement.children).map((node) =>
      doc.importNode(node, true),
    ),
  );
  const originalStyles = new Map(
    all(styles, "style").map((style) => [
      val(style, "styleId"),
      serialize(style),
    ]),
  );
  const source = captureWordAuthoringSnapshot(
    serialize(doc),
    "heading-test",
    "Off",
    true,
  );
  expect(source.issue).toBeUndefined();
  source.read = new Set(wordSourceReadRefs(source));
  source.readToken = "read-proof";
  const plan = parseWordDocumentPlan(
    JSON.stringify({
      version: 1,
      scope: "document",
      snapshot: source.token,
      readToken: source.readToken,
      entries: [
        {
          kind: "replace",
          source: ["b1"],
          blocks: [
            {
              id: "first-heading",
              type: "heading",
              level,
              text: "First new heading",
            },
            {
              id: "second-heading",
              type: "heading",
              level,
              text: "Second new heading",
            },
          ],
        },
      ],
      deleted: [],
    }),
  );
  expect(plan).not.toBeNull();
  expect(validateWordDocumentPlan(plan!, source)).toBeNull();
  const result = compileWordDocumentPlan(plan!, source);
  const after = captureWordAuthoringSnapshot(
    result,
    "heading-test",
    "Off",
    true,
    "verify",
  );
  expect(after.issue).toBeUndefined();
  expect(verifyWordPlanOutput(plan!, source, after)).toBe(true);
  const output = new DOMParser().parseFromString(result, "application/xml");
  const outputStyles = all(output, "style");
  const find = (id: string) =>
    outputStyles.find((style) => val(style, "styleId") === id);
  const headingId = val(all(all(output, "body")[0], "pStyle")[0])!;
  return {
    output,
    outputStyles,
    originalStyles,
    find,
    headingId,
    heading: find(headingId)!,
  };
}

describe("linked heading style compilation", () => {
  it("creates one linked paragraph/character pair with matching typography, correct paragraph property order and heading activation", () => {
    const result = compile(
      '<w:latentStyles><w:lsdException w:name="heading 2" w:uiPriority="9" w:semiHidden="0"/><w:lsdException w:name="heading 3" w:uiPriority="7"/></w:latentStyles>' +
        standardDefaults,
    );
    const characterId = val(child(result.heading, "link"))!;
    const character = result.find(characterId)!;
    expect(result.headingId).toBe("Heading2");
    expect(val(result.heading, "type")).toBe("paragraph");
    expect(val(character, "type")).toBe("character");
    expect(val(character, "customStyle")).toBe("1");
    expect(val(child(character, "link"))).toBe(result.headingId);
    expect(val(child(result.heading, "basedOn"))).toBe("Normal");
    expect(val(child(result.heading, "next"))).toBe("Normal");
    expect(val(child(character, "basedOn"))).toBe("DefaultParagraphFont");
    expect(
      Array.from(child(result.heading, "pPr")!.children).map(
        (node) => node.localName,
      ),
    ).toEqual(["keepNext", "outlineLvl"]);
    expect(val(child(child(result.heading, "pPr"), "outlineLvl"))).toBe("1");
    expect(child(child(result.heading, "rPr"), "b")).toBeDefined();
    expect(val(child(child(result.heading, "rPr"), "sz"))).toBe("32");
    expect(serialize(child(character, "rPr")!)).toBe(
      serialize(child(result.heading, "rPr")!),
    );
    expect(
      result.outputStyles.filter(
        (style) => val(style, "styleId") === result.headingId,
      ),
    ).toHaveLength(1);
    expect(
      result.outputStyles.filter(
        (style) => val(style, "styleId") === characterId,
      ),
    ).toHaveLength(1);
    const latent = all(result.output, "lsdException");
    expect(val(latent[0], "uiPriority")).toBe("0");
    expect(val(latent[0], "semiHidden")).toBe("0");
    expect(val(latent[1], "uiPriority")).toBe("7");
  });

  it("reuses an existing named heading and preserves its complete linked styles and document typography", () => {
    const result = compile(
      standardDefaults +
        '<w:style w:type="paragraph" w:styleId="CompanySection"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="CompanySectionChar"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Cambria"/><w:color w:val="113366"/><w:sz w:val="30"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:styleId="CompanySectionChar"><w:name w:val="Company Section Text"/><w:link w:val="CompanySection"/><w:rPr><w:i/><w:color w:val="113366"/></w:rPr></w:style>',
    );
    expect(result.headingId).toBe("CompanySection");
    expect(result.outputStyles).toHaveLength(result.originalStyles.size);
    for (const [id, original] of result.originalStyles)
      expect(serialize(result.find(id!)!)).toBe(original);
    expect(result.find("Heading2")).toBeUndefined();
  });

  it("recognizes an existing heading ID without overwriting its customized name or properties", () => {
    const result = compile(
      standardDefaults +
        '<w:style w:type="paragraph" w:styleId="heading2"><w:name w:val="Customer chapter"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:color w:val="AABBCC"/></w:rPr></w:style>',
    );
    expect(result.headingId).toBe("heading2");
    expect(serialize(result.heading)).toBe(
      result.originalStyles.get("heading2"),
    );
    expect(result.outputStyles).toHaveLength(result.originalStyles.size);
  });

  it("allocates a separate character ID without modifying an existing collision or its references", () => {
    const result = compile(
      standardDefaults +
        '<w:style w:type="character" w:styleId="Heading2Char"><w:name w:val="Existing accent"/><w:rPr><w:i/></w:rPr></w:style>' +
        '<w:style w:type="character" w:styleId="Heading2Char_2"><w:name w:val="Another existing accent"/><w:basedOn w:val="Heading2Char"/></w:style>',
    );
    const linkedId = val(child(result.heading, "link"))!;
    expect(linkedId).not.toBe("Heading2Char");
    expect(linkedId).not.toBe("Heading2Char_2");
    expect(val(child(result.find(linkedId), "link"))).toBe(result.headingId);
    for (const id of ["Heading2Char", "Heading2Char_2"])
      expect(serialize(result.find(id)!)).toBe(result.originalStyles.get(id));
    const ids = result.outputStyles.map((style) => val(style, "styleId"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("avoids paragraph style-ID collisions with character and table styles", () => {
    const result = compile(
      standardDefaults +
        '<w:style w:type="character" w:styleId="Heading2"><w:name w:val="Existing inline accent"/><w:rPr><w:color w:val="CC0000"/></w:rPr></w:style>' +
        '<w:style w:type="table" w:styleId="Heading2_2"><w:name w:val="Existing table"/></w:style>',
    );
    expect(result.headingId).not.toBe("Heading2");
    expect(result.headingId).not.toBe("Heading2_2");
    expect(val(result.heading, "type")).toBe("paragraph");
    const linked = result.find(val(child(result.heading, "link"))!)!;
    expect(val(linked, "type")).toBe("character");
    expect(val(child(linked, "link"))).toBe(result.headingId);
    for (const id of ["Heading2", "Heading2_2"])
      expect(serialize(result.find(id)!)).toBe(result.originalStyles.get(id));
    const ids = result.outputStyles.map((style) =>
      val(style, "styleId")?.toLowerCase(),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("inherits from the document's declared default styles when their IDs are customized", () => {
    const result = compile(
      '<w:style w:type="paragraph" w:default="1" w:styleId="BodyBase"><w:name w:val="Company body"/><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:default="1" w:styleId="TextBase"><w:name w:val="Company text"/></w:style>' +
        '<w:style w:type="character" w:styleId="Normal"><w:name w:val="Unrelated inline"/></w:style>' +
        '<w:style w:type="table" w:styleId="DefaultParagraphFont"><w:name w:val="Unrelated table"/></w:style>',
    );
    expect(val(child(result.heading, "basedOn"))).toBe("BodyBase");
    expect(val(child(result.heading, "next"))).toBe("BodyBase");
    const character = result.find(val(child(result.heading, "link"))!)!;
    expect(val(child(character, "basedOn"))).toBe("TextBase");
    for (const [id, original] of result.originalStyles)
      expect(serialize(result.find(id!)!)).toBe(original);
  });

  it("omits missing or wrong-type base references instead of emitting dangling style inheritance", () => {
    const result = compile(
      '<w:style w:type="table" w:styleId="Normal"><w:name w:val="Existing table"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="DefaultParagraphFont"><w:name w:val="Existing paragraph"/></w:style>',
    );
    expect(child(result.heading, "basedOn")).toBeUndefined();
    expect(child(result.heading, "next")).toBeUndefined();
    const character = result.find(val(child(result.heading, "link"))!)!;
    expect(child(character, "basedOn")).toBeUndefined();
    expect(val(child(character, "link"))).toBe(result.headingId);
  });
});
