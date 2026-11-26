import DOMPurify from "dompurify";

const ALLOWED_TAGS = (
  "a b strong i em u s p br hr div span ul ol li blockquote h1 h2 h3 h4 h5 h6 " +
  "pre code table thead tbody tfoot tr th td"
).split(" ");

const ALLOWED_ATTR = ["href"];

const ALLOWED_URI_REGEXP = /^(?:https?|mailto|tel):/i;

/** The address a link points to, as a reader would compare it. */
export function linkTargetDisplay(href: string): string {
  return href.replace(/^(?:mailto|tel):/i, "");
}

function comparableAddress(value: string): string {
  const address = value
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/|mailto:)/, "")
    .replace(/\/$/, "");
  return /^(?:tel:)?[+\d\s().-]+$/.test(address)
    ? address.replace(/[^+\d]/g, "")
    : address;
}

/** Whether a link's text names its own target, so the target adds nothing. */
export function linkTextNamesTarget(text: string, href: string): boolean {
  return comparableAddress(text) === comparableAddress(href);
}

// Zero-width, bidi and soft-hyphen characters a reader does not see.
const INVISIBLE_RE = /\p{Cf}/gu;
const WORD_EDGE_PUNCTUATION_RE = /^[<>()[\]{}"'.,;:!?]+|[<>()[\]{}"'.,;:!?]+$/g;
const EMAIL_RE = /^[^\s@/]+@([^\s@/]+\.[a-z]{2,})$/i;
const URL_WITH_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const HOST_LIKE_RE = /^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;
const FILE_EXTENSION_RE =
  /\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|zip|png|jpe?g|gif)$/i;

interface Address {
  host: string;
  mailbox?: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The address a word of link text names, if a reader would take it for one. */
function addressInWord(word: string): Address | null {
  const bare = word.replace(/^mailto:/i, "");
  const email = EMAIL_RE.exec(bare);
  if (email) {
    return { host: email[1].toLowerCase(), mailbox: bare.toLowerCase() };
  }
  if (URL_WITH_SCHEME_RE.test(word)) {
    const host = hostOf(word);
    return host === null ? null : { host };
  }
  const isFileName = !/[/?#]/.test(word) && FILE_EXTENSION_RE.test(word);
  if (HOST_LIKE_RE.test(word) && !isFileName) {
    const host = hostOf(`http://${word}`);
    return host === null ? null : { host };
  }
  return null;
}

function hrefAddress(href: string): Address | null {
  const mail = /^mailto:([^?]*)/i.exec(href.trim());
  if (mail) {
    let mailbox = mail[1];
    try {
      mailbox = decodeURIComponent(mailbox);
    } catch {
      // A malformed escape stays as written.
    }
    mailbox = mailbox.toLowerCase();
    return { host: mailbox.split("@").pop() ?? "", mailbox };
  }
  return /^https?:/i.test(href.trim())
    ? { host: hostOf(href.trim()) ?? "" }
    : null;
}

/**
 * Whether link text names an address other than the link's target: a
 * different host (a leading "www." aside), or a different mailbox when both
 * are email addresses.
 */
function linkTextNamesOtherAddress(text: string, href: string): boolean {
  const target = hrefAddress(href);
  const namesOther = (named: Address | null): boolean => {
    if (named === null) {
      return false;
    }
    if (named.host !== target?.host) {
      return true;
    }
    return (
      named.mailbox !== undefined &&
      target.mailbox !== undefined &&
      named.mailbox !== target.mailbox
    );
  };
  return text
    .replace(INVISIBLE_RE, "")
    .split(/\s+/)
    .some((word) =>
      namesOther(addressInWord(word.replace(WORD_EDGE_PUNCTUATION_RE, ""))),
    );
}

const BLOCK_OR_BREAK_TAG_RE =
  /<\/?(?:p|div|br|ul|ol|li|blockquote|h[1-6]|table|thead|tbody|tfoot|tr|td|th|pre|hr|dl|dt|dd)\b/i;

/**
 * Models often write inline tags with paragraphs made of newlines, which HTML
 * would fold into one line. Without any block or <br> tag, such newlines turn
 * into <br> (a blank line into two) — never into <p>, which would split the
 * paragraph a selection rewrite lands in.
 */
function newlinesToBreaks(html: string): string {
  const trimmed = html.trim();
  if (!trimmed.includes("\n") || BLOCK_OR_BREAK_TAG_RE.test(trimmed)) {
    return html;
  }
  return trimmed
    .split(/(<[^<>]*>)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/\r\n?/g, "\n")
            .replace(/[ \t]*\n[ \t]*\n\s*/g, "<br><br>")
            .replace(/[ \t]*\n[ \t]*/g, "<br>"),
    )
    .join("");
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
  const body = DOMPurify.sanitize(newlinesToBreaks(html), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM: true,
  }) as HTMLElement;
  body.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (linkTextNamesOtherAddress(link.textContent ?? "", href)) {
      link.textContent = linkTargetDisplay(href);
    }
  });
  return body.innerHTML;
}
