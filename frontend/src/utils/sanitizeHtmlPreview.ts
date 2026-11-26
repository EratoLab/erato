import DOMPurify from "dompurify";

export const EMAIL_DRAFT_TAGS = (
  "a b strong i em u s del ins sub sup span code p br hr div ul ol li " +
  "blockquote h1 h2 h3 h4 h5 h6 pre table caption thead tbody tfoot tr th td"
).split(" ");

// Structure an email does not need. Kept as plain blocks: unwrapped, their
// text would run into its neighbours.
export const EMAIL_DRAFT_PLAIN_BLOCK_TAGS = (
  "address article aside center dd details dl dt figcaption figure footer " +
  "header main nav section summary"
).split(" ");

const INLINE_TAGS = new Set(
  "A B STRONG I EM U S DEL INS SUB SUP SPAN CODE".split(" "),
);

const ATTRIBUTES_BY_TAG: Record<string, string[] | undefined> = {
  A: ["href"],
  OL: ["start"],
  TABLE: ["border", "cellpadding", "cellspacing"],
  TD: ["colspan", "rowspan"],
  TH: ["colspan", "rowspan"],
};
const ALLOWED_ATTRIBUTES = Object.values(ATTRIBUTES_BY_TAG).flatMap(
  (names) => names ?? [],
);

const ALLOWED_URI_REGEXP = /^(?:https?|mailto|tel):/i;

// Zero-width, direction-override, filler and tag characters: text nobody sees.
/* eslint-disable no-misleading-character-class -- single code points, none meant to combine */
const HIDDEN_CHARACTERS_RE =
  /[\u034F\u115F\u1160\u17B4\u17B5\u180E\u200B\u2060-\u2064\u206A-\u206F\u202A-\u202E\u2066-\u2069\u3164\uFE00-\uFE0E\uFEFF\uFFA0\u{1D173}-\u{1D17A}\u{E0000}-\u{E01EF}]/gu;
// In an address, also format characters and the spaces thinner than a space.
const UNSEEN_IN_ADDRESS_RE =
  /[\p{Cf}\u034F\u115F\u1160\u2000-\u200A\u202F\u205F\u3164\uFE00-\uFE0F\uFFA0]/gu;
/* eslint-enable no-misleading-character-class */
// A bare "name.ext" with one of these endings is a file, not a site.
const FILE_ENDING_RE =
  /\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|md|zip|png|jpe?g|gif|msg|eml|ics|json|xml|html?|js|ts)$/i;
const EDGE_CHARACTER_RE = /[\p{P}\p{S}\s]/u;

function isHtmlElementName(name: string): boolean {
  try {
    return (
      /^(?:svg|math)$/i.test(name) ||
      name.includes(":") ||
      (!name.includes("-") &&
        // "<Title>" or "<Time>" is a placeholder; tags are not written so.
        !/^[A-Z][a-z]/.test(name) &&
        !(document.createElement(name) instanceof HTMLUnknownElement))
    );
  } catch {
    return false;
  }
}

/**
 * "<Name>" or "<anna@example.com>" in a draft is text. The parser would take
 * it for a tag and the text would be gone.
 */
function escapeNonHtmlTags(html: string): string {
  return html.replace(
    /<(\/?)([a-z][^\s<>/]*)/gi,
    (match, slash: string, name: string) =>
      isHtmlElementName(name) ? match : `&lt;${slash}${name}`,
  );
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The address a link points to, as a reader would compare it. */
export function linkTargetDisplay(href: string): string {
  const mail = /^mailto:(.*)$/i.exec(href);
  let shown = href;
  if (mail) {
    shown = decoded(mail[1]);
  } else if (/^tel:/i.test(href)) {
    shown = href.slice(4);
  } else {
    try {
      // A look-alike host is shown in its encoded form.
      const url = new URL(href);
      shown = url.hostname.includes("xn--") ? url.href : href;
    } catch {
      // Shown as written.
    }
  }
  return shown.replace(HIDDEN_CHARACTERS_RE, "");
}

function trimEdgePunctuation(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && EDGE_CHARACTER_RE.test(word[start])) {
    start += 1;
  }
  while (end > start && EDGE_CHARACTER_RE.test(word[end - 1])) {
    end -= 1;
  }
  return word.slice(start, end);
}

/** National and international spellings of one number end in the same digits. */
function isSamePhoneNumber(a: string, b: string): boolean {
  const digits = (value: string) =>
    value.replace(/\(0\)/g, "").replace(/\D/g, "").replace(/^0+/, "");
  const [short, long] = [digits(a), digits(b)].sort(
    (x, y) => x.length - y.length,
  );
  return short.length >= 5 && long.endsWith(short);
}

function comparableAddress(value: string): string {
  return decoded(
    trimEdgePunctuation(value.replace(UNSEEN_IN_ADDRESS_RE, ""))
      .toLowerCase()
      .replace(/^(?:https?:\/\/|mailto:)/, "")
      .replace(/^www\./, ""),
  );
}

/** Whether a link's text names its own target, so the target adds nothing. */
export function linkTextNamesTarget(text: string, href: string): boolean {
  return /^tel:/i.test(href)
    ? isSamePhoneNumber(text, href)
    : comparableAddress(text) === comparableAddress(href);
}

interface Address {
  host: string;
  mailbox?: string;
}

function hostOf(url: string): string | null {
  try {
    const { hostname, username } = new URL(url);
    // "good.example@evil.example" reads as the part before the "@".
    const shown = username ? decoded(username) : hostname;
    return shown.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return null;
  }
}

function emailAddress(value: string): Address | null {
  const match = /^[^\s@/]+@([^\s@/]+\.[^\s@/.]{2,})$/.exec(value);
  const host = match && hostOf(`https://${match[1]}`);
  return host ? { host, mailbox: value.toLowerCase() } : null;
}

const WRITTEN_SCHEME_RE = /(?:https?|ftp):[\\/\u2215\u2044]*/i;

/**
 * The address a word of link text names, if a reader would take it for one.
 * A bare "name.tld" counts only when it is the whole text: inside a sentence
 * it is as often an abbreviation.
 */
function addressNamedBy(word: string, isWholeText: boolean): Address | null {
  const scheme = WRITTEN_SCHEME_RE.exec(word);
  const rest = scheme ? word.slice(scheme.index + scheme[0].length) : word;
  const email = scheme ? null : emailAddress(word.replace(/^mailto:/i, ""));
  if (email) {
    return email;
  }
  if (!scheme && !/^www\./i.test(word) && !isWholeText) {
    return null;
  }
  // What the parser refuses (a wrong port, stray brackets) still reads as a host.
  const host =
    hostOf(`https://${rest}`) ??
    hostOf(`https://${/^[\p{L}\p{N}.-]*/u.exec(rest)?.[0] ?? ""}`);
  if (!host) {
    return null;
  }
  if (scheme) {
    return { host };
  }
  const isFile = !/[/:?#]/.test(rest) && FILE_ENDING_RE.test(rest);
  const isSite =
    /\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(host) ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  return isSite && !isFile ? { host } : null;
}

function hrefAddress(href: string): Address | null {
  if (/^mailto:/i.test(href)) {
    return emailAddress(linkTargetDisplay(href));
  }
  const host = /^https?:/i.test(href) ? hostOf(href) : null;
  return host === null ? null : { host };
}

function isSameSite(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function linkTextNamesOtherAddress(link: Element, href: string): boolean {
  const copy = link.cloneNode(true) as Element;
  copy.querySelectorAll("*").forEach((element) => {
    if (!INLINE_TAGS.has(element.tagName)) {
      element.before(" ");
      element.after(" ");
    }
  });
  const text = (copy.textContent ?? "").replace(UNSEEN_IN_ADDRESS_RE, "");
  const words = text.split(/\s+/).map(trimEdgePunctuation).filter(Boolean);
  if (/^(?:\+|0|\()[\d\s()./-]{4,}$/.test(text.trim())) {
    // A phone number as text promises a call to that number.
    return !/^tel:/i.test(href) || !isSamePhoneNumber(text, href);
  }
  const target = hrefAddress(href);
  if (target === null) {
    return words.some((word) => addressNamedBy(word, words.length === 1));
  }
  return words.some((word) => {
    const named = addressNamedBy(word, words.length === 1);
    if (named === null) {
      return false;
    }
    return (
      !isSameSite(named.host, target.host) ||
      (named.mailbox !== undefined &&
        target.mailbox !== undefined &&
        named.mailbox !== target.mailbox)
    );
  });
}

/**
 * The address as the browser will follow it: it ignores tabs, newlines and
 * leading control characters, so the written form cannot be trusted.
 */
function cleanHref(link: Element): string | null {
  const written = link.getAttribute("href") ?? "";
  let url: URL;
  try {
    url = new URL(written);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:" || url.protocol === "tel:") {
    // A mailto query can add recipients or a text the reader never sees.
    return url.pathname ? url.protocol + url.pathname : null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  const isAsWritten =
    !url.username &&
    !url.password &&
    /^https?:\/\/[^\s\p{Cc}]*$/iu.test(written);
  url.username = "";
  url.password = "";
  return isAsWritten ? written : url.href;
}

function cleanLinks(body: HTMLElement, isGrowing: boolean): void {
  const links = Array.from(body.querySelectorAll("a"));
  // While a draft streams, its last link can still be growing.
  const growing = isGrowing ? links.at(-1) : undefined;
  links.forEach((link) => {
    if (!link.textContent?.trim()) {
      link.remove();
      return;
    }
    const href = cleanHref(link);
    if (href === null) {
      link.removeAttribute("href");
      return;
    }
    link.setAttribute("href", href);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    const target = ` (${linkTargetDisplay(href)})`;
    if (
      link !== growing &&
      !link.textContent.endsWith(target) &&
      linkTextNamesOtherAddress(link, href)
    ) {
      link.append(target);
    }
  });
}

function breaksLine(node: Node | null): boolean {
  return (
    node === null ||
    (node.nodeType === Node.ELEMENT_NODE && !INLINE_TAGS.has(node.nodeName))
  );
}

/**
 * Models often write paragraphs as newlines between text that sits outside
 * any block, which HTML would fold into one line. Such newlines turn into
 * <br> (a blank line into two) — never into <p>, which would split the
 * paragraph a selection rewrite lands in.
 */
function breakTopLevelNewlines(body: HTMLElement): void {
  Array.from(body.childNodes).forEach((node) => {
    const text = node.nodeType === Node.TEXT_NODE ? node.textContent : null;
    if (!text?.includes("\n")) {
      return;
    }
    const lines = text.split("\n");
    const last = lines.length - 1;
    const parts: (string | HTMLElement)[] = [];
    const atBlockStart = breaksLine(node.previousSibling);
    let breaks = 0;
    const addBreaks = () => {
      for (let count = Math.min(breaks, 2); count > 0; count -= 1) {
        parts.push(body.ownerDocument.createElement("br"));
      }
      breaks = 0;
    };
    lines.forEach((raw, index) => {
      const line =
        index === 0
          ? raw.trimEnd()
          : index === last
            ? raw.trimStart()
            : raw.trim();
      breaks += index > 0 ? 1 : 0;
      if (!line.trim()) {
        return;
      }
      if (parts.length > 0 || !atBlockStart) {
        addBreaks();
      }
      breaks = 0;
      parts.push(line);
    });
    if ((parts.length > 0 || !atBlockStart) && !breaksLine(node.nextSibling)) {
      addBreaks();
    }
    // Not spread into one call: a long draft has more lines than a call takes.
    const fragment = body.ownerDocument.createDocumentFragment();
    parts.forEach((part) => fragment.append(part));
    (node as Text).replaceWith(fragment);
  });
}

/**
 * The one cleaner for an email draft written by the model: what the card
 * shows, what is inserted or prefilled and what is copied. The draft can be
 * steered by the email it answers, so this is an allowlist: text structure,
 * tables and http(s)/mailto/tel links only — nothing that loads a remote
 * resource, nothing that styles or hides text. A link whose text reads as an
 * address other than its target also shows the target.
 */
export function sanitizeHtmlPreview(
  html: string,
  options: { isStreaming?: boolean } = {},
): string {
  const body = DOMPurify.sanitize(escapeNonHtmlTags(html), {
    ALLOWED_TAGS: [...EMAIL_DRAFT_TAGS, ...EMAIL_DRAFT_PLAIN_BLOCK_TAGS],
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    ALLOWED_URI_REGEXP,
    // Without this, every attribute value has to pass the address pattern.
    ADD_URI_SAFE_ATTR: ALLOWED_ATTRIBUTES.filter((name) => name !== "href"),
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM: true,
  }) as HTMLElement | null;
  if (body === null) {
    return "";
  }
  const doc = body.ownerDocument;

  body
    .querySelectorAll(EMAIL_DRAFT_PLAIN_BLOCK_TAGS.join(","))
    .forEach((element) => {
      const block = doc.createElement("div");
      while (element.firstChild) {
        block.append(element.firstChild);
      }
      element.replaceWith(block);
    });
  body.querySelectorAll("*").forEach((element) => {
    const kept = ATTRIBUTES_BY_TAG[element.tagName] ?? [];
    element
      .getAttributeNames()
      .filter((name) => !kept.includes(name))
      .forEach((name) => element.removeAttribute(name));
  });
  cleanLinks(body, options.isStreaming === true);
  const texts = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (texts.nextNode()) {
    const text = texts.currentNode.textContent ?? "";
    const visible = text.replace(HIDDEN_CHARACTERS_RE, "");
    if (visible !== text) {
      texts.currentNode.textContent = visible;
    }
  }
  breakTopLevelNewlines(body);
  return body.innerHTML;
}
