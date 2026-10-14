import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  generatedCommentDocument,
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import {
  readWordComments,
  renderWordCommentReadReport,
} from "../wordCommentReader";

import type {
  CommentHostFlavour,
  CommentHostOptions,
} from "../../../test/mocks/word/commentHost";
import type { WordCommentReadResult } from "../wordCommentReader";

const SENTINEL = "SENTINEL-c0mm3nt";
const AUTHOR = `Maya ${SENTINEL}`;
const EMAIL = `maya.${SENTINEL.toLowerCase()}@contoso.test`;
const LEVELS = ["log", "info", "warn", "error", "debug"] as const;
const HOSTS: readonly CommentHostFlavour[] = ["pc", "mac", "web"];

const document = {
  ...generatedCommentDocument({
    paragraphs: 6,
    repliesPerThread: 1,
    author: AUTHOR,
    email: EMAIL,
    text: (i) => `${SENTINEL} paragraph ${i}`,
    anchor: (i) => `${SENTINEL} anchor ${i}`,
    content: (i) => `${SENTINEL} comment ${i}`,
  }),
  v3c: true,
};

/** Office errors that quote the document, as some host messages do. */
const failing: CommentHostOptions = {
  document,
  failReplies: ["G2"],
  failRanges: ["G3"],
  errorMessage: `Could not read "${SENTINEL} text" by ${AUTHOR} <${EMAIL}>`,
};

describe("comment read privacy", () => {
  const spies = LEVELS.map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  const logged = () =>
    spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)));

  beforeEach(() => {
    for (const spy of spies) spy.mockClear();
  });

  afterEach(() => uninstallWordCommentHost());

  const leaks = (result: WordCommentReadResult) =>
    [
      JSON.stringify(result.diagnostics),
      renderWordCommentReadReport(result.diagnostics),
      ...(result.ok ? [] : [result.error]),
      ...result.diagnostics.errors.map((e) => e.error),
      ...logged(),
    ].filter((text) => text.toLowerCase().includes(SENTINEL.toLowerCase()));

  it.each(HOSTS)(
    "keeps comment text, authors and emails out of diagnostics, errors, the report and the console on %s",
    async (host) => {
      const mock = installWordCommentHost({ ...failing, host });
      const result = await readWordComments({
        now: mock.now,
        exact: (threads) => threads.map((t) => t.id),
      });
      if (!result.ok) throw new Error("the read failed");

      const g1 = result.threads.find((t) => t.content.endsWith("comment 1"));
      expect(g1?.authorName).toBe(AUTHOR);
      expect(g1?.authorEmail).toBe(EMAIL);
      expect(g1?.replies?.[0].authorEmail).toBe(EMAIL);
      expect(g1?.placement?.anchor.quote).toBe(`${SENTINEL} anchor 1`);
      expect(result.diagnostics.errors.length).toBeGreaterThan(0);
      // Word for the web reads no comment range, so G3's failing one is never asked for.
      expect(result.diagnostics.counts).toMatchObject({
        repliesFailed: 1,
        anchorsFailed: host === "web" ? 0 : 1,
      });
      expect(leaks(result)).toEqual([]);
    },
  );

  it("keeps the text out of a failed read's error", async () => {
    const mock = installWordCommentHost({ ...failing, failList: true });
    const result = await readWordComments({ now: mock.now });
    expect(result.ok).toBe(false);
    expect(leaks(result)).toEqual([]);
  });

  it("names only the error type when an error of ours quotes the document", async () => {
    const mock = installWordCommentHost({ document });
    const result = await readWordComments({
      now: mock.now,
      exact: (threads) => {
        throw new Error(`no thread like "${threads[0].content}"`);
      },
    });
    expect(result).toMatchObject({ ok: false, error: "order: Error" });
    expect(leaks(result)).toEqual([]);
  });
});
