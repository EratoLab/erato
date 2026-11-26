import { sanitizeHtmlPreview } from "@erato/frontend/library";

/**
 * Cleans a model-produced HTML draft for Office.js displayReplyForm(Async)
 * with the same cleaner as the card, so the prefilled reply holds exactly
 * what the user saw.
 */
export function sanitizeReplyFormHtml(html: string): string {
  return sanitizeHtmlPreview(html);
}
