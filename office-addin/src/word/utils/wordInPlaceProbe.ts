import { captureWordDocumentPackage } from "./wordDocumentPackage";
import { captureWordAuthoringSnapshot } from "./wordDocumentXml";
import { wordPackageCounts } from "./wordFullDocumentComparison";
import { wordComplexScriptMarkSetters } from "./wordInPlaceCapabilities";
import {
  placedWithin,
  queueRevisionPlacements,
  queueWordInPlaceTextWrite,
} from "./wordInPlaceExecutor";
import {
  WORD_SPAN_ENDING_MARKS,
  planWordSpanEdits,
  queueWordSpanEdits,
} from "./wordInPlaceSpanWriter";
import { wordFirstRunMarks, wordParagraphSignature } from "./wordInPlaceState";
import { predictWordStoryParagraphs } from "./wordInPlaceStories";
import {
  normalizeWordParagraphText,
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
 * Dev-only native validation of the in-place mechanisms (P1-P13). Runs only in an empty
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
    let step = 0;
    /** The last step an attempt reached, so an error report says where Word threw. */
    const at = (n: number) => {
      step = n;
    };
    const attempt = async (
      id: WordInPlaceProbeId,
      run: () => Promise<Measured>,
    ) => {
      step = 0;
      try {
        probes[id] = await run();
      } catch {
        probes[id] = { result: "error", step };
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
    const tracking =
      trackingMode === "TrackAll" || trackingMode === "TrackMineOnly";
    const bodyIds = async () => {
      const all = body.paragraphs;
      all.load("items/uniqueLocalId");
      await context.sync();
      return all.items.map((p) => p.uniqueLocalId);
    };
    const sameIds = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length && a.every((id, i) => id === b[i]);
    /** The probe's own synthetic paragraphs, accepted so only the change under test is pending. */
    const accept = async (...targets: Word.Paragraph[]) => {
      for (const target of targets) target.getTrackedChanges().acceptAll();
      await context.sync();
    };
    /** The production span writer, from the paragraph's current text to `to`. */
    const spanEdit = async (target: Word.Paragraph, to: string) => {
      const ranges = target.getTextRanges(WORD_SPAN_ENDING_MARKS, false);
      ranges.load("items/text");
      target.load("text");
      await context.sync();
      const edits = planWordSpanEdits(
        ranges.items.map((range) => range.text),
        target.text,
        [{ text: target.text, ...PLAIN }],
        [{ text: to, ...PLAIN }],
      );
      if (!edits) return false;
      queueWordSpanEdits(target, ranges.items, edits);
      target.load("text");
      await context.sync();
      return target.text === to;
    };
    /** Each revision of `target` lies within it, and its reviewed texts are `current` and `original`. */
    const review = async (
      target: Word.Paragraph,
      current: string,
      original: string,
    ) => {
      const changes = target.getTrackedChanges();
      changes.load("items/type");
      const now = target.getReviewedText("Current");
      const before = target.getReviewedText("Original");
      await context.sync();
      const placements = queueRevisionPlacements(
        changes.items,
        target.getRange("Whole"),
      );
      await context.sync();
      return {
        changes,
        types: changes.items.map((change) => String(change.type)),
        inside: placedWithin(placements),
        reviewed:
          normalizeWordParagraphText(now.value) === current &&
          normalizeWordParagraphText(before.value) === original,
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
      const twinSetters = wordComplexScriptMarkSetters();
      let twinWritesCs: WordInPlaceProbeValue = "not-run";
      let twinInverseExact: WordInPlaceProbeValue = "not-run";
      if (twinSetters) {
        // Formatted the way Word's own Bold command does it, with the complex-script twin.
        at(1);
        const styled = await paragraph("Probe four styled");
        const whole = styled.getRange("Content");
        whole.font.bold = true;
        whole.font.boldBidirectional = true;
        await context.sync();
        at(2);
        const start = await signature(styled);
        twinWritesCs = /<w:bCs\b/.test(start.ooxml);
        queueWordInPlaceTextWrite(
          styled,
          [
            { text: "Probe four ", ...PLAIN },
            { text: "styled", ...PLAIN, bold: true, italic: true },
          ],
          start.marks,
        );
        await context.sync();
        at(3);
        const mid = await signature(styled);
        queueWordInPlaceTextWrite(
          styled,
          [{ text: "Probe four styled", ...PLAIN, bold: true }],
          mid.marks,
        );
        await context.sync();
        twinInverseExact =
          (await signature(styled)).signature === start.signature;
      }
      return {
        forwardChanged: changed.signature !== original.signature,
        inverseExact: restored.signature === original.signature,
        twinSetters,
        twinWritesCs,
        twinInverseExact,
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
      const ordered = await paragraph("Probe six ordered");
      const first = await paragraph("Probe six first");
      const start = await signatures([plain, styled, ordered, first]);
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
      // The opposite order, which Word may handle differently.
      ordered.styleBuiltIn = "ListParagraph";
      ordered.attachToList(list.id, 0);
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
        attachSetsListStyle:
          pStyle(at(attached, "Probe six plain")) ===
          inPackage(attached, "Probe six plain").styleId("list paragraph"),
        detachClearsStyle: !pStyle(at(detached, "Probe six plain")),
        styleThenAttachKeepsList:
          !!listNumId &&
          numbering(at(attached, "Probe six ordered")).numId === listNumId,
        styleThenAttachKeepsStyle:
          pStyle(at(attached, "Probe six ordered")) ===
          inPackage(attached, "Probe six ordered").styleId("list paragraph"),
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

    const counted = async () => {
      const all = body.paragraphs;
      all.load("items/uniqueLocalId");
      await context.sync();
      return all.items;
    };
    await attempt("P8", async (): Promise<Measured> => {
      at(1);
      const one = await paragraph("Probe eight one");
      const two = await paragraph("Probe eight two");
      const three = await paragraph("Probe eight three");
      const [first, removed, last] = await signatures([one, two, three]);
      if (![first, removed, last].every(({ ooxml }) => plainStart(ooxml)))
        return { startsClean: false };
      const count = (await counted()).length;
      at(2);
      two.delete();
      await context.sync();
      const afterDelete = (await counted()).length;
      at(3);
      const [firstAfter, lastAfter] = await signatures([one, three]);
      at(4);
      const made = one.insertParagraph("", "After");
      queueWordInPlaceTextWrite(
        made,
        [{ text: "Probe eight two", ...PLAIN }],
        PLAIN,
      );
      made.styleBuiltIn = "Normal";
      await context.sync();
      at(5);
      const recreated = await signature(made);
      return {
        startsClean: true,
        countDropsByOne: afterDelete === count - 1,
        neighboursUnchanged:
          firstAfter.signature === first.signature &&
          lastAfter.signature === last.signature,
        recreateExact: recreated.signature === removed.signature,
      };
    });

    await attempt("P10", async () => {
      at(1);
      const target = await paragraph("Probe ten: tabs\tand “quotes”, too.");
      const ranges = target.getTextRanges(WORD_SPAN_ENDING_MARKS, false);
      ranges.load("items/text");
      target.load("text");
      await context.sync();
      // The last range may hold the paragraph mark without showing it: the writer must neither
      // delete it with the last word nor write past it when appending.
      at(2);
      const last = await paragraph("Probe ten last word");
      const spaced = await paragraph("Probe ten spaced ");
      const next = await paragraph("Probe ten next");
      const nextBefore = await signature(next);
      const idsBefore = await bodyIds();
      at(3);
      const lastWordReplaced = await spanEdit(last, "Probe ten final term");
      at(4);
      const appended = await spanEdit(spaced, "Probe ten spaced end");
      const nextAfter = await signature(next);
      return {
        tokensRejoin: ranges.items.map((r) => r.text).join("") === target.text,
        tokens: ranges.items.length,
        lastWordReplaced,
        appended,
        paragraphsKept: sameIds(await bodyIds(), idsBefore),
        nextUnchanged: nextAfter.signature === nextBefore.signature,
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
      if (!tracking) return { result: "not-run" };
      at(1);
      const words = await paragraph("Probe nine kept words");
      const spaced = await paragraph("Probe nine spaced ");
      const whole = await paragraph("Probe nine whole");
      const item = await paragraph("Probe nine listed words");
      const next = await paragraph("Probe nine next");
      item.startNewList();
      await context.sync();
      at(2);
      await accept(words, spaced, whole, item, next);
      const written = [words, spaced, whole, item];
      const before = await signatures([...written, next]);
      const idsBefore = await bodyIds();
      // A middle insertion and the last word replaced, then an append after the last word.
      at(3);
      const span = await spanEdit(words, "Probe nine new kept terms");
      const append = await spanEdit(spaced, "Probe nine spaced end");
      const listSpan = await spanEdit(item, "Probe nine listed terms");
      at(4);
      queueWordInPlaceTextWrite(
        whole,
        [
          { text: "Probe nine ", ...PLAIN },
          { text: "rewritten", ...PLAIN, bold: true },
        ],
        wordFirstRunMarks(before[2].ooxml),
      );
      await context.sync();
      at(5);
      const reviews = [
        await review(
          words,
          "Probe nine new kept terms",
          "Probe nine kept words",
        ),
        await review(spaced, "Probe nine spaced end", "Probe nine spaced "),
        await review(whole, "Probe nine rewritten", "Probe nine whole"),
      ];
      const listed = await review(
        item,
        "Probe nine listed terms",
        "Probe nine listed words",
      );
      const text = words.getText();
      context.document.load("changeTrackingMode");
      await context.sync();
      const idsWritten = await bodyIds();
      const nextWritten = await signature(next);
      at(6);
      for (const { changes } of [...reviews, listed]) changes.rejectAll();
      await context.sync();
      const restored = await signatures(written);
      const measured: Measured = {
        span,
        append,
        recordsInsertion: reviews[0].types.includes("Added"),
        recordsDeletion: reviews[0].types.includes("Deleted"),
        reviewed: reviews.every((r) => r.reviewed),
        changesInside: reviews.every((r) => r.inside),
        listSpan,
        listReviewed: listed.reviewed,
        listChangesInside: listed.inside,
        textExcludesDeleted: text.value === "Probe nine new kept terms",
        paragraphsKept: sameIds(idsWritten, idsBefore),
        nextUnchanged: nextWritten.signature === before[4].signature,
        modeUnchanged:
          String(context.document.changeTrackingMode) === trackingMode,
        rejectExact: restored.every(
          (r, i) => r.signature === before[i].signature,
        ),
        rejectKeepsParagraphs: sameIds(await bodyIds(), idsBefore),
      };
      // A table cell as the cell writer rewrites it, if P1 could make a table.
      const all = body.paragraphs;
      all.load("items/tableNestingLevel,items/text");
      await context.sync();
      const cell = all.items.find((p) => p.tableNestingLevel > 0);
      if (!cell) return { ...measured, cell: "not-run" };
      at(7);
      await accept(cell);
      const cellBefore = await signature(cell);
      cell.load("text");
      await context.sync();
      const original = cell.text;
      at(8);
      cell.insertText("Probe nine cell", "Replace");
      await context.sync();
      const cellReview = await review(cell, "Probe nine cell", original);
      cellReview.changes.rejectAll();
      await context.sync();
      return {
        ...measured,
        cellReviewed: cellReview.reviewed,
        cellChangesInside: cellReview.inside,
        cellRejectExact:
          (await signature(cell)).signature === cellBefore.signature,
      };
    });

    await attempt("P13", async (): Promise<Measured> => {
      if (!tracking) return { result: "not-run" };
      at(1);
      const anchor = await paragraph("Probe thirteen anchor");
      const next = await paragraph("Probe thirteen next");
      const doomed = await paragraph("Probe thirteen deleted");
      const after = await paragraph("Probe thirteen after");
      const styled = await paragraph("Probe thirteen styled");
      const joining = await paragraph("Probe thirteen joins");
      const head = await paragraph("Probe thirteen list");
      const list = head.startNewList();
      list.load("id");
      await context.sync();
      at(2);
      await accept(anchor, next, doomed, after, styled, joining, head);
      const measured: Measured = {};
      const reject = async (target: Word.Paragraph) => {
        const changes = target.getTrackedChanges();
        changes.rejectAll();
        await context.sync();
      };

      // Inserted as the executor inserts: an empty paragraph, its text, then its style. Word may
      // record the new paragraph mark on the anchor, which Restore would never reject.
      at(3);
      const [anchorBefore, nextBefore] = await signatures([anchor, next]);
      let ids = await bodyIds();
      const added = anchor.insertParagraph("", "After");
      queueWordInPlaceTextWrite(
        added,
        [{ text: "Probe thirteen added", ...PLAIN }],
        PLAIN,
      );
      await context.sync();
      added.styleBuiltIn = "Normal";
      await context.sync();
      const neighbours = [anchor, next].map((target) => {
        const changes = target.getTrackedChanges();
        changes.load("items/type");
        return changes;
      });
      await context.sync();
      at(4);
      const inserted = await review(added, "Probe thirteen added", "");
      inserted.changes.rejectAll();
      await context.sync();
      const [anchorAfter, nextAfter] = await signatures([anchor, next]);
      Object.assign(measured, {
        insertNeighboursUntouched: neighbours.every((c) => !c.items.length),
        insertTracked: inserted.types.includes("Added"),
        insertReviewed: inserted.reviewed,
        insertChangesInside: inserted.inside,
        insertRejectRemoves: sameIds(await bodyIds(), ids),
        insertRejectExact:
          anchorAfter.signature === anchorBefore.signature &&
          nextAfter.signature === nextBefore.signature,
      });

      // A tracked deletion must stay in body.paragraphs under its ID until it is reviewed.
      at(5);
      const [doomedBefore, afterBefore] = await signatures([doomed, after]);
      ids = await bodyIds();
      doomed.delete();
      await context.sync();
      const listed = sameIds(await bodyIds(), ids);
      at(6);
      const deleted = await review(doomed, "", "Probe thirteen deleted");
      const [nextKept, afterKept] = await signatures([next, after]);
      at(7);
      await reject(doomed);
      Object.assign(measured, {
        deleteListed: listed,
        deleteTracked: deleted.types.includes("Deleted"),
        deleteReviewed: deleted.reviewed,
        deleteChangesInside: deleted.inside,
        deleteNeighboursUnchanged:
          nextKept.signature === nextBefore.signature &&
          afterKept.signature === afterBefore.signature,
        deleteRejectExact:
          (await signature(doomed)).signature === doomedBefore.signature &&
          sameIds(await bodyIds(), ids),
      });

      // Style and list changes are revisions only while Word's "Track formatting" option is on.
      const formatted = async (
        target: Word.Paragraph,
        change: () => void,
      ): Promise<[boolean, boolean]> => {
        const original = await signature(target);
        change();
        await context.sync();
        const changes = target.getTrackedChanges();
        changes.load("items/type");
        await context.sync();
        const tracked = changes.items.some(
          (c) => String(c.type) === "Formatted",
        );
        await reject(target);
        return [
          tracked,
          (await signature(target)).signature === original.signature,
        ];
      };
      at(8);
      const [restyleTracked, restyleRejectExact] = await formatted(
        styled,
        () => {
          styled.styleBuiltIn = "Heading2";
        },
      );
      at(9);
      const [attachTracked, attachRejectExact] = await formatted(joining, () =>
        joining.attachToList(list.id, 0),
      );
      at(10);
      const [detachTracked, detachRejectExact] = await formatted(head, () =>
        head.detachFromList(),
      );
      context.document.load("changeTrackingMode");
      await context.sync();
      return {
        ...measured,
        restyleTracked,
        restyleRejectExact,
        attachTracked,
        attachRejectExact,
        detachTracked,
        detachRejectExact,
        modeUnchanged:
          String(context.document.changeTrackingMode) === trackingMode,
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
      at(1);
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
      const read: Measured = {
        predicted: predicted.length,
        live: live.items.length,
        aligned: !issue,
        createsNoPart:
          wordPackageCounts(after.ooxml).parts ===
          wordPackageCounts(file.ooxml).parts,
      };
      if (!tracking || !live.items.length) return read;
      // Tracked, in a synthetic paragraph of its own that leaves the header as it found it.
      at(2);
      const made = live.items[0].insertParagraph(
        "Probe eleven kept words",
        "Before",
      );
      await context.sync();
      await accept(made);
      const original = await signature(made);
      at(3);
      const span = await spanEdit(made, "Probe eleven new words");
      const written = await review(
        made,
        "Probe eleven new words",
        "Probe eleven kept words",
      );
      at(4);
      written.changes.rejectAll();
      await context.sync();
      const rejectExact =
        (await signature(made)).signature === original.signature;
      at(5);
      made.delete();
      await context.sync();
      await accept(made);
      const count = sections.items[0].getHeader("Primary").paragraphs;
      count.load("items");
      await context.sync();
      return {
        ...read,
        trackedSpan: span,
        trackedReviewed: written.reviewed,
        trackedChangesInside: written.inside,
        trackedRejectExact: rejectExact,
        headerRestored:
          count.items.length === live.items.length &&
          wordPackageCounts((await captureWordDocumentPackage()).ooxml)
            .parts === wordPackageCounts(file.ooxml).parts,
      };
    });

    probes.P12 = { result: "not-run" };
    // Last: Word may remove the paragraph before a deleted final paragraph, and every other probe
    // inserts before that paragraph. The style tells the final paragraph mark apart from it.
    if (probes.P8 && !("result" in probes.P8)) {
      step = 0;
      try {
        at(6);
        const tail = body.insertParagraph("Probe eight tail", "End");
        tail.styleBuiltIn = "Quote";
        await context.sync();
        const withTail = (await counted()).length;
        const previous = await signature(pristine);
        at(7);
        tail.delete();
        await context.sync();
        at(8);
        const remaining = await counted();
        const final = remaining.at(-1)!;
        const finalAfter = await signature(final);
        probes.P8 = {
          ...probes.P8,
          finalDeleteDropsCount: remaining.length === withTail - 1,
          finalDeleteKeepsPrevious:
            final.uniqueLocalId === pristine.uniqueLocalId &&
            finalAfter.signature === previous.signature,
        };
      } catch {
        probes.P8 = {
          ...probes.P8,
          finalDelete: "error",
          finalDeleteStep: step,
        };
      }
    }
    return { status: "completed", platform, trackingMode, probes };
  });
}
