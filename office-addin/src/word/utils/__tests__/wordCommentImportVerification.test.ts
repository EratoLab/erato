import { wordSourceReadRefs } from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import { packageXml } from "../../../test/mocks/word/authoringFixtures";
import {
  CHAPTER_COMMENTS,
  chapterCommentsBody,
  commentedParagraph,
  withComments,
} from "../../../test/mocks/word/commentFixtures";
import { parseWordXml } from "../wordDocumentPackageCodec";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import { wordFullDocumentDifferences } from "../wordFullDocumentComparison";

import type { WordDocumentPlan } from "@erato/frontend/word-review";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const TRACKED = `<w:p><w:del w:id="40" w:author="Other Author" w:date="2026-09-08T12:00:00Z"><w:r><w:delText xml:space="preserve">removed </w:delText></w:r></w:del><w:r><w:t>Tracked after.</w:t></w:r></w:p>`;

/** Chapter 3 also holds Sam's only comment, and a tracked deletion follows the chapters. */
function compiled() {
  const body =
    chapterCommentsBody().replace(
      '<w:p><w:r><w:t xml:space="preserve">Chapter three closes.</w:t></w:r></w:p>',
      commentedParagraph("Chapter three ", "closes", ".", ["6"]),
    ) + TRACKED;
  const snapshot = captureWordAuthoringSnapshot(
    withComments(packageXml(body), [
      ...CHAPTER_COMMENTS,
      {
        id: "6",
        author: "Sam Ortiz",
        date: "2026-09-12T08:00:00Z",
        text: "Cut this?",
        paraId: "1A000007",
        durableId: "6D5C0007",
      },
    ]),
    "doc-A",
    "Off",
    true,
  );
  snapshot.read = new Set(wordSourceReadRefs(snapshot));
  snapshot.readToken = "read-proof";
  const refs = snapshot.blocks.map((b) => b.ref);
  const plan: WordDocumentPlan = {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries: [
      { kind: "keep", source: refs.slice(0, 5) },
      {
        kind: "replace",
        source: refs.slice(5, 9),
        blocks: [{ id: "s", type: "paragraph", text: "Chapter three." }],
      },
      { kind: "keep", source: refs.slice(9) },
    ],
    deleted: [],
  };
  return compileWordDocumentPlan(plan, snapshot);
}

/** What Word for Windows wrote back after importing `xml` (ERMAIN-950 gate C3, C5). */
function asWordImports(
  xml: string,
  edit: (doc: Document) => void = () => {},
): string {
  const doc = parseWordXml(xml);
  doc.getElementsByTagNameNS(W, "del")[0].setAttributeNS(W, "w:id", "33");
  const people = doc.getElementsByTagNameNS(W15, "people")[0];
  const persons = Array.from(people.children);
  people.replaceChildren(
    ...persons
      .filter((p) => p.getAttributeNS(W15, "author") !== "Sam Ortiz")
      .reverse(),
  );
  edit(doc);
  return new XMLSerializer().serializeToString(doc);
}

describe("verifying an import that deleted comment threads", () => {
  it("takes Word's renumbered revisions and rebuilt people list for its own", () => {
    const expected = compiled();
    expect(
      parseWordXml(expected).getElementsByTagNameNS(W15, "person"),
    ).toHaveLength(4);
    expect(
      wordFullDocumentDifferences(expected, asWordImports(expected), true),
    ).toEqual({
      parts: [],
      locations: [],
      adjustments: [],
      housekeeping: { "revision-id": 1, "people-list": 1 },
    });
  });

  it("still sees a revision by someone else, and a changed entry for an author with comments", () => {
    const expected = compiled();
    expect(
      wordFullDocumentDifferences(
        expected,
        asWordImports(expected, (doc) =>
          doc
            .getElementsByTagNameNS(W, "del")[0]
            .setAttributeNS(W, "w:author", "Someone Else"),
        ),
      ).parts,
    ).toContain("/word/document.xml");
    expect(
      wordFullDocumentDifferences(
        expected,
        asWordImports(expected, (doc) =>
          doc
            .getElementsByTagNameNS(W15, "presenceInfo")[0]
            .setAttributeNS(W15, "w15:providerId", "AD"),
        ),
      ).parts,
    ).toContain("/word/people.xml");
  });
});
