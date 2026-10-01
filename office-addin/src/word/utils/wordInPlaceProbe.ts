import { captureWordDocumentPackage } from "./wordDocumentPackage";
import { captureWordAuthoringSnapshot } from "./wordDocumentXml";
import { wordPackageCounts } from "./wordFullDocumentComparison";
import { queueWordInPlaceTextWrite } from "./wordInPlaceExecutor";
import { wordFirstRunMarks, wordParagraphSignature } from "./wordInPlaceState";
import { predictWordStoryParagraphs } from "./wordInPlaceStories";
import {
  predictWordBodyParagraphs,
  wordParagraphAlignmentIssue,
} from "./wordLiveParagraphs";
import { extractWordSections, extractWordStories } from "./wordStories";
import { wordWriteHost } from "./wordWriteHost";

import type { WordInPlaceProbeId } from "./wordInPlaceCapabilities";

/** Booleans, counts and fixed codes only: the report is pasted into issues and must carry no content. */
export type WordInPlaceProbeValue = boolean | number | WordInPlaceProbeCode;
type Measured = Record<string, WordInPlaceProbeValue>;
export type WordInPlaceProbeCode =
  | "not-run"
  | "error"
  | "Off"
  | "TrackAll"
  | "TrackMineOnly"
  | "unknown"
  | "PC"
  | "Mac"
  | "OfficeOnline";
export interface WordInPlaceProbeReport {
  status: "completed" | "refused";
  reason?: "no-host" | "not-empty";
  platform: WordInPlaceProbeCode;
  trackingMode: WordInPlaceProbeCode;
  probes: Partial<
    Record<WordInPlaceProbeId, Record<string, WordInPlaceProbeValue>>
  >;
}

const code = (
  value: unknown,
  allowed: readonly WordInPlaceProbeCode[],
): WordInPlaceProbeCode =>
  allowed.includes(value as WordInPlaceProbeCode)
    ? (value as WordInPlaceProbeCode)
    : "unknown";

const PLAIN = { bold: false, italic: false, underline: false };
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const paragraphOf = (ooxml: string) =>
  new DOMParser()
    .parseFromString(ooxml, "application/xml")
    .getElementsByTagNameNS(W, "p")[0];
const properties = (ooxml: string) =>
  Array.from(paragraphOf(ooxml)?.children ?? []).find(
    (e) => e.namespaceURI === W && e.localName === "pPr",
  );
const serialized = (element: Element | undefined) =>
  element ? new XMLSerializer().serializeToString(element) : "";
const numbering = (ooxml: string) => {
  const numPr = properties(ooxml)?.getElementsByTagNameNS(W, "numPr")[0];
  const value = (name: string) =>
    numPr?.getElementsByTagNameNS(W, name)[0]?.getAttributeNS(W, "val") ??
    undefined;
  return { numId: value("numId"), ilvl: value("ilvl") };
};
const pStyle = (ooxml: string) =>
  properties(ooxml)
    ?.getElementsByTagNameNS(W, "pStyle")[0]
    ?.getAttributeNS(W, "val") ?? "";
const styleCount = (ooxml: string) =>
  new DOMParser()
    .parseFromString(ooxml, "application/xml")
    .getElementsByTagNameNS(W, "style").length;
/** No style, list or alignment: what a probe's paragraphs must start from for its result to mean anything. */
const plainStart = (ooxml: string) =>
  !pStyle(ooxml) &&
  !numbering(ooxml).numId &&
  !properties(ooxml)?.getElementsByTagNameNS(W, "jc").length;
/** The paragraph with this text in a whole-document capture, whose numIds are the document's own;
 * Paragraph.getOoxml returns a package of its own that may number lists afresh. */
const inPackage = (ooxml: string, text: string) => {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  const found = Array.from(doc.getElementsByTagNameNS(W, "p")).find(
    (p) =>
      Array.from(p.getElementsByTagNameNS(W, "t"))
        .map((t) => t.textContent ?? "")
        .join("") === text,
  );
  return {
    xml: serialized(found),
    styleId: (name: string) =>
      Array.from(doc.getElementsByTagNameNS(W, "style"))
        .find(
          (style) =>
            style
              .getElementsByTagNameNS(W, "name")[0]
              ?.getAttributeNS(W, "val")
              ?.toLowerCase() === name,
        )
        ?.getAttributeNS(W, "styleId") ?? "",
  };
};

/**
 * Dev-only native validation of the in-place mechanisms (P1-P11). Runs only in an empty
 * document the developer opened for it, writes nothing but its own synthetic paragraphs, and never
 * changes the Track Changes mode: with tracking on, it measures the tracked behaviour instead.
 */
export async function runWordInPlaceProbe(
  options: { idleMs?: number } = {},
): Promise<WordInPlaceProbeReport> {
  const host = wordWriteHost();
  const platform = code(globalThis.Office?.context?.diagnostics?.platform, [
    "PC",
    "Mac",
    "OfficeOnline",
  ]);
  if (!host)
    return {
      status: "refused",
      reason: "no-host",
      platform,
      trackingMode: "unknown",
      probes: {},
    };
  return host.run(async (context) => {
    const body = context.document.body;
    const existing = body.paragraphs;
    existing.load("items/uniqueLocalId");
    body.load("text");
    context.document.load("changeTrackingMode");
    await context.sync();
    const trackingMode = code(context.document.changeTrackingMode, [
      "Off",
      "TrackAll",
      "TrackMineOnly",
    ]);
    if (body.text.trim() || existing.items.length > 1)
      return {
        status: "refused",
        reason: "not-empty",
        platform,
        trackingMode,
        probes: {},
      };
    const pristine = existing.items[0];
    const probes: WordInPlaceProbeReport["probes"] = {};
    const attempt = async (
      id: WordInPlaceProbeId,
      run: () => Promise<Measured>,
    ) => {
      try {
        probes[id] = await run();
      } catch {
        probes[id] = { result: "error" };
      }
    };
    // Inserted before the untouched paragraph of the empty document, which a new paragraph takes its
    // style and list from, instead of at the end, after whatever the previous probe left there.
    const paragraph = async (text: string) => {
      const made = pristine.insertParagraph(text, "Before");
      made.load("uniqueLocalId");
      await context.sync();
      return made;
    };
    const signatures = async (targets: Word.Paragraph[]) => {
      const reads = targets.map((target) => target.getOoxml());
      await context.sync();
      return reads.map(({ value }) => ({
        signature: wordParagraphSignature(value),
        ooxml: value,
      }));
    };
    const signature = async (target: Word.Paragraph) => {
      const ooxml = target.getOoxml();
      await context.sync();
      return {
        signature: wordParagraphSignature(ooxml.value),
        marks: wordFirstRunMarks(ooxml.value),
        ooxml: ooxml.value,
      };
    };

    await attempt("P2", async () => {
      const target = await paragraph("Probe two seed");
      const seed = target.insertText("Probe two seed", "Replace");
      seed.font.italic = true;
      await context.sync();
      const before = await signature(target);
      const id = target.uniqueLocalId;
      target.insertText("Probe two replaced", "Replace");
      const end = target.insertText(" end", "End");
      end.font.bold = true;
      target.load("uniqueLocalId");
      await context.sync();
      const after = await signature(target);
      const doc = new DOMParser().parseFromString(
        after.ooxml,
        "application/xml",
      );
      const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const runs = Array.from(doc.getElementsByTagNameNS(W, "r"));
      const has = (run: Element | undefined, name: string) =>
        !!run?.getElementsByTagNameNS(W, name).length;
      return {
        keepsId: target.uniqueLocalId === id,
        replaceKeepsFirstRunMarks: after.marks.italic && before.marks.italic,
        endInheritsPrecedingRun: has(runs.at(-1), "i"),
        boldWritesB: has(runs.at(-1), "b"),
        boldWritesBCs: has(runs.at(-1), "bCs"),
        italicWritesICs: has(runs[0], "iCs"),
        runs: runs.length,
      };
    });

    await attempt("P3", async () => {
      const target = await paragraph("Probe three idle");
      const first = await signature(target);
      await new Promise((resolve) =>
        setTimeout(resolve, options.idleMs ?? 1500),
      );
      const second = await signature(target);
      return { stableWhenIdle: first.signature === second.signature };
    });

    await attempt("P4", async () => {
      const target = await paragraph("Probe four original");
      const original = await signature(target);
      queueWordInPlaceTextWrite(
        target,
        [
          { text: "Probe four ", ...PLAIN },
          { text: "changed", ...PLAIN, bold: true, underline: true },
        ],
        original.marks,
      );
      await context.sync();
      const changed = await signature(target);
      queueWordInPlaceTextWrite(
        target,
        [{ text: "Probe four original", ...PLAIN }],
        changed.marks,
      );
      await context.sync();
      const restored = await signature(target);
      return {
        forwardChanged: changed.signature !== original.signature,
        inverseExact: restored.signature === original.signature,
      };
    });

    await attempt("P5", async () => {
      const anchor = await paragraph("Probe five anchor");
      anchor.styleBuiltIn = "Quote";
      anchor.alignment = "Centered";
      await context.sync();
      const before = await signature(anchor);
      const after = anchor.insertParagraph("", "After");
      const ahead = anchor.insertParagraph("", "Before");
      after.load("uniqueLocalId");
      await context.sync();
      const inserted = await signature(after);
      const preceding = await signature(ahead);
      const centred = (ooxml: string) =>
        !!properties(ooxml)?.getElementsByTagNameNS(W, "jc").length;
      return {
        inheritsParagraphProperties:
          serialized(properties(inserted.ooxml)) ===
          serialized(properties(before.ooxml)),
        afterInheritsStyle: pStyle(inserted.ooxml) === pStyle(before.ooxml),
        afterInheritsDirectFormat: centred(inserted.ooxml),
        beforeInheritsStyle: pStyle(preceding.ooxml) === pStyle(before.ooxml),
        beforeInheritsDirectFormat: centred(preceding.ooxml),
        insertedHasId: !!after.uniqueLocalId,
      };
    });

    await attempt("P6", async (): Promise<Measured> => {
      // Created before the list exists, so none of them can have joined it.
      const plain = await paragraph("Probe six plain");
      const styled = await paragraph("Probe six styled");
      const first = await paragraph("Probe six first");
      const start = await signatures([plain, styled, first]);
      if (!start.every(({ ooxml }) => plainStart(ooxml)))
        return { startsClean: false };
      const list = first.startNewList();
      list.load("id");
      await context.sync();
      const second = first.insertParagraph("Probe six second", "After");
      const secondList = second.listOrNullObject;
      secondList.load("id");
      second.load("isListItem");
      plain.attachToList(list.id, 0);
      // The executor's order within one batch: list membership, then the style.
      styled.attachToList(list.id, 0);
      styled.styleBuiltIn = "ListParagraph";
      await context.sync();
      const attached = (await captureWordDocumentPackage()).ooxml;
      if (second.isListItem) second.listItem.level = 1;
      plain.detachFromList();
      await context.sync();
      const detached = (await captureWordDocumentPackage()).ooxml;
      const at = (ooxml: string, text: string) => inPackage(ooxml, text).xml;
      const listNumId = numbering(at(attached, "Probe six first")).numId;
      return {
        startsClean: true,
        insertInheritsList:
          second.isListItem &&
          !secondList.isNullObject &&
          secondList.id === list.id,
        attachKeepsNumId:
          !!listNumId &&
          numbering(at(attached, "Probe six plain")).numId === listNumId,
        listIdIsNumId: String(list.id) === listNumId,
        levelWritesIlvl:
          numbering(at(attached, "Probe six second")).ilvl === "0" &&
          numbering(at(detached, "Probe six second")).ilvl === "1",
        detachRemovesNumbering: !numbering(at(detached, "Probe six plain"))
          .numId,
        detachKeepsStyle:
          pStyle(at(detached, "Probe six plain")) ===
          pStyle(at(attached, "Probe six plain")),
        attachThenStyleKeepsList:
          !!listNumId &&
          numbering(at(attached, "Probe six styled")).numId === listNumId,
        attachThenStyleSetsStyle:
          pStyle(at(attached, "Probe six styled")) ===
          inPackage(attached, "Probe six styled").styleId("list paragraph"),
      };
    });

    await attempt("P7", async (): Promise<Measured> => {
      const target = await paragraph("Probe seven");
      const original = await signature(target);
      if (!plainStart(original.ooxml)) return { startsClean: false };
      const before = await captureWordDocumentPackage();
      target.styleBuiltIn = "Heading2";
      await context.sync();
      const after = await captureWordDocumentPackage();
      const typed = captureWordAuthoringSnapshot(
        after.ooxml,
        "probe",
        "Off",
        true,
        "verify",
      ).blocks.find((b) => b.text === "Probe seven");
      target.styleBuiltIn = "Normal";
      await context.sync();
      const restored = await signature(target);
      const [a, b] = [before.ooxml, after.ooxml].map(wordPackageCounts);
      return {
        startsClean: true,
        headingTyped: typed?.type === "heading" && typed.level === 2,
        numberingUnchanged:
          a.nums === b.nums && a.abstractNums === b.abstractNums,
        stylesAdded: styleCount(after.ooxml) - styleCount(before.ooxml),
        inverseExact: restored.signature === original.signature,
      };
    });

    await attempt("P8", async (): Promise<Measured> => {
      const one = await paragraph("Probe eight one");
      const two = await paragraph("Probe eight two");
      const three = await paragraph("Probe eight three");
      const [first, removed, last] = await signatures([one, two, three]);
      if (![first, removed, last].every(({ ooxml }) => plainStart(ooxml)))
        return { startsClean: false };
      const counted = async () => {
        const all = body.paragraphs;
        all.load("items/uniqueLocalId");
        await context.sync();
        return all.items;
      };
      const count = (await counted()).length;
      two.delete();
      await context.sync();
      const afterDelete = (await counted()).length;
      const [firstAfter, lastAfter] = await signatures([one, three]);
      const made = one.insertParagraph("", "After");
      queueWordInPlaceTextWrite(
        made,
        [{ text: "Probe eight two", ...PLAIN }],
        PLAIN,
      );
      made.styleBuiltIn = "Normal";
      await context.sync();
      const recreated = await signature(made);
      // What undoing a paragraph added at the very end would face: deleting the final paragraph.
      // The style tells the final paragraph mark apart from the untouched one before it.
      const tail = body.insertParagraph("Probe eight tail", "End");
      tail.styleBuiltIn = "Quote";
      await context.sync();
      const withTail = (await counted()).length;
      const previous = await signature(pristine);
      tail.delete();
      await context.sync();
      const remaining = await counted();
      const final = remaining.at(-1)!;
      const finalAfter = await signature(final);
      return {
        startsClean: true,
        countDropsByOne: afterDelete === count - 1,
        neighboursUnchanged:
          firstAfter.signature === first.signature &&
          lastAfter.signature === last.signature,
        recreateExact: recreated.signature === removed.signature,
        finalDeleteDropsCount: remaining.length === withTail - 1,
        finalDeleteKeepsPrevious:
          final.uniqueLocalId === pristine.uniqueLocalId &&
          finalAfter.signature === previous.signature,
      };
    });

    await attempt("P10", async () => {
      const target = await paragraph("Probe ten: tabs\tand “quotes”, too.");
      const ranges = target.getTextRanges([" "], false);
      ranges.load("items/text");
      const text = target.getText();
      await context.sync();
      return {
        tokensRejoin: ranges.items.map((r) => r.text).join("") === text.value,
        tokens: ranges.items.length,
      };
    });

    await attempt("P1", async () => {
      body.insertTable(2, 2, "End", [
        ["Probe one a", "Probe one b"],
        ["Probe one c", "Probe one d"],
      ]);
      body.insertParagraph("Probe one after", "End");
      const live = body.paragraphs;
      live.load("items/uniqueLocalId,items/tableNestingLevel,items/text");
      await context.sync();
      const file = await captureWordDocumentPackage();
      const predicted = predictWordBodyParagraphs(file.ooxml);
      const paragraphs = live.items.map((p) => ({
        id: p.uniqueLocalId,
        nesting: p.tableNestingLevel,
        text: p.text,
      }));
      const issue = wordParagraphAlignmentIssue(predicted, paragraphs);
      return {
        predicted: predicted.length,
        live: paragraphs.length,
        aligned: !issue,
        countMatches: issue?.issue !== "count",
        nestingMatches: !issue || issue.issue === "text",
        textMatches: !issue,
      };
    });

    await attempt("P9", async (): Promise<Measured> => {
      // Measured only where the developer turned tracking on; the probe never sets the mode.
      if (trackingMode !== "TrackAll" && trackingMode !== "TrackMineOnly")
        return { result: "not-run" };
      const target = await paragraph("Probe nine kept words");
      // The probe's own synthetic paragraph, accepted so only the edit below is pending.
      target.getTrackedChanges().acceptAll();
      await context.sync();
      const original = await signature(target);
      const ranges = target.getTextRanges([" "], false);
      ranges.load("items/text");
      await context.sync();
      if (ranges.items.length !== 4) return { tokens: ranges.items.length };
      ranges.items[2].delete();
      ranges.items[1].insertText("new ", "After");
      const added = target.insertParagraph("Probe nine added", "After");
      added.load("uniqueLocalId");
      await context.sync();
      const changes = target.getTrackedChanges();
      changes.load("items/type,items/text");
      const addedChanges = added.getTrackedChanges();
      addedChanges.load("items/type");
      const current = target.getReviewedText("Current");
      const previous = target.getReviewedText("Original");
      const text = target.getText();
      context.document.load("changeTrackingMode");
      await context.sync();
      const types = changes.items.map((change) => String(change.type));
      const measured = {
        revisions: changes.items.length,
        recordsInsertion: types.includes("Added"),
        recordsDeletion: types.includes("Deleted"),
        currentText: current.value === "Probe nine new words",
        originalText: previous.value === "Probe nine kept words",
        textExcludesDeleted: text.value === "Probe nine new words",
        insertedParagraphTracked: addedChanges.items.length > 0,
        modeUnchanged:
          String(context.document.changeTrackingMode) === trackingMode,
      };
      changes.rejectAll();
      addedChanges.rejectAll();
      await context.sync();
      const restored = await signature(target);
      const all = body.paragraphs;
      all.load("items/uniqueLocalId");
      await context.sync();
      return {
        ...measured,
        rejectExact: restored.signature === original.signature,
        rejectRemovesInserted: !all.items.some(
          (p) => p.uniqueLocalId === added.uniqueLocalId,
        ),
      };
    });

    await attempt("P11", async (): Promise<Measured> => {
      // Read-only, and only for a header the scratch document already has: getHeader on a
      // section without one may create it.
      const file = await captureWordDocumentPackage();
      const doc = new DOMParser().parseFromString(
        file.ooxml,
        "application/xml",
      );
      const header = extractWordSections(doc)[0]?.headers.default;
      const part = extractWordStories(doc).find(
        (story) => story.id === header && story.type === "header",
      )?.part;
      if (!part) return { result: "not-run" };
      const sections = context.document.sections;
      sections.load("items");
      await context.sync();
      const live = sections.items[0].getHeader("Primary").paragraphs;
      live.load("items/uniqueLocalId,items/tableNestingLevel,items/text");
      await context.sync();
      const after = await captureWordDocumentPackage();
      const predicted = predictWordStoryParagraphs(file.ooxml, part);
      const issue = wordParagraphAlignmentIssue(
        predicted,
        live.items.map((p) => ({
          id: p.uniqueLocalId,
          nesting: p.tableNestingLevel,
          text: p.text,
        })),
      );
      return {
        predicted: predicted.length,
        live: live.items.length,
        aligned: !issue,
        createsNoPart:
          wordPackageCounts(after.ooxml).parts ===
          wordPackageCounts(file.ooxml).parts,
      };
    });

    probes.P12 = { result: "not-run" };
    return { status: "completed", platform, trackingMode, probes };
  });
}
