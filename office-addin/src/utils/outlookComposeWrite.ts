import { plainTextToHtml } from "./htmlConvert";
import { stripHtmlTags } from "./htmlStrip";
import { callOfficeAsync } from "./officeAsync";

export type BodyFormat = "html" | "text";

interface ComposeWriteAttempt {
  coercionType: Office.CoercionType;
  data: string;
}

async function tryReadComposeBody(
  item: Office.MessageCompose,
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
  const item = Office.context.mailbox.item as Office.MessageCompose | null;
  if (!item) {
    throw new Error("No compose item available");
  }

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
 * Replaces the current selection in the compose body (or inserts at cursor
 * if nothing is selected).
 *
 * Automatically detects the body format and adapts:
 * - HTML body + plain text content → converts newlines to `<br>`, inserts as HTML
 * - HTML body + HTML content → inserts as HTML
 * - Plain text body + HTML content → strips tags before inserting
 * - Plain text body + plain text content → inserts as-is
 *
 * @param data The content to insert.
 * @param isHtml Whether `data` contains HTML markup. When true and the body
 *               is plain text, HTML tags are stripped automatically.
 */
export async function replaceComposeSelection(
  data: string,
  isHtml = false,
): Promise<void> {
  const item = Office.context.mailbox.item as Office.MessageCompose | null;
  if (!item) {
    throw new Error("No compose item available");
  }

  const bodyFormat = await getComposeBodyType();
  const writeAttempts: ComposeWriteAttempt[] = isHtml
    ? bodyFormat === "text"
      ? [
          {
            coercionType: Office.CoercionType.Text,
            data: stripHtmlTags(data),
          },
          { coercionType: Office.CoercionType.Html, data },
        ]
      : [
          { coercionType: Office.CoercionType.Html, data },
          {
            coercionType: Office.CoercionType.Text,
            data: stripHtmlTags(data),
          },
        ]
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

  await tryComposeWrite(writeAttempts, (attempt) =>
    callOfficeAsync<void>((callback) =>
      item.body.setSelectedDataAsync(
        attempt.data,
        { coercionType: attempt.coercionType },
        callback,
      ),
    ),
  );
}

/**
 * Prepends content to the beginning of the compose body.
 */
export async function prependComposeBody(data: string): Promise<void> {
  const item = Office.context.mailbox.item as Office.MessageCompose | null;
  if (!item) {
    throw new Error("No compose item available");
  }

  const bodyFormat = await getComposeBodyType();
  const writeAttempts: ComposeWriteAttempt[] =
    bodyFormat === "html"
      ? [
          { coercionType: Office.CoercionType.Html, data },
          { coercionType: Office.CoercionType.Text, data: stripHtmlTags(data) },
        ]
      : [
          { coercionType: Office.CoercionType.Text, data: stripHtmlTags(data) },
          { coercionType: Office.CoercionType.Html, data },
        ];

  await tryComposeWrite(writeAttempts, (attempt) =>
    callOfficeAsync<void>((callback) =>
      item.body.prependAsync(
        attempt.data,
        { coercionType: attempt.coercionType },
        callback,
      ),
    ),
  );
}
