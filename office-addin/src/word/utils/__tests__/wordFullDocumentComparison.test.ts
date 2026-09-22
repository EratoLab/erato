import { describe, expect, it } from "vitest";

import expectedRich from "../../../test/fixtures/word-rich-native/all-content-expected.xml?raw";
import observedRich from "../../../test/fixtures/word-rich-native/all-content-observed.xml?raw";
import expectedClear from "../../../test/fixtures/word-rich-native/clear-expected.xml?raw";
import observedClear from "../../../test/fixtures/word-rich-native/clear-observed.xml?raw";
import expectedFormatting from "../../../test/fixtures/word-rich-native/formatting-expected.xml?raw";
import observedFormatting from "../../../test/fixtures/word-rich-native/formatting-observed.xml?raw";
import expectedFresh from "../../../test/fixtures/word-rich-native/fresh-expected.xml?raw";
import observedFresh from "../../../test/fixtures/word-rich-native/fresh-observed.xml?raw";
import expectedFreshRestore from "../../../test/fixtures/word-rich-native/fresh-restore-expected.xml?raw";
import observedFreshRestore from "../../../test/fixtures/word-rich-native/fresh-restore-observed.xml?raw";
import expectedNativeEdit from "../../../test/fixtures/word-rich-native/native-edit-expected.xml?raw";
import observedNativeEdit from "../../../test/fixtures/word-rich-native/native-edit-observed.xml?raw";
import expectedReusedNativeEdit from "../../../test/fixtures/word-rich-native/native-edit-reused-expected.xml?raw";
import observedReusedNativeEdit from "../../../test/fixtures/word-rich-native/native-edit-reused-observed.xml?raw";
import expectedReusedRestore from "../../../test/fixtures/word-rich-native/native-edit-reused-restore-expected.xml?raw";
import observedReusedRestore from "../../../test/fixtures/word-rich-native/native-edit-reused-restore-observed.xml?raw";
import expectedStories from "../../../test/fixtures/word-rich-native/stories-expected.xml?raw";
import observedStories from "../../../test/fixtures/word-rich-native/stories-observed.xml?raw";
import {
  sameWordFullDocumentContent,
  wordFullDocumentComparisonIssue,
} from "../wordFullDocumentComparison";
import { createWordXmlComparison } from "../wordXmlComparison";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const all = (d: Document | Element, ns: string, name: string) =>
  Array.from(d.getElementsByTagNameNS(ns, name));
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");
const change = (xml: string, edit: (doc: Document) => void) => {
  const doc = parse(xml);
  edit(doc);
  return new XMLSerializer().serializeToString(doc);
};

describe("native full-document comparison", () => {
  it("resolves native story/header/reference normalization without weakening package identity", () => {
    expect(
      wordFullDocumentComparisonIssue(expectedStories, observedStories),
    ).toBeUndefined();
    expect(
      createWordXmlComparison(parse(expectedStories)).fingerprint(),
    ).not.toBe(createWordXmlComparison(parse(observedStories)).fingerprint());
  });
  it("compares the recorded all-content rewrite with Word's own representations", () => {
    expect(
      wordFullDocumentComparisonIssue(expectedRich, observedRich),
    ).toBeUndefined();
  });
  it("rejects malformed packages", () => {
    expect(sameWordFullDocumentContent(expectedStories, "<bad>")).toBe(false);
  });
  it("verifies full clear after removing Word's import placeholder", () => {
    expect(
      wordFullDocumentComparisonIssue(expectedClear, observedClear),
    ).toBeUndefined();
  });
  it("preserves direct formatting while Word registers the requested font", () => {
    expect(
      wordFullDocumentComparisonIssue(expectedFormatting, observedFormatting),
    ).toBeUndefined();
  });
  it("compares typed changes to retained images, fields, bookmarks and controls", () => {
    expect(
      wordFullDocumentComparisonIssue(expectedNativeEdit, observedNativeEdit),
    ).toBeUndefined();
  });
  it("compares all new content families initialized from a clean source", () => {
    expect(
      wordFullDocumentComparisonIssue(expectedFresh, observedFresh),
    ).toBeUndefined();
  });
  it("compares existing-object editing after repeated native document imports", () => {
    expect(
      wordFullDocumentComparisonIssue(
        expectedReusedNativeEdit,
        observedReusedNativeEdit,
      ),
    ).toBeUndefined();
  });
  it("verifies restoration after the same unused linked-style catalog repair", () => {
    expect(
      wordFullDocumentComparisonIssue(
        expectedReusedRestore,
        observedReusedRestore,
      ),
    ).toBeUndefined();
  });
  it.each(["direct", "derived"] as const)(
    "preserves an applied or derived linked character style (%s)",
    (reference) => {
      const bind = (d: Document) => {
        if (reference === "direct") {
          const run = all(all(d, W, "body")[0], W, "r")[0];
          let props = Array.from(run.children).find(
            (e) => e.namespaceURI === W && e.localName === "rPr",
          );
          if (!props) {
            props = d.createElementNS(W, "w:rPr");
            run.prepend(props);
          }
          const style = d.createElementNS(W, "w:rStyle");
          style.setAttributeNS(W, "w:val", "Heading9Char");
          props.prepend(style);
        } else {
          const style = d.createElementNS(W, "w:style"),
            base = d.createElementNS(W, "w:basedOn");
          style.setAttributeNS(W, "w:styleId", "DerivedChar");
          style.setAttributeNS(W, "w:type", "character");
          base.setAttributeNS(W, "w:val", "Heading9Char");
          style.append(base);
          all(d, W, "styles")[0].append(style);
        }
      };
      expect(
        sameWordFullDocumentContent(
          change(expectedReusedNativeEdit, bind),
          change(observedReusedNativeEdit, bind),
        ),
      ).toBe(false);
    },
  );
  it.each([
    [
      "changed paragraph partner",
      (d: Document) => {
        const partner = all(d, W, "style").find(
          (e) => e.getAttributeNS(W, "styleId") === "Heading9",
        )!;
        all(partner, W, "sz")[0].setAttributeNS(W, "w:val", "44");
      },
    ],
    [
      "removed original character property",
      (d: Document) => {
        const style = all(d, W, "style").find(
          (e) => e.getAttributeNS(W, "styleId") === "Heading9Char",
        )!;
        all(style, W, "b")[0].remove();
      },
    ],
    [
      "changed original character property",
      (d: Document) => {
        const style = all(d, W, "style").find(
          (e) => e.getAttributeNS(W, "styleId") === "Heading9Char",
        )!;
        all(style, W, "sz")[0].setAttributeNS(W, "w:val", "44");
      },
    ],
    [
      "mismatched added typography",
      (d: Document) => {
        const style = all(d, W, "style").find(
          (e) => e.getAttributeNS(W, "styleId") === "Heading9Char",
        )!;
        all(style, W, "rFonts")[0].setAttributeNS(
          W,
          "w:asciiTheme",
          "majorHAnsi",
        );
      },
    ],
    [
      "unknown new character property",
      (d: Document) => {
        const style = all(d, W, "style").find(
          (e) => e.getAttributeNS(W, "styleId") === "Heading9Char",
        )!;
        all(style, W, "rPr")[0].append(
          d.createElementNS("urn:future", "f:behavior"),
        );
      },
    ],
  ] as const)("rejects %s during linked-style normalization", (_name, edit) => {
    expect(
      sameWordFullDocumentContent(
        expectedReusedNativeEdit,
        change(observedReusedNativeEdit, edit),
      ),
    ).toBe(false);
  });
  it("restores a clean source despite native retaining newly registered, unused definitions", () => {
    expect(
      wordFullDocumentComparisonIssue(
        expectedFreshRestore,
        observedFreshRestore,
      ),
    ).toBeUndefined();
  });
  it.each([
    [
      "changed existing default style",
      (d: Document) => {
        const normal = all(d, W, "style").find(
          (e) => e.getAttributeNS(W, "styleId") === "Normal",
        )!;
        const props = d.createElementNS(W, "w:rPr"),
          size = d.createElementNS(W, "w:sz");
        size.setAttributeNS(W, "w:val", "44");
        props.append(size);
        normal.append(props);
      },
    ],
    [
      "lost existing style",
      (d: Document) => {
        all(d, W, "style")
          .find(
            (e) => e.getAttributeNS(W, "styleId") === "DefaultParagraphFont",
          )!
          .remove();
      },
    ],
    [
      "additional default style",
      (d: Document) => {
        all(d, W, "style")
          .find((e) => e.getAttributeNS(W, "styleId") === "Heading1")!
          .setAttributeNS(W, "w:default", "1");
      },
    ],
    [
      "unknown style extension",
      (d: Document) => {
        all(d, W, "style")
          .find((e) => e.getAttributeNS(W, "styleId") === "Heading1")!
          .setAttributeNS("urn:future", "f:behavior", "retain");
      },
    ],
    [
      "changed latent locking",
      (d: Document) => {
        all(d, W, "lsdException")
          .find((e) => e.getAttributeNS(W, "name") === "heading 1")!
          .setAttributeNS(W, "w:locked", "1");
      },
    ],
    [
      "new orphaned note text",
      (d: Document) => {
        const note = d.createElementNS(W, "w:footnote"),
          paragraph = d.createElementNS(W, "w:p"),
          run = d.createElementNS(W, "w:r"),
          text = d.createElementNS(W, "w:t");
        note.setAttributeNS(W, "w:id", "9");
        text.textContent = "Unexpected retained note";
        run.append(text);
        paragraph.append(run);
        note.append(paragraph);
        all(d, W, "footnotes")[0].append(note);
      },
    ],
    [
      "custom separator text",
      (d: Document) => {
        const text = d.createElementNS(W, "w:t");
        text.textContent = "Unexpected separator";
        all(all(d, W, "footnotes")[0], W, "r")[0].append(text);
      },
    ],
    [
      "unknown note part extension",
      (d: Document) => {
        all(d, W, "footnotes")[0].setAttributeNS(
          "urn:future",
          "f:behavior",
          "retain",
        );
      },
    ],
    [
      "changed note numbering settings",
      (d: Document) => {
        const start = d.createElementNS(W, "w:numStart");
        start.setAttributeNS(W, "w:val", "7");
        all(d, W, "footnotePr")[0].prepend(start);
      },
    ],
    [
      "unknown unused numbering extension",
      (d: Document) => {
        all(d, W, "num")[0].setAttributeNS(
          "urn:future",
          "f:behavior",
          "retain",
        );
      },
    ],
  ] as const)(
    "does not mistake %s for harmless restoration metadata",
    (_name, edit) => {
      expect(
        sameWordFullDocumentContent(
          expectedFreshRestore,
          change(observedFreshRestore, edit),
        ),
      ).toBe(false);
    },
  );
  it.each([
    [
      "list split/restart",
      (d: Document) => {
        all(all(d, W, "body")[0], W, "numId")
          .at(-1)!
          .setAttributeNS(W, "w:val", "2");
      },
    ],
    [
      "list start",
      (d: Document) => {
        all(
          all(d, W, "abstractNum").find(
            (e) => e.getAttributeNS(W, "abstractNumId") === "1",
          )!,
          W,
          "start",
        )[0].setAttributeNS(W, "w:val", "4");
      },
    ],
    [
      "list indentation",
      (d: Document) => {
        all(
          all(d, W, "abstractNum").find(
            (e) => e.getAttributeNS(W, "abstractNumId") === "1",
          )!,
          W,
          "ind",
        )[0].setAttributeNS(W, "w:left", "1800");
      },
    ],
    [
      "existing durable list identity",
      (d: Document) => {
        all(d, W, "num")[0].setAttributeNS(CID, "w16cid:durableId", "31");
      },
    ],
    [
      "numbering after section break",
      (d: Document) => {
        all(d, W, "abstractNum")
          .find((e) => e.getAttributeNS(W, "abstractNumId") === "1")!
          .setAttributeNS(W15, "w15:restartNumberingAfterBreak", "1");
      },
    ],
  ] as const)("preserves %s on native list definitions", (_name, edit) => {
    expect(
      sameWordFullDocumentContent(observedFresh, change(observedFresh, edit)),
    ).toBe(false);
  });
  it.each([
    [
      "note association",
      (d: Document) => {
        const refs = all(d, W, "footnoteReference");
        const id = refs[0].getAttributeNS(W, "id")!;
        refs[0].setAttributeNS(W, "w:id", refs[1].getAttributeNS(W, "id")!);
        refs[1].setAttributeNS(W, "w:id", id);
      },
    ],
    [
      "comment anchor endpoint",
      (d: Document) => {
        const end = all(d, W, "commentRangeEnd")[0];
        end.parentElement!.append(end);
      },
    ],
    [
      "story text",
      (d: Document) => {
        all(all(d, W, "footnotes")[0], W, "t")[0].textContent =
          "Changed footnote";
      },
    ],
    [
      "comment author",
      (d: Document) => {
        all(d, W, "comment")[0].setAttributeNS(
          W,
          "w:author",
          "Different author",
        );
      },
    ],
    [
      "resolved state",
      (d: Document) => {
        all(d, W15, "commentEx")[1].setAttributeNS(W15, "w15:done", "1");
      },
    ],
    [
      "new comment resolved state",
      (d: Document) => {
        all(d, W15, "commentEx")[0].setAttributeNS(W15, "w15:done", "1");
      },
    ],
    [
      "existing durable identity",
      (d: Document) => {
        all(d, CID, "commentId")[1].setAttributeNS(
          CID,
          "w16cid:durableId",
          "11111111",
        );
      },
    ],
    [
      "new comment reply link",
      (d: Document) => {
        const rows = all(d, W15, "commentEx");
        rows[0].setAttributeNS(
          W15,
          "w15:paraIdParent",
          rows[1].getAttributeNS(W15, "paraId")!,
        );
      },
    ],
    [
      "header content",
      (d: Document) => {
        all(all(d, W, "hdr")[0], W, "t")[0].textContent = "Incorrect header";
      },
    ],
    [
      "header relationship type",
      (d: Document) => {
        const ref = all(d, W, "headerReference")[0].getAttributeNS(R, "id");
        all(d, REL, "Relationship")
          .find((e) => e.getAttribute("Id") === ref)!
          .setAttribute("Type", R + "/footer");
      },
    ],
    [
      "section margins",
      (d: Document) => {
        all(d, W, "pgMar")[0].setAttributeNS(W, "w:left", "720");
      },
    ],
    [
      "column layout",
      (d: Document) => {
        all(d, W, "cols")[0].setAttributeNS(W, "w:num", "3");
      },
    ],
    [
      "image bytes",
      (d: Document) => {
        const b = all(d, PKG, "binaryData")[0];
        b.textContent = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
      },
    ],
    [
      "field code",
      (d: Document) => {
        all(d, W, "instrText")[0].textContent = " DOCPROPERTY WrongProperty ";
      },
    ],
    [
      "cell width intent",
      (d: Document) => {
        all(d, W, "tcW")[0].setAttributeNS(W, "w:w", "9000");
      },
    ],
    [
      "unknown package data",
      (d: Document) => {
        const part = d.createElementNS(PKG, "pkg:part"),
          data = d.createElementNS(PKG, "pkg:xmlData");
        part.setAttributeNS(PKG, "pkg:name", "/customXml/unknown.xml");
        part.setAttributeNS(PKG, "pkg:contentType", "application/xml");
        data.append(d.createElementNS("urn:unknown-data", "payload"));
        part.append(data);
        d.documentElement.append(part);
      },
    ],
    [
      "orphan comment",
      (d: Document) => {
        const comment = all(d, W, "comment")[0].cloneNode(true) as Element;
        comment.setAttributeNS(W, "w:id", "88");
        all(d, W, "comments")[0].append(comment);
      },
    ],
  ])("rejects changed %s", (_name, mutate) => {
    expect(
      sameWordFullDocumentContent(
        expectedStories,
        change(observedStories, mutate),
      ),
    ).toBe(false);
  });
  it("does not equate clear with a whitespace placeholder or visible body content", () => {
    const withText = change(observedClear, (d) => {
      const paragraph = all(all(d, W, "body")[0], W, "p")[0];
      const run = d.createElementNS(W, "w:r"),
        text = d.createElementNS(W, "w:t");
      text.setAttributeNS(
        "http://www.w3.org/XML/1998/namespace",
        "xml:space",
        "preserve",
      );
      text.textContent = " ";
      run.append(text);
      paragraph.append(run);
    });
    expect(sameWordFullDocumentContent(expectedClear, withText)).toBe(false);
  });
  it("retains unknown comment extensions and shape appearance defaults", () => {
    const commentExtension = change(observedStories, (d) => {
      all(d, W15, "commentEx")[0].setAttributeNS(
        "urn:review-extension",
        "review:decision",
        "accepted",
      );
    });
    expect(sameWordFullDocumentContent(expectedStories, commentExtension)).toBe(
      false,
    );
    const changedShapeDefaults = change(observedFormatting, (d) => {
      all(
        d,
        "urn:schemas-microsoft-com:office:office",
        "shapedefaults",
      )[0].setAttribute("fillcolor", "red");
    });
    expect(
      sameWordFullDocumentContent(expectedFormatting, changedShapeDefaults),
    ).toBe(false);
  });
  it("does not discard an unknown attribute on Word's added annotation marker", () => {
    const changed = change(observedStories, (d) => {
      all(d, W, "annotationRef")[0].parentElement!.setAttributeNS(
        "urn:review-extension",
        "review:marker",
        "meaningful",
      );
    });
    expect(sameWordFullDocumentContent(expectedStories, changed)).toBe(false);
  });
  it("does not treat an altered comment marker size as a default", () => {
    const changed = change(observedStories, (d) => {
      const markerRun = all(d, W, "commentReference")[0].parentElement!;
      all(markerRun, W, "sz")[0].setAttributeNS(W, "w:val", "40");
    });
    expect(sameWordFullDocumentContent(expectedStories, changed)).toBe(false);
  });
  it("compares definition maps by identity without ignoring lost or changed definitions", () => {
    const reordered = change(observedStories, (d) => {
      for (const [local, entryKind] of [
        ["styles", "style"],
        ["fonts", "font"],
        ["numbering", "abstractNum"],
        ["numbering", "num"],
      ]) {
        const root = all(d, W, local)[0];
        if (!root) continue;
        const entries = Array.from(root.children)
          .filter((e) => e.localName === entryKind)
          .reverse();
        let at = 0;
        root.replaceChildren(
          ...Array.from(root.childNodes).map((node) =>
            node.nodeType === 1 && (node as Element).localName === entryKind
              ? entries[at++]
              : node,
          ),
        );
      }
    });
    expect(sameWordFullDocumentContent(expectedStories, reordered)).toBe(true);
    expect(
      sameWordFullDocumentContent(
        expectedStories,
        change(reordered, (d) => all(d, W, "style")[0].remove()),
      ),
    ).toBe(false);
    expect(
      sameWordFullDocumentContent(
        expectedStories,
        change(reordered, (d) =>
          all(d, W, "num")[0].setAttributeNS(W, "w:numId", "999"),
        ),
      ),
    ).toBe(false);
  });
});
