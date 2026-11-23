import {
  expandWordTableCellSubmission,
  parseWordDocumentPlan,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  examplePlan,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { parseWordCommentChanges } from "../wordCommentChanges";
import { WordDocumentDraftStore } from "../wordDocumentDrafts";
import { finishWordParts, WordPartsDraftStore } from "../wordDocumentParts";
import { expandWordScopedSubmission } from "../wordScopedSubmission";

/** What a parser says about an input, as the code it refuses with or "ok". */
const outcome = (run: () => unknown): string => {
  try {
    const result = run();
    if (result && typeof result === "object" && "ok" in result) {
      const parsed = result as {
        ok: boolean;
        errors?: { code: string }[];
        result?: { validationErrors?: { code: string }[] };
      };
      return parsed.ok
        ? "ok"
        : (parsed.errors?.[0]?.code ??
            parsed.result?.validationErrors?.[0]?.code ??
            "refused");
    }
    return result === null ? "refused" : "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "threw";
  }
};

describe("the one argument a submission may carry for the server", () => {
  const snapshot = readySnapshot();

  it("passes the plan parser; any other unknown field still does not", () => {
    const plan = examplePlan(snapshot.token);
    expect(
      parseWordDocumentPlan(JSON.stringify({ ...plan, more_changes: true })),
    ).not.toBeNull();
    expect(
      parseWordDocumentPlan(JSON.stringify({ ...plan, more_changes: true }))
        ?.entries,
    ).toEqual(parseWordDocumentPlan(JSON.stringify(plan))?.entries);
    expect(
      parseWordDocumentPlan(JSON.stringify({ ...plan, later: true })),
    ).toBeNull();
  });

  it("passes the scoped edit parser; any other unknown field still does not", () => {
    const scoped = (extra: Record<string, unknown>) =>
      outcome(() =>
        expandWordScopedSubmission(
          {
            snapshot: snapshot.token,
            readToken: snapshot.readToken,
            scoped_edit: { body: [] },
            ...extra,
          },
          snapshot,
        ),
      );
    const shapeRefusal = scoped({ later: true });
    expect(shapeRefusal).toBe("scoped-shape");
    expect(scoped({ more_changes: false })).toBe(scoped({}));
  });

  it("passes the table cell parser; any other unknown field still does not", () => {
    const cell = (extra: Record<string, unknown>) =>
      outcome(() =>
        expandWordTableCellSubmission(
          {
            snapshot: snapshot.token,
            readToken: snapshot.readToken,
            table_cell: {
              sourceRef: "b1",
              rowIndex: 0,
              cellIndex: 0,
              expectedText: "x",
              text: "y",
            },
            ...extra,
          },
          snapshot,
        ),
      );
    expect(cell({ later: true })).toBe("table-cell-shape");
    expect(cell({ more_changes: true })).toBe(cell({}));
  });

  it("passes the finish of a change in parts; any other unknown field still does not", () => {
    const finish = (extra: Record<string, unknown>) =>
      outcome(() =>
        finishWordParts(
          {
            snapshot: snapshot.token,
            readToken: snapshot.readToken,
            draft_id: "draft-1",
            revision: 1,
            finish: true,
            ...extra,
          },
          snapshot,
          new WordPartsDraftStore(),
        ),
      );
    expect(finish({ later: true })).toBe("finish-shape");
    expect(finish({ more_changes: true })).toBe(finish({}));
  });

  it("passes a draft repair; any other unknown field still does not", () => {
    const repair = (extra: Record<string, unknown>) =>
      outcome(() =>
        new WordDocumentDraftStore().materialize({
          snapshot: snapshot.token,
          readToken: snapshot.readToken,
          draft_id: "draft-1",
          revision: 1,
          patches: [],
          ...extra,
        }),
      );
    expect(repair({ later: true })).toBe("repair-shape");
    expect(repair({ more_changes: true })).toBe(repair({}));
  });

  it("passes the comment changes parser; any other unknown field still does not", () => {
    const refusedPath = (extra: Record<string, unknown>) => {
      const parsed = parseWordCommentChanges(
        { changes: [{ op: "resolve", ref: "c1" }], ...extra },
        () => 10,
      );
      return parsed.ok ? undefined : parsed.errors[0]?.path;
    };
    expect(refusedPath({ later: true })).toBe("/later");
    expect(refusedPath({ more_changes: null })).toBe(refusedPath({}));
  });
});
