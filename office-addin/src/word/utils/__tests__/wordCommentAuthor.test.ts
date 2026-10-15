import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installWordSelectionHost,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import {
  reattributeWordComments,
  wordCommentPackageWithAuthor,
} from "../wordCommentAuthor";
import {
  parseWordCommentChanges,
  validateWordCommentChanges,
} from "../wordCommentChanges";
import {
  resetWordCommentSession,
  wordCommentAssistantAuthorAvailable,
} from "../wordCommentPolicy";
import {
  forgetWordCommentRefs,
  wordCommentRefRegistry,
} from "../wordCommentRefs";
import { readWordCommentStory } from "../wordCommentSubmission";
import {
  executeWordCommentDraft,
  revertWordCommentRows,
} from "../wordCommentWrites";

import type {
  MockSelectionDocument,
  WordSelectionHost,
} from "../../../test/mocks/word/selectionHost";

const AUTHOR = "Erato (AI) for Max Token";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const PACKAGE = `<?xml version="1.0" standalone="yes"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/comments.xml"><pkg:xmlData><w:comments xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="0" w:author="Max Token" w:initials="MT"><w:p w14:paraId="1C000001"><w:r><w:t xml:space="preserve">Erato </w:t></w:r><w:r><w:t>AI: Check it.</w:t></w:r></w:p></w:comment><w:comment w:id="1" w:author="Maya Krüger" w:initials="MK"><w:p w14:paraId="1C000002"><w:r><w:t>Theirs.</w:t></w:r></w:p></w:comment></w:comments></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/commentsIds.xml"><pkg:xmlData><w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"><w16cid:commentId w16cid:paraId="1C000001" w16cid:durableId="0000002A"/><w16cid:commentId w16cid:paraId="1C000002" w16cid:durableId="0000002B"/></w16cid:commentsIds></pkg:xmlData></pkg:part></pkg:package>`;

describe("wordCommentPackageWithAuthor", () => {
  const commentsOf = (xml: string) =>
    Array.from(
      new DOMParser()
        .parseFromString(xml, "application/xml")
        .getElementsByTagNameNS(W, "comment"),
    ).map((c) => ({
      author: c.getAttributeNS(W, "author"),
      initials: c.getAttributeNS(W, "initials"),
      text: Array.from(c.getElementsByTagNameNS(W, "t"))
        .map((t) => t.textContent)
        .join(""),
    }));

  it("changes only the target's author, initials and label, across runs", () => {
    const rewritten = wordCommentPackageWithAuthor(
      PACKAGE,
      [{ commentId: "42", label: "Erato AI:" }],
      AUTHOR,
    );
    expect(rewritten?.startsWith("<?xml")).toBe(true);
    expect(commentsOf(rewritten!)).toEqual([
      { author: AUTHOR, initials: "AI", text: "Check it." },
      { author: "Maya Krüger", initials: "MK", text: "Theirs." },
    ]);
  });

  it("writes nothing when a target is missing or lacks the label", () => {
    expect(
      wordCommentPackageWithAuthor(
        PACKAGE,
        [{ commentId: "7", label: "Erato AI:" }],
        AUTHOR,
      ),
    ).toBeNull();
    expect(
      wordCommentPackageWithAuthor(
        PACKAGE,
        [{ commentId: "43", label: "Erato AI:" }],
        AUTHOR,
      ),
    ).toBeNull();
  });
});

const DOC: MockSelectionDocument = {
  body: [
    "H1 Author probe",
    {
      runs: [
        "AT1 Someone else ",
        { text: "commented", commented: "AT" },
        { comment: "AT" },
        " here alpha beta.",
      ],
    },
    {
      runs: [
        "FD1 Field before ",
        { text: "2026-10-06", field: 'DATE \\@ "yyyy-MM-dd"' },
        " gamma delta.",
      ],
    },
    { table: [["CL1 Cell one words.", "CL2 Cell two words."]] },
  ],
  commentMeta: {
    AT: {
      author: "Maya Krüger",
      email: "maya@contoso.test",
      content: "Theirs.",
    },
  },
};

let host: WordSelectionHost;

async function addDraft(changes: unknown[]) {
  const story = await readWordCommentStory();
  const parsed = parseWordCommentChanges({ changes }, () => 50);
  if (!parsed.ok) throw new Error("parse");
  const validated = validateWordCommentChanges(parsed, {
    draftId: "call-ai",
    identity: "doc",
    host: "PC",
    threads: new Map(),
    selection: null,
    captured: new Map(),
    story,
    label: "Erato AI:",
    authorMode: "assistant",
    rowCap: () => 50,
  });
  if (!validated.ok) throw new Error(JSON.stringify(validated.errors));
  return validated.draft;
}

const posted = (text: string) =>
  host.commentStates().filter((c) => c.content === text);

beforeEach(() => {
  forgetWordCommentRefs();
  wordCommentRefRegistry("doc").legacy = false;
});
afterEach(() => {
  uninstallWordSelectionHost();
  resetWordCommentSession();
});

describe.each(["pc", "mac"] as const)("AI-author mode on %s", (which) => {
  const run = (draft: Awaited<ReturnType<typeof addDraft>>) =>
    executeWordCommentDraft(draft, {
      selected: new Set(draft.rows.map((row) => row.i)),
      assistantAuthor: AUTHOR,
      host: which === "pc" ? "PC" : "Mac",
      pollMs: 0,
      reattribute: reattributeWordComments,
    });

  it("re-attributes a labelled comment, keeps its id and leaves the other thread alone", async () => {
    host = installWordSelectionHost(DOC, { host: which });
    const before = host.commentStates().find((c) => c.content === "Theirs.");
    const { rows } = await run(
      await addDraft([
        { op: "add", anchor: { para: 2, quote: "alpha" }, text: "Check it." },
      ]),
    );
    expect(rows[0]).toMatchObject({ status: "applied", author: "assistant" });
    const [comment] = posted("Check it.");
    expect(comment).toMatchObject({
      id: rows[0].commentId,
      author: AUTHOR,
      initials: "AI",
      anchor: "alpha",
    });
    expect(host.commentStates().find((c) => c.content === "Theirs.")).toEqual(
      before,
    );

    const reverted = await revertWordCommentRows([
      { i: 0, step: rows[0].revert! },
    ]);
    expect(reverted.rows[0].status).toBe("reverted");
    expect(posted("Check it.")).toEqual([]);
  });

  it("re-attributes in a table cell by unwrapping the paragraph from its row", async () => {
    host = installWordSelectionHost(DOC, { host: which });
    const { rows } = await run(
      await addDraft([
        { op: "add", anchor: { para: 4, quote: "one" }, text: "In a cell." },
      ]),
    );
    expect(rows[0]).toMatchObject({ status: "applied", author: "assistant" });
    expect(posted("In a cell.")[0]).toMatchObject({
      author: AUTHOR,
      anchor: "one",
    });
    expect(host.paragraphs().map((p) => p.text)).toEqual([
      "H1 Author probe",
      "AT1 Someone else commented here alpha beta.",
      "FD1 Field before 2026-10-06 gamma delta.",
      "CL1 Cell one words.",
      "CL2 Cell two words.",
    ]);
  });

  it("keeps the label and the user as author where the paragraph holds a field", async () => {
    host = installWordSelectionHost(DOC, { host: which });
    const { rows } = await run(
      await addDraft([
        { op: "add", anchor: { para: 3, quote: "gamma" }, text: "By field." },
      ]),
    );
    expect(rows[0]).toMatchObject({
      status: "applied_as_user",
      code: "AUTHOR_MODE_UNAVAILABLE",
      author: "user",
    });
    expect(posted("Erato AI: By field.")[0]).toMatchObject({
      author: "Max Token",
    });
    expect(wordCommentAssistantAuthorAvailable("PC")).toBe(true);
  });

  it("keeps the label under comments-only protection and stops trying for the session", async () => {
    host = installWordSelectionHost(DOC, { host: which });
    const draft = await addDraft([
      { op: "add", anchor: { para: 2, quote: "alpha" }, text: "Protected." },
    ]);
    const user = await executeWordCommentDraft(draft, {
      selected: new Set([0]),
      assistantAuthor: null,
      host: "PC",
      pollMs: 0,
    });
    const start = host.syncCount();
    // story (2 syncs), checks (1), then the insertOoxml sync.
    const stop = host.beforeSync((index) => {
      if (index === start + 4)
        throw Object.assign(new Error("protected"), {
          code: "GeneralException",
        });
    });
    const outcomes = await reattributeWordComments({
      draft,
      rows: [{ row: draft.rows[0], commentId: user.rows[0].commentId! }],
      authorName: AUTHOR,
    });
    stop();
    expect(outcomes.get(0)).toEqual({
      status: "applied_as_user",
      code: "AUTHOR_MODE_UNAVAILABLE",
    });
    expect(posted("Erato AI: Protected.")).toHaveLength(1);
    expect(wordCommentAssistantAuthorAvailable("PC")).toBe(false);
  });
});
