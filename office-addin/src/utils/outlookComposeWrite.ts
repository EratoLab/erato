import { stripHtmlTags } from "./htmlStrip";
import { callOfficeAsync } from "./officeAsync";

export type BodyFormat = "html" | "text";

/**
 * Returns the current body format of the compose item ("html" or "text").
 * Must be called before every insertion to match the coercion type.
 */
export async function getComposeBodyType(): Promise<BodyFormat> {
  const item = Office.context.mailbox.item as Office.MessageCompose | null;
  if (!item) {
    throw new Error("No compose item available");
  }

  const bodyType = await callOfficeAsync<Office.CoercionType>((callback) =>
    item.body.getTypeAsync(callback),
  );

  return bodyType === Office.CoercionType.Html ? "html" : "text";
}

/**
 * Replaces the current selection in the compose body (or inserts at cursor
 * if nothing is selected).
 *
 * Automatically detects the body format and adapts:
 * - HTML body + plain text content → inserts as-is (safe)
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

  let insertData = data;
  let coercionType: Office.CoercionType;

  if (bodyFormat === "html") {
    coercionType = isHtml ? Office.CoercionType.Html : Office.CoercionType.Text;
    // Plain text into HTML body is safe — Office wraps it automatically.
  } else {
    coercionType = Office.CoercionType.Text;
    if (isHtml) {
      insertData = stripHtmlTags(data);
    }
  }

  await callOfficeAsync<void>((callback) =>
    item.body.setSelectedDataAsync(insertData, { coercionType }, callback),
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
  const coercionType =
    bodyFormat === "html" ? Office.CoercionType.Html : Office.CoercionType.Text;

  await callOfficeAsync<void>((callback) =>
    item.body.prependAsync(data, { coercionType }, callback),
  );
}
