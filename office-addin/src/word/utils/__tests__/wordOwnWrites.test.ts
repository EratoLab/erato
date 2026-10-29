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
import { applyWordDocumentPlan } from "../wordApplyDocumentPlan";
import { applyWordEdits } from "../wordApplyEdits";
import {
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
    clockFromNow()(3_001);
    event("ParagraphChanged", [written]);

    expect(sources()).toEqual([
      "changed:own",
      "changed:local",
      "changed:local",
    ]);
  });

  it("counts an import's burst as own until Word goes quiet", async () => {
    onTestFinished(setWordWebImport("confirm"));
    window.WORD_FORCE_IMPORT_APPLY = true;
    installWordOoxmlHost(realisticWordPackageXml(), { profile: "word-web" });
    const snapshot = await captureRealisticSnapshot();
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

    for (let k = 1; k <= 10; k++) {
      later(k * 1_500);
      event("ParagraphAdded", [`new-${k}`]);
    }
    event("ParagraphDeleted", ["old-1", "old-2"]);
    later(10 * 1_500 + 2_001);
    event("ParagraphChanged", ["new-1"]);

    expect(sources()).toEqual(["added:own", "deleted:own", "changed:local"]);
  });

  it("counts paragraph edits' events for the edited paragraph as own", async () => {
    installMockWordDocument([{ text: "Alpha." }, { text: "Bravo." }]);
    const capture: WordDocumentCapture = {
      identity: "doc",
      ordinalMap: new Map([
        [1, { uniqueLocalId: "id-1", text: "Alpha." }],
        [2, { uniqueLocalId: "id-2", text: "Bravo." }],
      ]),
      paragraphsSent: 2,
      renderedOrdinals: new Set([1, 2]),
      partialOrdinal: null,
    };
    await applyWordEdits({
      edits: [{ paragraph: 2, text: "Bravo!" }],
      capture,
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
});
