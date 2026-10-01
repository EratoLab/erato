import { afterEach, describe, expect, it, vi } from "vitest";

import {
  escapeXml,
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import {
  editWordPackage,
  installWordOoxmlHost,
} from "../../../test/mocks/word/ooxmlHost";
import {
  captureRealisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import { renderWordDiagnosticReport } from "../wordApplyDiagnostics";
import {
  applyWordDocumentPlan,
  revertWordDocumentPlan,
} from "../wordApplyDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  wordDocumentFingerprint,
} from "../wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
} from "../wordInPlaceCapabilities";
import { resetWordInPlaceLatchForTests } from "../wordInPlaceSwitch";
import { predictWordBodyParagraphs } from "../wordLiveParagraphs";
import { rebaseWordSnapshot } from "../wordScopeGuard";

import type {
  WordDocumentApplyResult,
  WordDocumentRevertResult,
} from "../wordApplyDocumentPlan";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const capture = (ooxml: string) =>
  captureWordAuthoringSnapshot(ooxml, "doc", "Off", true);
const live = (ooxml: string) => ({
  ooxml,
  fingerprint: wordDocumentFingerprint(ooxml),
});
const body = (texts: string[]) => packageXml(texts.map(paragraph).join(""));
const rebase = (
  snapshot: WordAuthoringSnapshot,
  ooxml: string,
  touched: string[],
  definitions: { ref: string; style?: string; numId?: string }[] = [],
  edges?: { start?: boolean; end?: boolean },
) => rebaseWordSnapshot(snapshot, live(ooxml), { touched, definitions, edges });
const FORM = [
  "Name:",
  "Signature",
  "Date:",
  "Middle",
  "Name:",
  "Signature",
  "Date:",
  "Tail",
];

describe("scope-local stale check", () => {
  const texts = ["Intro", "Context", "Target", "Neighbour", "Middle", "Tail"];

  it("maps an unchanged document onto itself without comparing blocks", () => {
    const snapshot = capture(body(texts));
    const result = rebase(snapshot, body(texts), ["b3"]);
    expect(result).toMatchObject({ ok: true, outsideChanges: 0 });
    if (result.ok) expect(result.live).toBe(snapshot);
  });

  it("ignores edits, additions and removals outside the touched blocks and their neighbours", () => {
    const snapshot = capture(body(texts));
    const edited = rebase(
      snapshot,
      body(["Intro", "Context", "Target", "Neighbour", "Changed", "Tail"]),
      ["b3"],
    );
    expect(edited).toMatchObject({ ok: true, outsideChanges: 1 });
    const added = rebase(
      snapshot,
      body([
        "New",
        "Intro",
        "Context",
        "Target",
        "Neighbour",
        "Middle",
        "Tail",
      ]),
      ["b3"],
    );
    expect(added).toMatchObject({ ok: true, outsideChanges: 1 });
    if (added.ok)
      expect([...added.map]).toEqual([
        ["b2", "b3"],
        ["b3", "b4"],
        ["b4", "b5"],
      ]);
    expect(
      rebase(snapshot, body(["Context", "Target", "Neighbour", "Tail"]), [
        "b3",
      ]),
    ).toMatchObject({ ok: true, outsideChanges: 2 });
  });

  it("reports an edited target, an edited neighbour and a block added next to the target", () => {
    const snapshot = capture(body(texts));
    expect(
      rebase(
        snapshot,
        body(["Intro", "Context", "Edited", "Neighbour", "Middle", "Tail"]),
        ["b3"],
      ),
    ).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 3: changed"],
    });
    expect(
      rebase(
        snapshot,
        body(["Intro", "Context", "Target", "Edited", "Middle", "Tail"]),
        ["b3"],
      ),
    ).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 4: changed"],
    });
    expect(
      rebase(
        snapshot,
        body([
          "Intro",
          "Context",
          "Target",
          "Gap",
          "Neighbour",
          "Middle",
          "Tail",
        ]),
        ["b3"],
      ),
    ).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 4: changed"],
    });
    expect(
      rebase(
        snapshot,
        body(["Intro", "Context", "Neighbour", "Middle", "Tail"]),
        ["b3"],
      ),
    ).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 3: missing"],
    });
  });

  it("refuses a run of blocks that appears twice", () => {
    const snapshot = capture(
      body(["Head", "Same", "Same", "Same", "Same", "Tail"]),
    );
    expect(
      rebase(
        snapshot,
        body(["Head", "Same", "Same", "Same", "Same", "Tail edited"]),
        ["b3"],
      ),
    ).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 2: ambiguous"],
    });
  });

  it("refuses a run the captured document held twice once one copy was edited", () => {
    const snapshot = capture(body(FORM));
    const edited = [...FORM];
    edited[1] = "Signed meanwhile";
    expect(rebase(snapshot, body(edited), ["b2"])).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 1: ambiguous"],
    });
    edited[1] = "Signature";
    edited[7] = "Tail edited";
    expect(rebase(snapshot, body(edited), ["b2"])).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 1: ambiguous"],
    });
  });

  it("ties a write at either end of the body to that end", () => {
    const snapshot = capture(body(texts));
    const added = body(["Added first", ...texts, "Added last"]);
    expect(rebase(snapshot, added, ["b1"])).toMatchObject({
      ok: true,
      outsideChanges: 2,
    });
    expect(rebase(snapshot, added, ["b6"])).toMatchObject({
      ok: true,
      outsideChanges: 2,
    });
    expect(rebase(snapshot, added, ["b1"], [], { start: true })).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 1: changed"],
    });
    expect(rebase(snapshot, added, ["b6"], [], { end: true })).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 6: changed"],
    });
    expect(
      rebase(
        snapshot,
        body([...texts.slice(0, 4), "Edited", "Tail"]),
        ["b2"],
        [],
        { start: true },
      ),
    ).toMatchObject({ ok: true, outsideChanges: 1 });
  });

  it("refuses runs that changed order", () => {
    const snapshot = capture(body(["A", "B", "C", "D", "E", "F", "G"]));
    expect(
      rebase(snapshot, body(["E", "F", "G", "X", "A", "B", "C"]), ["b2", "b6"]),
    ).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 5: changed"],
    });
  });

  it("refuses changed styles and list instances the write applies, nsid aside", () => {
    const styled = (bold: boolean, nsid = "1A2B3C4D") =>
      packageXml(texts.map(paragraph).join("")).replace(
        "</w:styles>",
        `<w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout Text"/><w:basedOn w:val="Normal"/>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}</w:style></w:styles></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/numbering.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"><pkg:xmlData><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:nsid w:val="${nsid}"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
      );
    const snapshot = capture(styled(false));
    const tail = (ooxml: string) => ooxml.replace(">Tail<", ">Tail edited<");
    expect(
      rebase(
        snapshot,
        tail(styled(true)),
        ["b3"],
        [{ ref: "b3", style: "Callout" }],
      ),
    ).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 3: definition"],
    });
    expect(
      rebase(
        snapshot,
        tail(styled(false, "7E570001")),
        ["b3"],
        [{ ref: "b3", style: "Callout", numId: "1" }],
      ),
    ).toMatchObject({ ok: true, outsideChanges: 1 });
    expect(
      rebase(
        snapshot,
        tail(styled(false)).replace(
          '<w:numFmt w:val="decimal"/>',
          '<w:numFmt w:val="bullet"/>',
        ),
        ["b3"],
        [{ ref: "b3", numId: "1" }],
      ),
    ).toEqual({
      ok: false,
      locations: ["/word/document.xml body block 3: definition"],
    });
  });

  it("follows touched blocks of a long document past changes elsewhere", () => {
    const many = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}`);
    const snapshot = capture(body(many));
    const edited = [...many];
    edited[10] = "Changed far away";
    edited.splice(300, 0, "Added far away");
    for (const [ref, mapped] of [
      ["b200", "b200"],
      ["b350", "b351"],
    ]) {
      const result = rebase(snapshot, body(edited), [ref]);
      expect(result).toMatchObject({ ok: true, outsideChanges: 2 });
      expect(result.ok && result.map.get(ref)).toBe(mapped);
    }
  });
});

const report = (
  result: WordDocumentApplyResult | WordDocumentRevertResult,
  operation = "apply",
) => renderWordDiagnosticReport(operation, result.status, result.diagnostic);
const paragraphIndex = (ooxml: string, prefix: string) =>
  predictWordBodyParagraphs(ooxml).findIndex((p) => p.text?.startsWith(prefix));
const texts = (ooxml: string) =>
  captureWordAuthoringSnapshot(
    ooxml,
    "doc-A",
    "Off",
    true,
    "verify",
  ).blocks.map((b) => b.text);
const apply = (plan: WordDocumentPlan, snapshot: WordAuthoringSnapshot) =>
  applyWordDocumentPlan(JSON.stringify(plan), snapshot, "message-A");
const QUESTIONS = "Open questions follow.";
const CLOSING = "Closing paragraph.";

describe("in-place writes around later edits", { timeout: 30_000 }, () => {
  afterEach(() => {
    resetWordInPlaceLatchForTests();
    setWordInPlaceCapabilitiesForTests(undefined);
    delete window.WORD_FORCE_IMPORT_APPLY;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("writes in place around an edit elsewhere, keeps it, and keeps it on Restore", async () => {
    const host = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const snapshot = await captureRealisticSnapshot();
    host.editParagraph(
      paragraphIndex(host.ooxml(), CLOSING),
      "The user kept working here.",
    );
    const applied = await apply(
      statusRewritePlan(snapshot, "Status: rewritten."),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome).toEqual({
      route: "in-place",
      tier: "block",
      adjustments: [],
      ops: 1,
      outsideChanges: 1,
    });
    expect(host.insert).not.toHaveBeenCalled();
    expect(texts(host.ooxml())).toEqual(
      snapshot.blocks.map((b) =>
        b.text.startsWith("Status")
          ? "Status: rewritten."
          : b.text === CLOSING
            ? "The user kept working here."
            : b.text,
      ),
    );
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(texts(host.ooxml())).toEqual(
      snapshot.blocks.map((b) =>
        b.text === CLOSING ? "The user kept working here." : b.text,
      ),
    );
  });

  it("inserts next to the right paragraph after paragraphs were added above it", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const host = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const snapshot = await captureRealisticSnapshot();
    host.userEdit((xml) =>
      editWordPackage(xml, (doc) => {
        const bodyElement = doc.getElementsByTagNameNS(W, "body")[0];
        const added = new DOMParser().parseFromString(
          `<w:p xmlns:w="${W}"><w:r><w:t>${escapeXml("Added above.")}</w:t></w:r></w:p>`,
          "application/xml",
        ).documentElement;
        bodyElement.insertBefore(
          doc.importNode(added, true),
          bodyElement.firstChild,
        );
      }),
    );
    const refs = snapshot.blocks.map((b) => b.ref);
    const questions = snapshot.blocks.findIndex((b) => b.text === QUESTIONS);
    const plan: WordDocumentPlan = {
      version: 1,
      snapshot: snapshot.token,
      readToken: "read-proof",
      scope: "document",
      deleted: [],
      entries: [
        { kind: "keep", source: refs.slice(0, questions + 1) },
        {
          kind: "insert",
          blocks: [{ id: "n", type: "paragraph", text: "Inserted after." }],
        },
        { kind: "keep", source: refs.slice(questions + 1) },
      ],
    };
    const applied = await apply(plan, snapshot);
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome).toMatchObject({
      route: "in-place",
      outsideChanges: 1,
    });
    const after = texts(host.ooxml());
    expect(after[0]).toBe("Added above.");
    expect(after[after.indexOf(QUESTIONS) + 1]).toBe("Inserted after.");
  });

  it.each([
    ["the target", "Status:", "Status: typed meanwhile.", 2],
    ["a neighbour", "Confirm the regions.", "Confirmed meanwhile.", 3],
  ])(
    "stops before writing when someone edited %s",
    async (_name, prefix, text, block) => {
      const host = installWordOoxmlHost(realisticWordPackageXml(), {
        profile: "word-pc-16.0.20326",
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const snapshot = await captureRealisticSnapshot();
      host.editParagraph(paragraphIndex(host.ooxml(), prefix), text);
      const save = vi.fn();
      const result = await applyWordDocumentPlan(
        JSON.stringify(statusRewritePlan(snapshot, "Status: rewritten.")),
        snapshot,
        "message-A",
        save,
      );
      expect(result.status).toBe("stale");
      expect(result.diagnostic).toMatchObject({
        stage: "preflight",
        reason: "source-changed",
        details: {
          route: "in-place",
          locations: [`/word/document.xml body block ${block}: changed`],
        },
      });
      expect(report(result)).toContain(
        `Where: /word/document.xml body block ${block}: changed`,
      );
      expect(save).not.toHaveBeenCalled();
      expect(host.events.filter((e) => e.startsWith("mutation:"))).toEqual([]);
      expect(host.insert).not.toHaveBeenCalled();
    },
  );

  it("stops before writing when the touched run of paragraphs repeats elsewhere", async () => {
    const host = installWordOoxmlHost(
      body(["Head", "Same", "Same", "Same", "Same", "Tail"]),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    host.editParagraph(5, "Tail edited");
    const refs = snapshot.blocks.map((b) => b.ref);
    const result = await apply(
      {
        version: 1,
        snapshot: snapshot.token,
        readToken: "read-proof",
        scope: "document",
        deleted: [],
        entries: [
          { kind: "keep", source: refs.slice(0, 2) },
          {
            kind: "replace",
            source: ["b3"],
            blocks: [{ id: "c", type: "paragraph", text: "Changed" }],
          },
          { kind: "keep", source: refs.slice(3) },
        ],
      },
      snapshot,
    );
    expect(result.status).toBe("stale");
    expect(result.diagnostic?.details?.locations).toEqual([
      "/word/document.xml body block 2: ambiguous",
    ]);
    expect(host.events.filter((e) => e.startsWith("mutation:"))).toEqual([]);
  });

  it("stops before writing to a run the captured document held twice when its copy is left", async () => {
    const host = installWordOoxmlHost(body(FORM));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    host.editParagraph(1, "Signed meanwhile");
    const refs = snapshot.blocks.map((b) => b.ref);
    const result = await apply(
      {
        version: 1,
        snapshot: snapshot.token,
        readToken: "read-proof",
        scope: "document",
        deleted: [],
        entries: [
          { kind: "keep", source: ["b1"] },
          {
            kind: "replace",
            source: ["b2"],
            blocks: [{ id: "s", type: "paragraph", text: "Signed by AI" }],
          },
          { kind: "keep", source: refs.slice(2) },
        ],
      },
      snapshot,
    );
    expect(result.status).toBe("stale");
    expect(result.diagnostic?.details).toMatchObject({
      route: "in-place",
      locations: ["/word/document.xml body block 1: ambiguous"],
    });
    expect(host.events.filter((e) => e.startsWith("mutation:"))).toEqual([]);
    expect(texts(host.ooxml())).toEqual(
      FORM.map((text, i) => (i === 1 ? "Signed meanwhile" : text)),
    );
  });

  describe("an insert at the start of the body", () => {
    const addAtStart = (xml: string) =>
      editWordPackage(xml, (doc) => {
        const bodyElement = doc.getElementsByTagNameNS(W, "body")[0];
        const added = new DOMParser().parseFromString(
          `<w:p xmlns:w="${W}"><w:r><w:t>User added at start.</w:t></w:r></w:p>`,
          "application/xml",
        ).documentElement;
        bodyElement.insertBefore(
          doc.importNode(added, true),
          bodyElement.firstChild,
        );
      });
    const insertFirst = (
      snapshot: WordAuthoringSnapshot,
    ): WordDocumentPlan => ({
      version: 1,
      snapshot: snapshot.token,
      readToken: "read-proof",
      scope: "document",
      deleted: [],
      entries: [
        {
          kind: "insert",
          blocks: [{ id: "n", type: "paragraph", text: "Very first." }],
        },
        { kind: "keep", source: snapshot.blocks.map((b) => b.ref) },
      ],
    });

    it("stops before writing when a paragraph was added there", async () => {
      setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
      const host = installWordOoxmlHost(realisticWordPackageXml(), {
        profile: "word-pc-16.0.20326",
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const snapshot = await captureRealisticSnapshot();
      host.userEdit(addAtStart);
      const result = await apply(insertFirst(snapshot), snapshot);
      expect(result.status).toBe("stale");
      expect(result.diagnostic?.details).toMatchObject({
        route: "in-place",
        locations: ["/word/document.xml body block 1: changed"],
      });
      expect(host.events.filter((e) => e.startsWith("mutation:"))).toEqual([]);
    });

    it("writes in place around an edit further down", async () => {
      setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
      const host = installWordOoxmlHost(realisticWordPackageXml(), {
        profile: "word-pc-16.0.20326",
      });
      const snapshot = await captureRealisticSnapshot();
      host.editParagraph(
        paragraphIndex(host.ooxml(), CLOSING),
        "The user kept working here.",
      );
      const applied = await apply(insertFirst(snapshot), snapshot);
      expect(applied.status, report(applied)).toBe("applied");
      expect(applied.outcome).toMatchObject({
        route: "in-place",
        outsideChanges: 1,
      });
      expect(texts(host.ooxml()).slice(0, 2)).toEqual([
        "Very first.",
        snapshot.blocks[0].text,
      ]);
    });
  });

  it("stops before writing when a block was added next to the target", async () => {
    const host = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    host.userEdit((xml) =>
      xml.replace(
        '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>',
        `<w:p><w:r><w:t>Squeezed in.</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="ListParagraph"/>`,
      ),
    );
    const result = await apply(
      statusRewritePlan(snapshot, "Status: rewritten."),
      snapshot,
    );
    expect(result.status).toBe("stale");
    expect(result.diagnostic?.details?.locations).toEqual([
      "/word/document.xml body block 3: changed",
    ]);
  });

  it("stops before writing when a style the insert applies was changed", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const xml = editWordPackage(realisticWordPackageXml(), (doc) => {
      const callout = new DOMParser().parseFromString(
        `<w:style xmlns:w="${W}" w:type="paragraph" w:customStyle="1" w:styleId="Callout"><w:name w:val="Callout Text"/><w:basedOn w:val="Normal"/></w:style>`,
        "application/xml",
      ).documentElement;
      doc
        .getElementsByTagNameNS(W, "styles")[0]
        .append(doc.importNode(callout, true));
    });
    const host = installWordOoxmlHost(xml, { profile: "word-pc-16.0.20326" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    host.userEdit((ooxml) =>
      ooxml.replace(
        '<w:name w:val="Callout Text"/><w:basedOn w:val="Normal"/>',
        '<w:name w:val="Callout Text"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr>',
      ),
    );
    const refs = snapshot.blocks.map((b) => b.ref);
    const plan: WordDocumentPlan = {
      version: 1,
      snapshot: snapshot.token,
      readToken: "read-proof",
      scope: "document",
      deleted: [],
      entries: [
        { kind: "keep", source: refs.slice(0, 2) },
        {
          kind: "insert",
          blocks: [
            {
              id: "c",
              type: "paragraph",
              text: "A callout.",
              styleRef: "Callout",
            },
          ],
        },
        { kind: "keep", source: refs.slice(2) },
      ],
    };
    const result = await apply(plan, snapshot);
    expect(result.status).toBe("stale");
    expect(result.diagnostic?.details?.locations).toEqual([
      "/word/document.xml body block 2: definition",
    ]);
    expect(host.events.filter((e) => e.startsWith("mutation:"))).toEqual([]);
  });

  it("stops before rewriting a list item whose list definition changed", async () => {
    const host = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    host.userEdit((ooxml) =>
      ooxml.replace(
        '<w:numFmt w:val="decimal"/>',
        '<w:numFmt w:val="upperRoman"/>',
      ),
    );
    const schedule = snapshot.blocks.findIndex((b) =>
      b.text.startsWith("Schedule"),
    );
    const refs = snapshot.blocks.map((b) => b.ref);
    const result = await apply(
      {
        version: 1,
        snapshot: snapshot.token,
        readToken: "read-proof",
        scope: "document",
        deleted: [],
        entries: [
          { kind: "keep", source: refs.slice(0, schedule) },
          {
            kind: "replace",
            source: [refs[schedule]],
            blocks: [
              {
                id: "s",
                type: "list-item",
                text: "Schedule the pilot for October.",
                list: "existing-1",
                level: 0,
                ordered: true,
                styleRef: "ListParagraph",
              },
            ],
          },
          { kind: "keep", source: refs.slice(schedule + 1) },
        ],
      },
      snapshot,
    );
    expect(result.status).toBe("stale");
    expect(result.diagnostic?.details?.locations).toEqual([
      `/word/document.xml body block ${schedule + 1}: definition`,
    ]);
  });

  it("keeps the strict whole-document check on the import route", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    const host = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    host.editParagraph(
      paragraphIndex(host.ooxml(), CLOSING),
      "The user kept working here.",
    );
    const result = await apply(
      statusRewritePlan(snapshot, "Status: rewritten."),
      snapshot,
    );
    expect(result.status).toBe("stale");
    expect(result.diagnostic).toMatchObject({
      stage: "preflight",
      reason: "source-changed",
      details: { route: "import", routeReason: "disabled" },
    });
    expect(host.insert).not.toHaveBeenCalled();
  });
});
