import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import { mixedAuthoringXml } from "../../../test/mocks/word/mixedAuthoringFixtures";
import { readWordDocument } from "../../utils/readWordDocument";
import {
  useWordDocumentSource,
  WORD_CAPTURE_CEILING_MS,
  WORD_CAPTURE_SLOW_MS,
} from "../useWordDocumentSource";

import type { WordDocumentBuild } from "../../utils/buildWordDocumentArgs";
import type { WordDocumentReadResult } from "../../utils/readWordDocument";

const changes = vi.hoisted(() => new Set<() => void>());
const signal = vi.hoisted(() => ({
  eventsActive: false,
  trackingMode: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../../utils/readWordDocument", () => ({
  readWordDocument: vi.fn(),
}));

vi.mock("../../utils/wordDocumentChangeSignal", () => ({
  subscribeWordDocumentChanged: (listener: () => void) => {
    changes.add(listener);
    return () => changes.delete(listener);
  },
  wordParagraphEventsActive: () => signal.eventsActive,
  readWordChangeTrackingMode: () => signal.trackingMode(),
}));

const read = vi.mocked(readWordDocument);

const paragraphs = (texts: string[]) =>
  texts.map((text, index) => ({
    ordinal: index + 1,
    text,
    uniqueLocalId: `p${index + 1}`,
    styleBuiltIn: "Normal",
    outlineLevel: 10,
  }));

const readsText = (texts: string[]) =>
  read.mockResolvedValue({ ok: true, paragraphs: paragraphs(texts) });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const changeDocument = () =>
  act(() => {
    for (const listener of changes) listener();
  });

const focusPane = () =>
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });

function renderSource({
  enabled = true,
  authoringEnabled = false,
}: { enabled?: boolean; authoringEnabled?: boolean } = {}) {
  return renderHook((props) => useWordDocumentSource(props), {
    initialProps: { enabled, documentIdentity: "doc-1", authoringEnabled },
  });
}

describe("useWordDocumentSource", () => {
  beforeEach(() => {
    read.mockReset();
    changes.clear();
    signal.eventsActive = false;
    signal.trackingMode.mockReset().mockResolvedValue("Off");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("captures as soon as inclusion is on, before any send", async () => {
    readsText(["Alpha"]);
    const { result } = renderSource();
    await waitFor(() => expect(result.current.preview.status).toBe("included"));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not read the document while inclusion is off", () => {
    readsText(["Alpha"]);
    renderSource({ enabled: false });
    expect(read).not.toHaveBeenCalled();
  });

  it("reuses an unchanged capture for every send, as separate copies", async () => {
    readsText(["Alpha"]);
    const { result } = renderSource();
    await waitFor(() => expect(result.current.preview.status).toBe("included"));

    const first = await result.current.capture();
    const second = await result.current.capture();

    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("captures again once Word reports a change", async () => {
    readsText(["Alpha"]);
    const { result } = renderSource();
    await waitFor(() => expect(result.current.preview.status).toBe("included"));
    readsText(["Beta"]);
    changeDocument();

    let build: Awaited<ReturnType<typeof result.current.capture>> = null;
    await act(async () => {
      build = await result.current.capture();
    });

    expect(read).toHaveBeenCalledTimes(2);
    expect(build!.args.document_text).toContain("Beta");
  });

  it("lets a send join the capture that is already running", async () => {
    const pending = deferred<WordDocumentReadResult>();
    read.mockReturnValue(pending.promise);
    const { result } = renderSource();

    const send = result.current.capture();
    await act(async () => {
      pending.resolve({ ok: true, paragraphs: paragraphs(["Alpha"]) });
      await send;
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect((await send)?.args.document_text).toContain("Alpha");
  });

  it("recaptures on pane focus only after the document changed", async () => {
    readsText(["Alpha"]);
    const { result } = renderSource();
    await waitFor(() => expect(result.current.preview.status).toBe("included"));

    focusPane();
    expect(read).toHaveBeenCalledTimes(1);

    changeDocument();
    focusPane();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it("shows a capture that runs long and expects the next send to wait for it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = deferred<WordDocumentReadResult>();
    read.mockReturnValue(pending.promise);
    const { result } = renderSource();
    expect(result.current.preview.reading).toBe(false);
    expect(result.current.captureExpectedSlow()).toBe(false);

    act(() => {
      vi.advanceTimersByTime(WORD_CAPTURE_SLOW_MS);
    });

    expect(result.current.preview.reading).toBe(true);
    expect(result.current.captureExpectedSlow()).toBe(true);
    await act(async () => {
      pending.resolve({ ok: true, paragraphs: paragraphs(["Alpha"]) });
      await pending.promise;
    });
    expect(result.current.preview.reading).toBe(false);
    expect(result.current.captureExpectedSlow()).toBe(false);
  });

  it("expects a wait after a change when the last capture was slow", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = deferred<WordDocumentReadResult>();
    read.mockReturnValue(pending.promise);
    const { result } = renderSource();
    await act(async () => {
      vi.advanceTimersByTime(WORD_CAPTURE_SLOW_MS + 1);
      pending.resolve({ ok: true, paragraphs: paragraphs(["Alpha"]) });
      await pending.promise;
    });

    changeDocument();

    expect(result.current.captureExpectedSlow()).toBe(true);
  });

  it("gives every send its own authoring token and per-send state", async () => {
    read.mockResolvedValue({
      ok: true,
      paragraphs: paragraphs(["Alpha"]),
      authoring: { ooxml: mixedAuthoringXml(), tracking: "Off" },
    });
    const { result } = renderSource({ authoringEnabled: true });
    await waitFor(() => expect(result.current.preview.status).toBe("included"));

    const first = (await result.current.capture())!.authoring!;
    const capturedIssue = first.issue;
    first.used = true;
    first.read.add("block-1");
    first.issue = "model-budget";
    const second = (await result.current.capture())!.authoring!;

    expect(read).toHaveBeenCalledTimes(1);
    expect(second.token).not.toBe(first.token);
    expect(second.used).toBe(false);
    expect(second.read.size).toBe(0);
    expect(second.issue).toBe(capturedIssue);
    expect(second.blocks).toEqual(first.blocks);
  });

  it("maps a block to a paragraph ordinal only when its text is unique on both sides", async () => {
    read.mockResolvedValue({
      ok: true,
      paragraphs: paragraphs(["Alpha", "Twin", "Twin"]),
      authoring: {
        ooxml: packageXml(
          [paragraph("Alpha"), paragraph("Twin"), paragraph("Twin")].join(""),
        ),
        tracking: "Off",
      },
    });
    const { result } = renderSource({ authoringEnabled: true });
    await waitFor(() => expect(result.current.preview.status).toBe("included"));

    const blocks = (await result.current.capture())!.authoring!.blocks;

    expect(blocks.map((block) => block.paragraphOrdinal)).toEqual([
      1,
      undefined,
      undefined,
    ]);
  });

  it("keeps the text but no authoring when Word did not hand over the full document", async () => {
    read.mockResolvedValue({
      ok: true,
      paragraphs: paragraphs(["Alpha"]),
      authoringUnavailable: {
        issue: "too-large",
        detail: "package-too-large",
        error: "full-document capture: WordDocumentTooLargeError",
      },
    });
    const { result } = renderSource({ authoringEnabled: true });
    await waitFor(() =>
      expect(result.current.preview.authoringIssue).toBe("too-large"),
    );

    const build = await result.current.capture();

    expect(build?.args.document_text).toContain("Alpha");
    expect(build?.authoring?.issue).toBe("too-large");
    expect(build?.authoring?.issueDetails).toEqual(["package-too-large"]);
  });

  it("keeps body authoring with its note when Word for the web withheld the file, without retrying", async () => {
    read.mockResolvedValue({
      ok: true,
      paragraphs: paragraphs(["Alpha"]),
      authoring: {
        ooxml: packageXml(paragraph("Alpha")),
        tracking: "Off",
        fullDocument: false,
      },
      note: "package-blocked",
    });
    const { result } = renderSource({ authoringEnabled: true });
    await waitFor(() =>
      expect(result.current.preview.authoringNote).toBe("package-blocked"),
    );
    expect(result.current.preview.authoringIssue).toBeUndefined();

    let build: Awaited<ReturnType<typeof result.current.capture>> = null;
    await act(async () => {
      build = await result.current.capture();
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(build!.readNote).toBe("package-blocked");
    expect(build!.authoring?.issue).toBeUndefined();
    expect(build!.authoring?.fullDocument).toBeFalsy();
  });

  it("keeps the earlier capture available after the document changed", async () => {
    readsText(["Alpha"]);
    const { result } = renderSource();
    await waitFor(() => expect(result.current.preview.status).toBe("included"));

    changeDocument();

    expect(result.current.previousCapture()?.args.document_text).toContain(
      "Alpha",
    );
  });

  it("reports an unreadable document with the read error", async () => {
    read.mockResolvedValue({ ok: false, error: "paragraph read: Error" });
    const { result } = renderSource();

    await waitFor(() =>
      expect(result.current.preview).toMatchObject({
        status: "unreadable",
        readError: "paragraph read: Error",
      }),
    );
    expect(await result.current.capture()).toBeNull();
  });

  it("tries again at the next send after a failed read", async () => {
    read.mockResolvedValueOnce({ ok: false, error: "paragraph read: Error" });
    const { result } = renderSource();
    await waitFor(() =>
      expect(result.current.preview.status).toBe("unreadable"),
    );
    readsText(["Alpha"]);

    let build: Awaited<ReturnType<typeof result.current.capture>> = null;
    await act(async () => {
      build = await result.current.capture();
    });

    expect(read).toHaveBeenCalledTimes(2);
    expect(build!.args.document_text).toContain("Alpha");
  });

  it.each([
    ["retries", "package-timeout", "unavailable", 2],
    ["does not retry", "package-too-large", "too-large", 1],
    ["does not retry", "package-unsupported", "unavailable", 1],
  ] as const)(
    "%s a document whose full package failed with %s",
    async (_, detail, issue, reads) => {
      read.mockResolvedValue({
        ok: true,
        paragraphs: paragraphs(["Alpha"]),
        authoringUnavailable: { issue, detail, error: "capture failed" },
      });
      const { result } = renderSource({ authoringEnabled: true });
      await waitFor(() =>
        expect(result.current.preview.authoringIssue).toBe(issue),
      );

      await act(async () => {
        await result.current.capture();
      });

      expect(read).toHaveBeenCalledTimes(reads);
    },
  );

  it("labels a document edited since the last send", async () => {
    readsText(["Alpha"]);
    const { result } = renderSource();
    await waitFor(() => expect(result.current.preview.status).toBe("included"));
    await act(async () => {
      result.current.markSent(await result.current.capture());
    });

    readsText(["Alpha, edited"]);
    changeDocument();
    focusPane();

    await waitFor(() =>
      expect(result.current.preview.changedSinceLastSend).toBe(true),
    );
  });

  const leavePane = () =>
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

  const readsAuthoring = (tracking: string) =>
    read.mockResolvedValue({
      ok: true,
      paragraphs: paragraphs(["Alpha"]),
      authoring: { ooxml: packageXml(paragraph("Alpha")), tracking },
    });

  it("without paragraph events, treats a return to the pane as a change", async () => {
    readsText(["Alpha"]);
    const { result } = renderSource();
    await waitFor(() => expect(result.current.preview.status).toBe("included"));

    leavePane();
    focusPane();

    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it("with paragraph events, does not read again on a return when Track Changes is unchanged", async () => {
    signal.eventsActive = true;
    readsAuthoring("Off");
    const { result } = renderSource({ authoringEnabled: true });
    await waitFor(() => expect(result.current.preview.status).toBe("included"));

    leavePane();
    focusPane();
    await act(async () => {
      await result.current.capture();
    });

    expect(signal.trackingMode).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads again on a return after Track Changes was toggled", async () => {
    signal.eventsActive = true;
    readsAuthoring("Off");
    const { result } = renderSource({ authoringEnabled: true });
    await waitFor(() => expect(result.current.preview.status).toBe("included"));
    signal.trackingMode.mockResolvedValue("TrackAll");

    leavePane();
    focusPane();

    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it("retries a failed full transfer at the next send, not on every focus", async () => {
    read.mockResolvedValue({
      ok: true,
      paragraphs: paragraphs(["Alpha"]),
      authoringUnavailable: {
        issue: "unavailable",
        detail: "package-timeout",
        error: "capture failed",
      },
    });
    const { result } = renderSource({ authoringEnabled: true });
    await waitFor(() =>
      expect(result.current.preview.authoringIssue).toBe("unavailable"),
    );

    focusPane();
    focusPane();
    expect(read).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.capture();
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each(["tagging", "changed"] as const)(
    "captures again at the next send, not on every focus, while Word for Mac's proofing pass was pending (%s)",
    async (pending) => {
      read.mockResolvedValue({
        ok: true,
        paragraphs: paragraphs(["Alpha"]),
        authoring: {
          ooxml: packageXml(paragraph("Alpha")),
          tracking: "Off",
          fullDocument: true,
          proofingPending: pending,
        },
      });
      const { result } = renderSource({ authoringEnabled: true });
      await waitFor(() =>
        expect(result.current.preview.status).toBe("included"),
      );

      focusPane();
      focusPane();
      expect(read).toHaveBeenCalledTimes(1);

      let sent: WordDocumentBuild | null = null;
      await act(async () => {
        sent = await result.current.capture();
      });
      expect(read).toHaveBeenCalledTimes(2);
      // Only Word's own tagging can explain a later refusal; another change ended the wait.
      expect(sent!.authoring?.proofingPending).toBe(
        pending === "tagging" ? true : undefined,
      );
    },
  );

  it("does not let an older capture that settles late replace a newer one", async () => {
    const older = deferred<WordDocumentReadResult>();
    const newer = deferred<WordDocumentReadResult>();
    read.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result, rerender } = renderSource();
    rerender({
      enabled: true,
      documentIdentity: "doc-1",
      authoringEnabled: true,
    });
    const send = result.current.capture();
    expect(read).toHaveBeenCalledTimes(2);

    await act(async () => {
      newer.resolve({
        ok: true,
        paragraphs: paragraphs(["Newer"]),
        authoring: { ooxml: packageXml(paragraph("Newer")), tracking: "Off" },
      });
      await send;
    });
    await act(async () => {
      older.resolve({ ok: true, paragraphs: paragraphs(["Older"]) });
      await older.promise;
    });
    readsText(["Third"]);

    const build = await result.current.capture();
    expect(read).toHaveBeenCalledTimes(2);
    expect(build?.args.document_text).toContain("Newer");
    expect(build?.authoring).toBeDefined();
  });

  it("keeps the last good capture for the deadline when a later read fails", async () => {
    readsText(["Alpha"]);
    const { result } = renderSource();
    await waitFor(() => expect(result.current.preview.status).toBe("included"));
    read.mockResolvedValue({ ok: false, error: "paragraph read: Error" });
    changeDocument();

    await act(async () => {
      await result.current.capture();
    });

    expect(result.current.preview.status).toBe("unreadable");
    expect(result.current.previousCapture()?.args.document_text).toContain(
      "Alpha",
    );
  });

  it("gives up on a capture that never settles, so later sends can capture again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    read.mockReturnValueOnce(new Promise(() => {}));
    const { result } = renderSource();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORD_CAPTURE_CEILING_MS);
    });
    expect(result.current.preview).toMatchObject({
      status: "unreadable",
      readError: `capture: Error: capture timed out after ${WORD_CAPTURE_CEILING_MS} ms`,
    });
    readsText(["Alpha"]);
    let build: Awaited<ReturnType<typeof result.current.capture>> = null;
    await act(async () => {
      build = await result.current.capture();
    });

    expect(read).toHaveBeenCalledTimes(2);
    expect(build!.args.document_text).toContain("Alpha");
  });
});
