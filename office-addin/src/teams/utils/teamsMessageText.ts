/**
 * Teams message body → plain text. HTML never reaches the transcript: an
 * HTML payload costs two orders of magnitude more tokens than its text.
 *
 * Teams HTML uses non-standard elements (`<at>`, `<attachment>`, `<emoji>`,
 * `<codeblock>`) that any sanitiser drops along with their attributes, taking
 * the markers with them. So this rewrites those elements into text or standard
 * HTML first and only then delegates to the library's `htmlToPlainText`, which
 * already owns block-boundary newlines, script/style skipping, entity decoding
 * and blank-line collapsing. The result is a string that never becomes DOM.
 */

import { htmlToPlainText, mapOutsideCodeFences } from "@erato/frontend/library";

import type {
  GraphChatMessageAttachment,
  GraphChatMessageBody,
} from "./teamsChatGraph";

export interface TeamsMessageTextOptions {
  attachments?: GraphChatMessageAttachment[];
}

export function teamsMessageBodyToText(
  body: GraphChatMessageBody | null | undefined,
  options: TeamsMessageTextOptions = {},
): string {
  const content = body?.content ?? "";
  if (content.trim().length === 0) return "";
  if (body?.contentType !== "html") {
    return normalizeText(content);
  }

  const doc = new DOMParser().parseFromString(content, "text/html");
  rewriteTeamsElements(doc.body, attachmentNamesById(options.attachments));
  return normalizeText(htmlToPlainText(doc.body.innerHTML));
}

/**
 * `img` sources in body order — the same order their `[image]` markers take in
 * the rendered text. Only Graph hosted-content URLs are fetchable with the
 * message-reading token; anything else (external stickers, data URIs) stays
 * null so occurrence indexes still line up.
 */
export function teamsBodyImageUrls(
  body: GraphChatMessageBody | null | undefined,
): (string | null)[] {
  const content = body?.content ?? "";
  if (body?.contentType !== "html" || content.length === 0) return [];
  const doc = new DOMParser().parseFromString(content, "text/html");
  return Array.from(doc.body.querySelectorAll("img")).map((element) => {
    const src = element.getAttribute("src") ?? "";
    return HOSTED_CONTENT_URL.test(src) ? src : null;
  });
}

const HOSTED_CONTENT_URL =
  /^https:\/\/graph\.microsoft\.com\/(?:v1\.0|beta)\/.+\/hostedContents\/[^/]+\/\$value$/;

/** Attachment ids referenced by an `<attachment>` element in the body. */
export function referencedAttachmentIds(
  body: GraphChatMessageBody | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  const content = body?.content ?? "";
  if (body?.contentType !== "html" || content.length === 0) return ids;
  const doc = new DOMParser().parseFromString(content, "text/html");
  for (const element of doc.body.querySelectorAll("attachment")) {
    const id = element.getAttribute("id");
    if (id) ids.add(id);
  }
  return ids;
}

function attachmentNamesById(
  attachments: GraphChatMessageAttachment[] | undefined,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const attachment of attachments ?? []) {
    if (attachment.id && attachment.name) {
      names.set(attachment.id, attachment.name);
    }
  }
  return names;
}

function rewriteTeamsElements(
  root: HTMLElement,
  attachmentNames: Map<string, string>,
): void {
  replaceWithText(root, "at", (element) => `@${element.textContent ?? ""}`);
  replaceWithText(
    root,
    "emoji",
    (element) => element.getAttribute("alt") ?? element.textContent ?? "",
  );
  replaceWithText(root, "attachment", (element) => {
    const id = element.getAttribute("id");
    const name = id ? attachmentNames.get(id) : undefined;
    return name ? `[attachment: ${name}]` : "[attachment]";
  });
  replaceWithText(root, "img", () => "[image]");

  // `<codeblock>` is Teams' own; normalise it to `<pre>` so both take the
  // same fencing pass below.
  for (const element of Array.from(root.querySelectorAll("codeblock"))) {
    const pre = element.ownerDocument.createElement("pre");
    pre.textContent = element.textContent ?? "";
    element.replaceWith(pre);
  }
  for (const element of Array.from(root.querySelectorAll("pre"))) {
    // Blank edges only: a trim would take the indentation of the first line
    // with it whenever the whole block is indented.
    const code = (element.textContent ?? "")
      .replace(/^(?:[ \t]*\n)+/, "")
      .replace(/\s+$/, "");
    element.textContent = `\n\`\`\`\n${code}\n\`\`\`\n`;
  }
  replaceWithText(
    root,
    "code",
    (element) => `\`${element.textContent ?? ""}\``,
  );

  for (const element of Array.from(root.querySelectorAll("a[href]"))) {
    const text = (element.textContent ?? "").trim();
    const href = unwrapSafeLink(element.getAttribute("href") ?? "");
    const rendered =
      href.length === 0 || href === text ? text : `${text} (${href})`;
    element.replaceWith(element.ownerDocument.createTextNode(rendered));
  }

  // Reverse document order visits nested quotes before their parents.
  for (const element of Array.from(
    root.querySelectorAll("blockquote"),
  ).reverse()) {
    const quoted = htmlToPlainText(element.innerHTML)
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
    element.replaceWith(element.ownerDocument.createTextNode(`\n${quoted}\n`));
  }
}

function replaceWithText(
  root: HTMLElement,
  selector: string,
  render: (element: Element) => string,
): void {
  for (const element of Array.from(root.querySelectorAll(selector))) {
    element.replaceWith(element.ownerDocument.createTextNode(render(element)));
  }
}

/** Tenants are served by regional subdomains, so the suffix is what matches. */
const SAFE_LINKS_HOST = "safelinks.protection.outlook.com";

/**
 * ATP rewrites every link through a Safe Links wrapper whose query string is
 * routinely longer than the message. The original url is a query parameter.
 *
 * Decided on the host, never on a substring of the whole url: the wrapper's
 * name sitting in anyone's path or query would otherwise let a message rewrite
 * its own link into whatever the transcript should show.
 */
function unwrapSafeLink(href: string): string {
  let wrapper: URL;
  try {
    wrapper = new URL(href);
  } catch {
    return href;
  }
  const host = wrapper.hostname.toLowerCase();
  if (host !== SAFE_LINKS_HOST && !host.endsWith(`.${SAFE_LINKS_HOST}`)) {
    return href;
  }
  return wrapper.searchParams.get("url") ?? href;
}

function normalizeText(text: string): string {
  return mapOutsideCodeFences(text.replace(/\r\n?/g, "\n"), (segment) =>
    segment.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n"),
  ).trim();
}
