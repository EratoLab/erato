import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import { TestTheme } from "../../../test/helpers/TestTheme";
import {
  packageXml,
  paragraph,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { WordDocumentReadSession } from "../../utils/wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../../utils/wordDocumentSubmission";
import { WordScopedPlanReview } from "../WordScopedPlanReview";

import type { WordDocumentPlan } from "../../utils/wordDocumentPlan";

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);
it("reviews only the selected passage and proposed text", async () => {
  const snapshot = readySnapshot(
    packageXml(
      ["Unrelated before", "Target passage", "Unrelated after"]
        .map(paragraph)
        .join(""),
    ),
  );
  const session = new WordDocumentReadSession();
  const context = { chatId: "c", messageId: "m", toolCallId: "r" };
  session.activate(snapshot, context);
  const read = await session.execute(
    {
      snapshot: snapshot.token,
      documentIdentity: snapshot.identity,
      target: { ref: "b2" },
    },
    context,
  );
  if (!read.ok) throw Error(read.error);
  const result = await createWordDocumentSubmissionExecutor(session)(
    {
      snapshot: snapshot.token,
      readToken: (read.result as { readToken: string }).readToken,
      scoped_edit: {
        body: [
          {
            operation: "replace",
            source: ["b2"],
            blocks: [{ id: "n", type: "paragraph", text: "Revised passage" }],
          },
        ],
      },
    },
    { ...context, toolCallId: "s" },
  );
  if (!result.ok) throw Error(result.error);
  const plan = (result.result as { plan: WordDocumentPlan }).plan;
  render(
    <WordScopedPlanReview
      plan={plan}
      snapshot={snapshot}
      onLocate={() => {}}
    />,
    { wrapper: TestTheme },
  );
  expect(
    screen.getByRole("heading", { name: "Review selected changes" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Target passage")).toBeInTheDocument();
  expect(screen.getByText("Revised passage")).toBeInTheDocument();
  expect(screen.queryByText("Unrelated before")).not.toBeInTheDocument();
  expect(screen.queryByText("Unrelated after")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Locate passage 1" }),
  ).toBeInTheDocument();
});
