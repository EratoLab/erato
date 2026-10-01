import { describe, expect, it } from "vitest";

import { packageXml, W } from "../../../test/mocks/word/authoringFixtures";
import { wordDocumentFingerprint } from "../wordDocumentXml";
import {
  acceptWordRevisions,
  acceptedWordView,
  rejectWordRevisions,
  rejectedWordView,
  wordRevisionsOutside,
} from "../wordRevisionViews";

const REVISION = 'w:author="Reviewer" w:date="2026-10-01T00:00:00Z"';
const run = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const deleted = (text: string, id: number, props = "") =>
  `<w:del w:id="${id}" ${REVISION}><w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const inserted = (text: string, id: number, props = "") =>
  `<w:ins w:id="${id}" ${REVISION}>${run(text, props)}</w:ins>`;
const p = (content: string, pPr = "") =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
const mark = (kind: "ins" | "del", id: number) =>
  `<w:rPr><w:${kind} w:id="${id}" ${REVISION}/></w:rPr>`;

/** The same document before the revisions, with the revisions, and once they are accepted. */
function fixture() {
  const original = packageXml(
    [
      p(run("The quick brown fox.")),
      p(run("A paragraph that goes away.")),
      p(run("Bold later.")),
      p(run("Restyled later.")),
      p(run("Kept as written.")),
      p(run("Tail.")),
    ].join(""),
  );
  const tracked = packageXml(
    [
      p(
        run("The ") +
          deleted("quick ", 1) +
          inserted("slow ", 2) +
          run("brown fox.") +
          inserted(" Indeed.", 3, "<w:i/>"),
      ),
      p(deleted("A paragraph that goes away.", 4), mark("del", 5)),
      p(inserted("A new paragraph.", 6), mark("ins", 7)),
      p(
        `<w:r><w:rPr><w:b/><w:rPrChange w:id="8" ${REVISION}><w:rPr/></w:rPrChange></w:rPr><w:t xml:space="preserve">Bold later.</w:t></w:r>`,
      ),
      p(
        run("Restyled later."),
        `<w:pStyle w:val="Heading1"/><w:pPrChange w:id="9" ${REVISION}><w:pPr/></w:pPrChange>`,
      ),
      p(run("Kept as written.")),
      p(run("Tail.")),
    ].join(""),
  );
  const accepted = packageXml(
    [
      p(run("The slow brown fox.") + run(" Indeed.", "<w:i/>")),
      p(run("A new paragraph.")),
      p(run("Bold later.", "<w:b/>")),
      p(run("Restyled later."), '<w:pStyle w:val="Heading1"/>'),
      p(run("Kept as written.")),
      p(run("Tail.")),
    ].join(""),
  );
  return { original, tracked, accepted };
}

const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);
const paragraphs = (doc: Document) =>
  Array.from(doc.getElementsByTagNameNS(W, "p"));

describe("Word revision views", () => {
  it("accepts inserted and deleted runs, paragraph marks and property changes", () => {
    const { tracked, accepted } = fixture();
    expect(wordDocumentFingerprint(acceptedWordView(tracked))).toBe(
      wordDocumentFingerprint(accepted),
    );
  });

  it("rejects them back to the original document", () => {
    const { tracked, original } = fixture();
    expect(wordDocumentFingerprint(rejectedWordView(tracked))).toBe(
      wordDocumentFingerprint(original),
    );
  });

  it("leaves revisions outside the scope as they are", () => {
    const { tracked } = fixture();
    const doc = parse(tracked);
    const [first, , , bold] = paragraphs(doc);
    const scope = new Set([first]);
    expect(wordRevisionsOutside(doc, scope)).toBe(6);
    rejectWordRevisions(doc, scope);
    const after = paragraphs(doc);
    expect(after[0].textContent).toBe("The quick brown fox.");
    expect(after).toContain(bold);
    expect(wordRevisionsOutside(doc, new Set())).toBe(6);
    acceptWordRevisions(doc, new Set([after[1]]));
    // The deleted paragraph joined the inserted one after it, which keeps its own mark revision.
    expect(paragraphs(doc).map((e) => e.textContent)).toEqual([
      "The quick brown fox.",
      "A new paragraph.",
      "Bold later.",
      "Restyled later.",
      "Kept as written.",
      "Tail.",
    ]);
    expect(serialize(doc)).toContain('w:id="7"');
  });

  it("keeps a deleted mark that ends the body", () => {
    const xml = packageXml(p(run("Only."), mark("del", 1)));
    expect(wordDocumentFingerprint(acceptedWordView(xml))).toBe(
      wordDocumentFingerprint(packageXml(p(run("Only.")))),
    );
  });

  it("restores old run and paragraph properties next to revision markers", () => {
    const xml = packageXml(
      p(
        `<w:r><w:rPr><w:i/><w:rPrChange w:id="1" ${REVISION}><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>Text</w:t></w:r>`,
        `<w:jc w:val="center"/><w:rPr><w:del w:id="2" ${REVISION}/><w:b/></w:rPr><w:pPrChange w:id="3" ${REVISION}><w:pPr><w:jc w:val="right"/></w:pPr></w:pPrChange>`,
      ) + p(run("Next.")),
    );
    const rejected = serialize(parse(rejectedWordView(xml)));
    expect(rejected).not.toContain("w:del");
    expect(rejected).toContain(
      '<w:pPr><w:jc w:val="right"/><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Text</w:t></w:r>',
    );
    const accepted = parse(acceptedWordView(xml));
    expect(serialize(accepted)).not.toContain("Change");
    expect(paragraphs(accepted).map((e) => e.textContent)).toEqual([
      "TextNext.",
    ]);
    expect(serialize(accepted)).toContain("<w:i/>");
  });
});
