import DOMPurify from "dompurify";

const PREVIEW_FORBID_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
];

const PREVIEW_FORBID_ATTR = ["onerror", "onload", "onclick", "onmouseover"];

/**
 * Sanitizes a model-produced HTML fragment before rendering it inside an email
 * suggestion preview. This keeps lightweight email formatting while removing
 * active content and unsafe attributes.
 */
export function sanitizeHtmlPreview(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: PREVIEW_FORBID_TAGS,
    FORBID_ATTR: PREVIEW_FORBID_ATTR,
  });
}
