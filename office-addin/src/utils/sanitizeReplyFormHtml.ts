import DOMPurify from "dompurify";

// Outbound-grade sanitization for model-produced HTML fragments handed to
// Office.js displayReplyForm(Async). Deliberately STRICTER than the in-chat
// preview (`sanitizeHtmlPreview`): the output becomes the user's draft, so
// only basic text structure and plain http(s)/mailto/tel links survive — no
// style tags or attributes, no images, no tables-as-layout tricks, nothing
// that could visually spoof content in the composed email.
const ALLOWED_TAGS = [
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "p",
  "br",
  "hr",
  "div",
  "span",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "code",
];

const ALLOWED_ATTR = ["href"];

const ALLOWED_URI_REGEXP = /^(?:https?|mailto|tel):/i;

export function sanitizeReplyFormHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
  });
}
