import { captureWordDocumentPackage } from "./wordDocumentPackage";
import { queueWordInPlaceTextWrite } from "./wordInPlaceExecutor";
import { wordFirstRunMarks, wordParagraphSignature } from "./wordInPlaceState";
import {
  predictWordBodyParagraphs,
  wordParagraphAlignmentIssue,
} from "./wordLiveParagraphs";
import { wordWriteHost } from "./wordWriteHost";

import type { WordInPlaceProbeId } from "./wordInPlaceCapabilities";

/** Booleans, counts and fixed codes only: the report is pasted into issues and must carry no content. */
export type WordInPlaceProbeValue = boolean | number | WordInPlaceProbeCode;
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

/**
 * Dev-only native validation of the in-place mechanisms (P1-P12). Runs only in an empty document the
 * developer opened for it, writes nothing but its own synthetic paragraphs, and never changes the Track
 * Changes mode: with tracking on, it measures the tracked behaviour instead.
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
    const probes: WordInPlaceProbeReport["probes"] = {};
    const attempt = async (
      id: WordInPlaceProbeId,
      run: () => Promise<Record<string, WordInPlaceProbeValue>>,
    ) => {
      try {
        probes[id] = await run();
      } catch {
        probes[id] = { result: "error" };
      }
    };
    const paragraph = async (text: string) => {
      const made = body.insertParagraph(text, "End");
      made.load("uniqueLocalId");
      await context.sync();
      return made;
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
      const before = await signature(anchor);
      const made = anchor.insertParagraph("Probe five inserted", "After");
      await context.sync();
      const inserted = await signature(made);
      const props = (ooxml: string) => {
        const doc = new DOMParser().parseFromString(ooxml, "application/xml");
        const pPr = doc.getElementsByTagNameNS(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "pPr",
        )[0];
        return pPr ? new XMLSerializer().serializeToString(pPr) : "";
      };
      return {
        inheritsParagraphProperties:
          props(inserted.ooxml) === props(before.ooxml),
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
      await paragraph("Probe one after");
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

    for (const id of ["P6", "P7", "P8", "P9", "P11", "P12"] as const)
      probes[id] = { result: "not-run" };
    return { status: "completed", platform, trackingMode, probes };
  });
}
