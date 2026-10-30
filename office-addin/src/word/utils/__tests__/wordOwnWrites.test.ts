import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { setWordWebImport } from "../../../test/mocks/word/applyPolicy";
import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import {
  captureRealisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import {
  applyWordDocumentPlan,
  revertWordDocumentPlan,
} from "../wordApplyDocumentPlan";
import { applyWordEdits, revertWordEdits } from "../wordApplyEdits";
import {
  noteWordCapturedIds,
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
  resetWordChangeJournalForTests,
  wordChangePosition,
  wordChangesSince,
} from "../wordChangeJournal";
import { insertWordTextAtCursor } from "../wordInsertText";
import { runWordGuarded } from "../wordRunGuard";

import type { WordDocumentCapture } from "@erato/frontend/word-review";

const event = (
  type: "ParagraphAdded" | "ParagraphChanged" | "ParagraphDeleted",
  ids: string[],
  source = "Local",
) => recordWordParagraphEvent({ type, source, uniqueLocalIds: ids });

let start: ReturnType<typeof wordChangePosition>;
const sources = () => {
  const since = wordChangesSince(start);
  if (!since.ok) throw new Error(since.reason);
  return since.entries.map((e) => `${e.kind}:${e.source}`);
};

const captureOf = (texts: string[]): WordDocumentCapture => ({
  identity: "doc",
  ordinalMap: new Map(
    texts.map((text, k) => [k + 1, { uniqueLocalId: `id-${k + 1}`, text }]),
  ),
  paragraphsSent: texts.length,
  renderedOrdinals: new Set(texts.map((_, k) => k + 1)),
  partialOrdinal: null,
});

/** Sets the clock to `ms` after the moment this is called. */
function clockFromNow(): (ms: number) => void {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now");
  return (ms) => clock.mockReturnValue(now + ms);
}

async function liveIds(): Promise<{ text: string; id: string }[]> {
  return globalThis.Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items/uniqueLocalId,items/text");
    await context.sync();
    return paragraphs.items.map((p) => ({ text: p.text, id: p.uniqueLocalId }));
  });
}

describe("the pane's own writes in the change journal", () => {
  beforeEach(() => {
    resetWordChangeJournalForTests();
    noteWordChangeEventsActive();
    start = wordChangePosition();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallMockWordDocument();
    delete window.WORD_FORCE_IMPORT_APPLY;
  });

  it("counts an in-place Apply's event for the paragraph it wrote as own, and a user's edit elsewhere as local", async () => {
    installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const snapshot = await captureRealisticSnapshot();
    const result = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status: done.")),
      snapshot,
      snapshot.ownerMessageId,
    );
    expect(result.status).toBe("applied");
    expect(result.outcome?.route).toBe("in-place");
    const ids = await liveIds();
    const written = ids.find((p) => p.text.startsWith("Status: done."))!.id;
    const other = ids.find((p) => p.id !== written && p.text.trim())!.id;

    event("ParagraphChanged", [written]);
    event("ParagraphChanged", [other]);
    clockFromNow()(6_001);
    event("ParagraphChanged", [written]);

    expect(sources()).toEqual([
      "changed:own",
      "changed:local",
      "changed:local",
    ]);
  });

  it("counts an import's Added and Deleted as own until Word reported the paragraphs from before it deleted, and a Changed as local", async () => {
    onTestFinished(setWordWebImport("confirm"));
    window.WORD_FORCE_IMPORT_APPLY = true;
    installWordOoxmlHost(realisticWordPackageXml(), { profile: "word-web" });
    const snapshot = await captureRealisticSnapshot();
    noteWordCapturedIds(["old-1", "old-2"]);
    const result = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status: imported.")),
      snapshot,
      snapshot.ownerMessageId,
      undefined,
      undefined,
      { importConfirmed: true },
    );
    expect(result.outcome?.route).toBe("import");
    const later = clockFromNow();

    for (let k = 0; k <= 10; k++) {
      later(10 + k * 5_600);
      event("ParagraphAdded", [`new-${k}`]);
    }
    event("ParagraphChanged", ["new-1"]);
    event("ParagraphDeleted", ["old-1", "old-2"]);
    later(10 + 10 * 5_600 + 2_001);
    event("ParagraphAdded", ["typed"]);

    expect(sources()).toEqual([
      "added:own",
      "changed:local",
      "deleted:own",
      "added:local",
    ]);
  });

  it("counts a revert of an in-place Apply as own for the paragraphs it restored, and an edit elsewhere as local", async () => {
    installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const snapshot = await captureRealisticSnapshot();
    const applied = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status: done.")),
      snapshot,
      snapshot.ownerMessageId,
    );
    expect(applied.outcome?.route).toBe("in-place");
    const later = clockFromNow();
    later(4_000);
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status).toBe("reverted");
    const ids = await liveIds();
    const restored = ids.find((p) => p.text.startsWith("Status"))!.id;
    const far = ids.find((p) => p.text === "Closing paragraph.")!.id;

    event("ParagraphChanged", [restored]);
    event("ParagraphChanged", [far]);

    expect(sources()).toEqual(["changed:own", "changed:local"]);
  });

  it("counts a revert of an import as own until Word goes quiet", async () => {
    onTestFinished(setWordWebImport("confirm"));
    window.WORD_FORCE_IMPORT_APPLY = true;
    installWordOoxmlHost(realisticWordPackageXml(), { profile: "word-web" });
    const snapshot = await captureRealisticSnapshot();
    const applied = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status: imported.")),
      snapshot,
      snapshot.ownerMessageId,
      undefined,
      undefined,
      { importConfirmed: true },
    );
    expect(applied.outcome?.route).toBe("import");
    const later = clockFromNow();
    later(40_000);
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status).toBe("reverted");

    event("ParagraphAdded", ["new-1"]);
    event("ParagraphDeleted", ["old-1"]);
    later(40_000 + 3_001);
    event("ParagraphChanged", ["new-1"]);

    expect(sources()).toEqual(["added:own", "deleted:own", "changed:local"]);
  });

  it("counts a revert of paragraph edits as own until Word goes quiet", async () => {
    installMockWordDocument([{ text: "Alpha." }, { text: "Bravo." }]);
    const applied = await applyWordEdits({
      edits: [{ paragraph: 2, text: "Bravo!" }],
      capture: captureOf(["Alpha.", "Bravo."]),
    });
    const later = clockFromNow();
    later(4_000);
    await expect(
      revertWordEdits(applied.snapshotOoxml!, applied.afterFingerprint),
    ).resolves.toBe("reverted");

    event("ParagraphAdded", ["new-1"]);
    event("ParagraphDeleted", ["id-1"]);
    later(4_000 + 3_001);
    event("ParagraphChanged", ["new-1"]);

    expect(sources()).toEqual(["added:own", "deleted:own", "changed:local"]);
  });

  it("claims nothing for paragraph edits it refuses to write, even with a line break", async () => {
    installMockWordDocument([{ text: "Alpha." }, { text: "Bravo, typed." }]);
    const applied = await applyWordEdits({
      edits: [{ paragraph: 2, text: "Bravo.\nCharlie." }],
      capture: captureOf(["Alpha.", "Bravo."]),
    });
    expect(applied.outcomes.map((outcome) => outcome.status)).toEqual([
      "changed",
    ]);

    event("ParagraphChanged", ["id-2"]);

    expect(sources()).toEqual(["changed:local"]);
  });

  it("counts paragraph edits' events for the edited paragraph as own", async () => {
    installMockWordDocument([{ text: "Alpha." }, { text: "Bravo." }]);
    await applyWordEdits({
      edits: [{ paragraph: 2, text: "Bravo!" }],
      capture: captureOf(["Alpha.", "Bravo."]),
    });

    event("ParagraphChanged", ["id-2"]);
    event("ParagraphChanged", ["id-1"]);

    expect(sources()).toEqual(["changed:own", "changed:local"]);
  });

  it("counts an insert at the cursor as own for 3 s after it", async () => {
    installMockWordDocument([{ text: "Alpha." }]);
    await insertWordTextAtCursor("Hello");

    event("ParagraphChanged", ["id-1"]);
    clockFromNow()(3_001);
    event("ParagraphChanged", ["id-1"]);

    expect(sources()).toEqual(["changed:own", "changed:local"]);
  });

  it("counts a guarded write, such as a comment, as own, and a guarded read as nothing of its own", async () => {
    installMockWordDocument([{ text: "Alpha." }]);
    await runWordGuarded(
      async (context) => {
        await context.sync();
      },
      { timeoutMs: 1_000 },
    );
    event("ParagraphChanged", ["id-1"]);
    const write = await runWordGuarded(
      async (context, guard) => {
        guard.beforeWrite();
        await context.sync();
      },
      { timeoutMs: 1_000 },
    );
    await write.settled;
    event("ParagraphChanged", ["id-1"]);

    expect(sources()).toEqual(["changed:local", "changed:own"]);
  });

  it("never counts a co-author's edit during a write as own", async () => {
    installMockWordDocument([{ text: "Alpha." }]);
    await insertWordTextAtCursor("Hello");

    event("ParagraphChanged", ["id-1"], "Remote");

    expect(sources()).toEqual(["changed:remote"]);
  });

  it("stops claiming at a guarded write's timeout, though its run never settles", async () => {
    installMockWordDocument([{ text: "Alpha." }]);
    const write = await runWordGuarded(
      async (_context, guard) => {
        guard.beforeWrite();
        await new Promise(() => {});
      },
      { timeoutMs: 10 },
    );
    expect(write.outcome).toBe("timeout");

    clockFromNow()(4_000);
    event("ParagraphChanged", ["id-1"]);

    expect(sources()).toEqual(["changed:local"]);
  });
});
