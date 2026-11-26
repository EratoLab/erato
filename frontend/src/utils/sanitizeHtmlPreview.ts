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

// Zero-width, direction-override and Unicode tag characters: text nobody sees.
const HIDDEN_CHARACTERS_RE =
  /[\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/gu;
const UNSEEN_IN_ADDRESS_RE = /[\p{Cf}\u034F\uFE00-\uFE0F]/gu;
const EDGE_CHARACTER_RE = /[\p{P}\p{S}\s]/u;

function isHtmlElementName(name: string): boolean {
  try {
    return (
      /^(?:svg|math)$/i.test(name) ||
      (!name.includes("-") &&
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
  if (mail) {
    return decoded(mail[1]);
  }
  if (/^tel:/i.test(href)) {
    return href.slice(4);
  }
  try {
    // A look-alike host is shown in its encoded form.
    const url = new URL(href);
    return url.hostname.includes("xn--") ? url.href : href;
  } catch {
    return href;
  }
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

function comparableAddress(value: string): string {
  const address = trimEdgePunctuation(value.replace(UNSEEN_IN_ADDRESS_RE, ""))
    .toLowerCase()
    .replace(/^(?:https?:\/\/|mailto:|tel:)/, "")
    .replace(/^www\./, "");
  return /^[+\d\s().-]+$/.test(address)
    ? address.replace(/\D/g, "")
    : decoded(address);
}

/** Whether a link's text names its own target, so the target adds nothing. */
export function linkTextNamesTarget(text: string, href: string): boolean {
  return comparableAddress(text) === comparableAddress(href);
}

interface Address {
  host: string;
  mailbox?: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return null;
  }
}

function emailAddress(value: string): Address | null {
  const match = /^[^\s@/]+@([^\s@/]+\.[^\s@/.]{2,})$/.exec(value);
  const host = match && hostOf(`https://${match[1]}`);
  return host ? { host, mailbox: value.toLowerCase() } : null;
}

/**
 * The address a word of link text names, if a reader would take it for one.
 * A bare "name.tld" counts only when it is the whole text: inside a sentence
 * it is as often a file name or an abbreviation.
 */
function addressNamedBy(word: string, isWholeText: boolean): Address | null {
  const schemeAt = word.search(/https?:\/\//i);
  const url = schemeAt >= 0 ? word.slice(schemeAt) : word;
  const email =
    schemeAt < 0 ? emailAddress(word.replace(/^mailto:/i, "")) : null;
  if (email) {
    return email;
  }
  if (schemeAt < 0 && !/^www\./i.test(word) && !isWholeText) {
    return null;
  }
  const host = hostOf(schemeAt >= 0 ? url : `https://${word}`);
  const isHost =
    host !== null &&
    (/\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(host) ||
      /^\d{1,3}(?:\.\d{1,3}){3}(?:[:/]|$)/.test(word));
  return isHost ? { host } : null;
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
  copy.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
  const text = (copy.textContent ?? "").replace(UNSEEN_IN_ADDRESS_RE, "");
  const words = text.split(/\s+/).map(trimEdgePunctuation).filter(Boolean);
  const target = hrefAddress(href);
  if (target === null) {
    const isPhoneNumber = /^[+\d\s()./-]{5,}$/.test(text.trim());
    return isPhoneNumber
      ? !linkTextNamesTarget(text, href)
      : words.some((word) => addressNamedBy(word, words.length === 1));
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

function cleanHref(link: Element): string | null {
  const href = link.getAttribute("href")?.trim() ?? "";
  if (/^mailto:/i.test(href)) {
    // A query can add recipients or a prefilled text the reader never sees.
    return href.split("?")[0];
  }
  if (!/^https?:/i.test(href)) {
    return href || null;
  }
  try {
    const url = new URL(href);
    if (!url.username && !url.password) {
      return href;
    }
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return null;
  }
}

/** While a draft streams, its last link can still be growing. */
function endsInsideLink(html: string): boolean {
  const lastOpen =
    Array.from(html.matchAll(/<a(?:\s[^<>]*)?>/gi)).at(-1)?.index ?? -1;
  return lastOpen > html.toLowerCase().lastIndexOf("</a");
}

function cleanLinks(body: HTMLElement, html: string): void {
  const links = Array.from(body.querySelectorAll("a"));
  const growing = endsInsideLink(html) ? links.at(-1) : undefined;
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
    if (link !== growing && linkTextNamesOtherAddress(link, href)) {
      link.append(` (${linkTargetDisplay(href)})`);
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
    (node as Text).replaceWith(...parts);
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
export function sanitizeHtmlPreview(html: string): string {
  const body = DOMPurify.sanitize(escapeNonHtmlTags(html), {
    ALLOWED_TAGS: [...EMAIL_DRAFT_TAGS, ...EMAIL_DRAFT_PLAIN_BLOCK_TAGS],
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    ALLOWED_URI_REGEXP,
    // Without this, every attribute value has to pass the address pattern.
    ADD_URI_SAFE_ATTR: ALLOWED_ATTRIBUTES.filter((name) => name !== "href"),
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM: true,
  }) as HTMLElement;
  const doc = body.ownerDocument;

  body
    .querySelectorAll(EMAIL_DRAFT_PLAIN_BLOCK_TAGS.join(","))
    .forEach((element) => {
      const block = doc.createElement("div");
      block.append(...Array.from(element.childNodes));
      element.replaceWith(block);
    });
  body.querySelectorAll("*").forEach((element) => {
    const kept = ATTRIBUTES_BY_TAG[element.tagName] ?? [];
    element
      .getAttributeNames()
      .filter((name) => !kept.includes(name))
      .forEach((name) => element.removeAttribute(name));
  });
  const texts = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (texts.nextNode()) {
    const text = texts.currentNode.textContent ?? "";
    const visible = text.replace(HIDDEN_CHARACTERS_RE, "");
    if (visible !== text) {
      texts.currentNode.textContent = visible;
    }
  }
  cleanLinks(body, html);
  breakTopLevelNewlines(body);
  return body.innerHTML;
}
