import {
  WORD_COMMENT_ACTION_CLASS,
  WORD_SUBMIT_COMMENT_CHANGES_TOOL,
} from "@erato/frontend/word-review";

import {
  parseWordCommentChanges,
  validateWordCommentChanges,
} from "./wordCommentChanges";
import {
  wordCommentAuthorPreference,
  wordCommentDeploymentSettings,
  wordCommentRowCap,
} from "./wordCommentPolicy";
import { wordCommentReadSession } from "./wordCommentReadTool";
import { wordCommentRefRegistry } from "./wordCommentRefs";
import { wordHostPlatform } from "./wordHostPlatform";
import { wordParagraphId } from "./wordParagraphIds";
import { WORD_SELECTION_TEXT_OPTIONS } from "./wordReviewLocation";
import { runWordGuarded } from "./wordRunGuard";

import type {
  WordCommentDraft,
  WordCommentStoryFacts,
  WordCommentValidationError,
} from "./wordCommentChanges";
import type {
  WordCommentReadSession,
  WordCommentSubmissionScope,
} from "./wordCommentReadTool";
import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@erato/frontend/library";
import type { WordCommentAction } from "@erato/frontend/word-review";

export { WORD_SUBMIT_COMMENT_CHANGES_TOOL };

/** After this many rejected submissions in a request, Erato asks the user (contract §9.2). */
export const WORD_COMMENT_SUBMISSION_REJECTIONS = 2;
const STORY_READ_TIMEOUT_MS = 30_000;

export const WORD_COMMENT_NOTHING_WRITTEN =
  "Nothing is written yet: the user confirms or declines these comment changes on a card. Do not say they are done; tell the user what the card proposes.";

interface SubmissionState {
  token: string;
  rejected: number;
  accepted: string | null;
  /** Redelivered calls get their first answer again. */
  answers: Map<
    string,
    { serialized: string; result: ClientToolExecutionResult }
  >;
}

/** Pane memory only: a reload loses the drafts, and their cards can no longer write. */
const drafts = new Map<string, WordCommentDraft>();
let state: SubmissionState | null = null;

export const wordCommentDraft = (
  draftId: string,
): WordCommentDraft | undefined => drafts.get(draftId);

export function forgetWordCommentDrafts(): void {
  drafts.clear();
  state = null;
}

export interface WordCommentSubmissionDeps {
  session?: Pick<WordCommentReadSession, "submissionScope">;
  readStory?: () => Promise<WordCommentStoryFacts | null>;
}

/** Body paragraphs with the texts the validator maps quotes in. */
export async function readWordCommentStory(): Promise<WordCommentStoryFacts | null> {
  const result = await runWordGuarded(
    async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/uniqueLocalId,items/text,items/tableNestingLevel");
      await context.sync();
      const texts = paragraphs.items.map((p) =>
        p.getText(WORD_SELECTION_TEXT_OPTIONS),
      );
      await context.sync();
      return {
        entries: paragraphs.items.map((p, i) => ({
          id: wordParagraphId(p.uniqueLocalId),
          text: texts[i].value,
        })),
        rangeTexts: paragraphs.items.map((p) => p.text),
        nesting: paragraphs.items.map((p) => p.tableNestingLevel),
      };
    },
    { timeoutMs: STORY_READ_TIMEOUT_MS },
  );
  return result.outcome === "ok" ? (result.value ?? null) : null;
}

const fail = (
  error: string,
  validationErrors: { path: string; code: string; message: string }[],
  terminal: boolean,
  recovery: "repair_arguments" | "read_current_context" | "cannot_continue",
): ClientToolExecutionResult => ({
  ok: false,
  error,
  validationErrors,
  submissionFeedback: { terminal, recovery },
});

const terminalFail = (code: string, message: string) =>
  fail(message, [{ path: "", code, message }], true, "cannot_continue");

function stateFor(scope: WordCommentSubmissionScope): SubmissionState {
  if (state?.token !== scope.token)
    state = {
      token: scope.token,
      rejected: 0,
      accepted: null,
      answers: new Map(),
    };
  return state;
}

function reject(
  current: SubmissionState,
  errors: WordCommentValidationError[],
): ClientToolExecutionResult {
  current.rejected += 1;
  const last = current.rejected >= WORD_COMMENT_SUBMISSION_REJECTIONS;
  const issues = last
    ? [
        {
          path: "",
          code: "ask-user",
          message:
            "This is the second rejected comment submission for this request. Do not submit again: tell the user what could not be placed or found, and ask how to go on.",
        },
        ...errors,
      ].slice(0, 16)
    : errors;
  return fail(
    last
      ? "Comment changes rejected twice; ask the user."
      : "Comment changes rejected; repair and submit again.",
    issues,
    last,
    last ? "cannot_continue" : "repair_arguments",
  );
}

export function createWordCommentSubmissionExecutor(
  deps: WordCommentSubmissionDeps = {},
): ClientToolExecutor {
  const session = deps.session ?? wordCommentReadSession;
  const readStory = deps.readStory ?? readWordCommentStory;
  return async (input, context?: ClientToolCallContext) => {
    if (!context || context.signal?.aborted)
      return { ok: false, error: "Comment submission unavailable or stopped." };
    const scope = session.submissionScope(context);
    if (!scope)
      return terminalFail(
        "comments-unavailable",
        "This request has no comment session of its own: the Word pane was reloaded or a newer request replaced it. Tell the user to send the request again.",
      );
    let serialized: string;
    try {
      serialized = JSON.stringify(input);
    } catch {
      return { ok: false, error: "Expected JSON arguments." };
    }
    const current = stateFor(scope);
    const answered = current.answers.get(context.toolCallId);
    if (answered)
      return answered.serialized === serialized
        ? answered.result
        : terminalFail(
            "call-conflict",
            "This call was already answered with other arguments.",
          );
    const remember = (result: ClientToolExecutionResult) => {
      current.answers.set(context.toolCallId, { serialized, result });
      return result;
    };
    if (current.accepted)
      return remember(
        terminalFail(
          "already-proposed",
          "Comment changes for this request already wait on a card. One request makes one proposal: wait for the user's answer.",
        ),
      );
    if (current.rejected >= WORD_COMMENT_SUBMISSION_REJECTIONS)
      return remember(
        terminalFail(
          "ask-user",
          "Two comment submissions were rejected for this request. Ask the user how to go on.",
        ),
      );

    const settings = wordCommentDeploymentSettings();
    const parsed = parseWordCommentChanges(input, (action) =>
      wordCommentRowCap(actionClassOf(action)),
    );
    if (!parsed.ok) return remember(reject(current, parsed.errors));
    const namesParagraphs = parsed.changes.some(
      (change) =>
        change.op === "add" &&
        typeof change.anchor === "object" &&
        change.anchor !== null &&
        (change.anchor as Record<string, unknown>).selection !== true,
    );
    const story = namesParagraphs ? await readStory() : null;
    if (
      context.signal?.aborted ||
      session.submissionScope(context)?.token !== scope.token
    )
      return { ok: false, error: "Comment submission stopped." };
    if (namesParagraphs && !story)
      return fail(
        "Word did not hand over the document's paragraphs.",
        [
          {
            path: "",
            code: "document-read-failed",
            message:
              "Word did not hand over the document's paragraphs, so no quote could be checked. Tell the user to try again.",
          },
        ],
        true,
        "cannot_continue",
      );
    const capture = scope.capture;
    const validated = validateWordCommentChanges(parsed, {
      draftId: context.toolCallId,
      identity: scope.identity,
      host: wordHostPlatform(),
      threads: scope.threads,
      selection: capture?.selection ?? null,
      captured: capture?.ordinalMap ?? new Map(),
      story,
      label: settings.label,
      authorMode: wordCommentAuthorPreference(),
      rowCap: (action) => wordCommentRowCap(actionClassOf(action)),
      legacy: wordCommentRefRegistry(scope.identity).legacy,
    });
    if (!validated.ok) return remember(reject(current, validated.errors));
    drafts.set(validated.draft.draftId, validated.draft);
    current.accepted = validated.draft.draftId;
    return remember({
      ok: true,
      result: {
        draft_id: context.toolCallId,
        action: validated.draft.action,
        rows: validated.draft.rows.length,
        status: "awaiting_user",
        note: WORD_COMMENT_NOTHING_WRITTEN,
      },
    });
  };
}

const actionClassOf = (action: WordCommentAction) =>
  WORD_COMMENT_ACTION_CLASS[action];
