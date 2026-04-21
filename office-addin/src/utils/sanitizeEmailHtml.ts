import DOMPurify from "dompurify";

// Email HTML carries inline <style> blocks, table-based layouts, and inline
// images via cid: / data: URIs. We must preserve all of those for fidelity, so
// this config is intentionally more permissive than sanitizeHtmlPreview in the
// frontend (which strips <style> because it sanitizes model-produced fragments,
// not full email bodies).
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto|tel|cid|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const FORBID_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "link",
  "form",
];

const FORBID_ATTR = ["srcset", "ping", "formaction"];

export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["style"],
    ADD_ATTR: ["target"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP,
    FORBID_TAGS,
    FORBID_ATTR,
  });
}

// Embedded in the generated <head> as defense-in-depth: if a user opens the
// downloaded .html attachment standalone in a browser, this blocks script
// execution and external resource loads even if sanitization missed something.
// `sandbox` and `frame-ancestors` are ignored in <meta> per spec, so they're
// omitted here.
export const EMAIL_BODY_CSP =
  "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
