import {
  emailDraftHtmlToText,
  sanitizeHtmlPreview,
} from "@erato/frontend/library";

import { plainTextToHtml } from "./htmlConvert";
import { callOfficeAsync } from "../../utils/officeAsync";
import {
  pauseComposeSelectionPolling,
  requestImmediateComposeSelectionPoll,
  resumeComposeSelectionPolling,
} from "../hooks/composeSelectionStore";
import { isMessageRead, resolveSupportedMailboxItem } from "../sessionPolicy";

// A compose write (setSelectedDataAsync) drops a callback ~never,
// but on a wedged host it could hang the whole insert forever — bound it.
const COMPOSE_WRITE_TIMEOUT_MS = 15_000;

/**
 * Run a compose-body write with the selection poller paused (so it can't
 * contend with the write on the host's serialized item-API slot), then poke
 * the poller once on completion so a post-insert re-selection is picked up
 * immediately instead of after the next interval. ERMAIN-431.
 */
async function withPausedSelectionPolling<T>(
  write: () => Promise<T>,
): Promise<T> {
  pauseComposeSelectionPolling();
  try {
    return await write();
  } finally {
    resumeComposeSelectionPolling();
    requestImmediateComposeSelectionPoll();
  }
}

export type BodyFormat = "html" | "text";

interface ComposeWriteAttempt {
  coercionType: Office.CoercionType;
  data: string;
}

const BLOCK_TAG_RE = /<(?:p|div|ul|ol|table|blockquote|h[1-6]|pre|hr)\b/i;

/**
 * One paragraph goes in as inline text: as a block it would split the
 * paragraph the cursor or the selection is in.
 */
function inlineIfOneParagraph(html: string): string {
  const paragraph = /^<p>([\s\S]*)<\/p>$/.exec(html.trim())?.[1];
  return paragraph !== undefined && !BLOCK_TAG_RE.test(paragraph)
    ? paragraph
    : html;
}

/** An HTML draft in the body's own format first, the other one if the host refuses. */
function htmlDraftWriteAttempts(
  draft: string,
  bodyFormat: BodyFormat,
): ComposeWriteAttempt[] {
  const text = {
    coercionType: Office.CoercionType.Text,
    data: emailDraftHtmlToText(draft),
  };
  if (!text.data) {
    // Nothing is left of the draft: writing it would only delete the selection.
    throw new Error("The draft has no text to insert");
  }
  const html = {
    coercionType: Office.CoercionType.Html,
    data: inlineIfOneParagraph(sanitizeHtmlPreview(draft)),
  };
  return bodyFormat === "html" ? [html, text] : [text, html];
}

async function tryReadComposeBody(
  item: Office.MessageCompose | Office.AppointmentCompose,
  coercionType: Office.CoercionType,
): Promise<string | null> {
  const body = item.body as {
    getAsync?: (
      coercionType: Office.CoercionType,
      callback: (result: Office.AsyncResult<string>) => void,
    ) => void;
  };
  const getAsync = body.getAsync;

  if (typeof getAsync !== "function") {
    return null;
  }

  try {
    return await callOfficeAsync<string>((callback) =>
      getAsync(coercionType, callback),
    );
  } catch {
    return null;
  }
}

function getActiveComposeItem():
  | Office.MessageCompose
  | Office.AppointmentCompose {
  const item = resolveSupportedMailboxItem(Office.context.mailbox.item);
  if (!item || isMessageRead(item)) {
    throw new Error("No compose item available");
  }
  return item;
}

async function tryComposeWrite(
  attempts: ComposeWriteAttempt[],
  write: (attempt: ComposeWriteAttempt) => Promise<void>,
): Promise<void> {
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      await write(attempt);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to write to compose body");
}

/**
 * Returns the current body format of the compose item ("html" or "text").
 * Some Outlook hosts omit `body.getTypeAsync`, so this falls back to
 * inspecting body reads instead of throwing.
 */
export async function getComposeBodyType(): Promise<BodyFormat> {
  const item = getActiveComposeItem();

  const body = item.body as {
    getTypeAsync?: (
      callback: (result: Office.AsyncResult<Office.CoercionType>) => void,
    ) => void;
  };
  const getTypeAsync = body.getTypeAsync;

  if (typeof getTypeAsync === "function") {
    const bodyType = await callOfficeAsync<Office.CoercionType>((callback) =>
      getTypeAsync(callback),
    );

    return bodyType === Office.CoercionType.Html ? "html" : "text";
  }

  const [htmlBody, textBody] = await Promise.all([
    tryReadComposeBody(item, Office.CoercionType.Html),
    tryReadComposeBody(item, Office.CoercionType.Text),
  ]);

  if (htmlBody !== null) {
    return "html";
  }

  if (textBody !== null) {
    return "text";
  }

  return "html";
}

/**
 * Replaces the current selection in the compose body, or inserts at the
 * cursor if nothing is selected, in the body's own format.
 *
 * @param isHtml Whether `data` is an HTML draft.
 */
export async function replaceComposeSelection(
  data: string,
  isHtml = false,
): Promise<void> {
  const item = getActiveComposeItem();

  const bodyFormat = await getComposeBodyType();
  const writeAttempts: ComposeWriteAttempt[] = isHtml
    ? htmlDraftWriteAttempts(data, bodyFormat)
    : bodyFormat === "html"
      ? [
          {
            coercionType: Office.CoercionType.Html,
            data: plainTextToHtml(data),
          },
          { coercionType: Office.CoercionType.Text, data },
        ]
      : [
          { coercionType: Office.CoercionType.Text, data },
          {
            coercionType: Office.CoercionType.Html,
            data: plainTextToHtml(data),
          },
        ];

  await withPausedSelectionPolling(() =>
    tryComposeWrite(writeAttempts, (attempt) =>
      callOfficeAsync<void>(
        (callback) =>
          item.body.setSelectedDataAsync(
            attempt.data,
            { coercionType: attempt.coercionType },
            callback,
          ),
        { timeoutMs: COMPOSE_WRITE_TIMEOUT_MS },
      ),
    ),
  );
}

/** Whitespace-insensitive form for telling whether two selections are the same passage. */
export function normalizeSelectionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces `selectedText` in the compose subject with `data` as plain text.
 * Matched as text, not through the live selection: `body.setSelectedDataAsync`
 * writes into the body even when the selection is in the subject. Throws,
 * writing nothing, unless the passage occurs exactly once (whitespace-
 * insensitive) — guessing between occurrences could rewrite the wrong one.
 */
export async function replaceComposeSubjectText(
  selectedText: string,
  data: string,
  isHtml = false,
): Promise<void> {
  const item = getActiveComposeItem();
  const words = normalizeSelectionText(selectedText).split(" ");
  const pattern = new RegExp(words.map(escapeRegExp).join("\\s+"), "g");
  const replacement = normalizeSelectionText(
    isHtml ? emailDraftHtmlToText(data) : data,
  );
  if (!replacement) {
    throw new Error("The draft has no text to insert");
  }

  await withPausedSelectionPolling(async () => {
    const subject = await callOfficeAsync<string>(
      (callback) => item.subject.getAsync(callback),
      { timeoutMs: COMPOSE_WRITE_TIMEOUT_MS },
    );
    const match = words[0] ? pattern.exec(subject) : null;
    if (match) {
      pattern.lastIndex = match.index + 1;
    }
    if (!match || pattern.exec(subject)) {
      throw new Error("Selected text does not occur exactly once in subject");
    }
    const nextSubject =
      subject.slice(0, match.index) +
      replacement +
      subject.slice(match.index + match[0].length);
    await callOfficeAsync<void>(
      (callback) => item.subject.setAsync(nextSubject, callback),
      { timeoutMs: COMPOSE_WRITE_TIMEOUT_MS },
    );
  });
}
