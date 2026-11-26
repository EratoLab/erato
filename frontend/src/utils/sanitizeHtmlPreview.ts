import DOMPurify from "dompurify";

const ALLOWED_TAGS = (
  "a b strong i em u s p br hr div span ul ol li blockquote h1 h2 h3 h4 h5 h6 " +
  "pre code table thead tbody tfoot tr th td"
).split(" ");

const ALLOWED_ATTR = ["href"];

const ALLOWED_URI_REGEXP = /^(?:https?|mailto|tel):/i;

// Text a reader takes for an address: a URL with a scheme, a www. host, a
// bare domain or an email address.
const ADDRESS_LIKE_TEXT_RE =
  /^(?:[a-z][a-z0-9+.-]*:\S+|www\.\S+|[^\s@/]+\.[a-z]{2,}(?:[/?#]\S*)?|[^\s@]+@[^\s@]+\.[^\s@]+)$/i;

/** The address a link points to, as a reader would compare it. */
export function linkTargetDisplay(href: string): string {
  return href.replace(/^(?:mailto|tel):/i, "");
}

function comparableAddress(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/|mailto:|tel:)/, "")
    .replace(/\/$/, "");
}

/** Whether a link's text names its own target, so the target adds nothing. */
export function linkTextNamesTarget(text: string, href: string): boolean {
  return comparableAddress(text) === comparableAddress(href);
}

/**
 * The one cleaner for an email draft written by the model: what the card
 * shows, what is inserted into or prefilled in Outlook and what is copied.
 * The draft can be steered by the email it answers, so this is an allowlist:
 * text structure, tables without attributes and http(s)/mailto/tel links
 * only — nothing that loads a remote resource, nothing that styles or hides
 * text. A link whose text reads as a different address shows its real target.
 */
export function sanitizeHtmlPreview(html: string): string {
  const body = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM: true,
  }) as HTMLElement;
  body.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    const text = (link.textContent ?? "").trim();
    if (ADDRESS_LIKE_TEXT_RE.test(text) && !linkTextNamesTarget(text, href)) {
      link.textContent = linkTargetDisplay(href);
    }
  });
  return body.innerHTML;
}
