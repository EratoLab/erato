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
 * if nothing is selected) with the given text.
 *
 * Automatically detects the body format and uses the matching coercion type
 * to avoid inserting raw HTML tags into plain text or losing formatting in
 * HTML bodies.
 */
export async function replaceComposeSelection(data: string): Promise<void> {
  const item = Office.context.mailbox.item as Office.MessageCompose | null;
  if (!item) {
    throw new Error("No compose item available");
  }

  const bodyFormat = await getComposeBodyType();
  const coercionType =
    bodyFormat === "html" ? Office.CoercionType.Html : Office.CoercionType.Text;

  await callOfficeAsync<void>((callback) =>
    item.body.setSelectedDataAsync(data, { coercionType }, callback),
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
