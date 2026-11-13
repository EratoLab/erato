/* eslint-disable lingui/no-unlocalized-strings -- DOM attribute names and selectors */

/**
 * "The text of one message", decided the same way in every layout: the root of
 * `MessageContent` carries `data-ui="message-content"`, and each top-level
 * block of its rendered markdown carries `data-text-block`. Everything else
 * inside a message (controls, timestamps, attachments, tool-call rows, cards)
 * carries neither, so a selection that touches it is not message text.
 */
export const MESSAGE_CONTENT_DATA_UI = "message-content";
export const MESSAGE_EXPLAIN_DATA_UI = "message-explain";
export const TEXT_BLOCK_ATTRIBUTE = "data-text-block";
export const EXPLAIN_SLOT_TAG = "erato-explain-slot";

const MESSAGE_CONTENT_SELECTOR = `[data-ui="${MESSAGE_CONTENT_DATA_UI}"]`;
const TEXT_BLOCK_SELECTOR = `[${TEXT_BLOCK_ATTRIBUTE}]`;

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface MessageTextBlocksOptions {
  /** Distinguishes the text parts of one message. */
  prefix: string;
  /** Block key after which the Explain card is rendered. */
  slotAfter?: string | null;
}

/**
 * Rehype plugin: keys every top-level block, and puts the slot element for the
 * Explain card after the block named by `slotAfter`. It runs after
 * sanitizing, which would strip both.
 */
export function rehypeMessageTextBlocks({
  prefix,
  slotAfter,
}: MessageTextBlocksOptions) {
  return (tree: HastNode) => {
    let ordinal = 0;
    const children: HastNode[] = [];
    for (const child of tree.children ?? []) {
      children.push(child);
      if (child.type !== "element") {
        continue;
      }
      const key = `${prefix}:${ordinal}`;
      ordinal += 1;
      child.properties = { ...child.properties, dataTextBlock: key };
      if (key === slotAfter) {
        children.push({
          type: "element",
          tagName: EXPLAIN_SLOT_TAG,
          properties: {},
          children: [],
        });
      }
    }
    tree.children = children;
  };
}

/** Where a passage sits, in terms that survive the message being re-rendered. */
export interface MessageTextAnchor {
  startBlock: string;
  /** Characters of the start block's text before the passage. */
  startOffset: number;
  endBlock: string;
  /** Characters of the end block's text up to the end of the passage. */
  endOffset: number;
}

export interface MessageTextSelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MessageTextSelection {
  messageId: string;
  text: string;
  anchor: MessageTextAnchor;
  /** First marked line across, first to last marked line down. */
  rect: MessageTextSelectionRect;
  /** Set when the whole passage lies inside one code block. */
  code: { language?: string } | null;
}

const elementOf = (node: Node | null): Element | null =>
  node instanceof Element ? node : (node?.parentElement ?? null);

const textBlockOf = (node: Node | null): Element | null =>
  elementOf(node)?.closest(TEXT_BLOCK_SELECTOR) ?? null;

interface SelectedText {
  node: Text;
  start: number;
  end: number;
}

function selectedTextNodes(range: Range): SelectedText[] {
  const scope = elementOf(range.commonAncestorContainer);
  if (!scope) {
    return [];
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const selected: SelectedText[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!range.intersectsNode(text)) {
      continue;
    }
    const start = text === range.startContainer ? range.startOffset : 0;
    const end = text === range.endContainer ? range.endOffset : text.length;
    // A boundary that only touches a node, or whitespace between blocks,
    // selects nothing a reader would call text.
    if (text.data.slice(start, end).trim() !== "") {
      selected.push({ node: text, start, end });
    }
  }
  return selected;
}

function offsetInBlock(block: Element, target: Text, offset: number): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === target) {
      return total + offset;
    }
    total += (node as Text).length;
  }
  return total;
}

function selectionRect(
  range: Range,
  fallback: Element,
): MessageTextSelectionRect {
  // jsdom has no layout, and so no client rects on a range.
  const lines =
    typeof range.getClientRects === "function"
      ? Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0 && rect.height > 0,
        )
      : [];
  const first = lines.at(0) ?? fallback.getBoundingClientRect();
  const last = lines.at(-1) ?? first;
  return {
    top: first.top,
    bottom: last.bottom,
    left: first.left,
    right: first.right,
  };
}

/**
 * The selection as marked message text, or null when it is anything else:
 * collapsed, outside `container`, across two messages, or touching something
 * that is not the text of the message.
 */
export function resolveMessageTextSelection(
  selection: Selection | null,
  container: Element,
): MessageTextSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const text = selection.toString().trim();
  if (text === "") {
    return null;
  }
  const range = selection.getRangeAt(0);
  const selected = selectedTextNodes(range);
  const first = selected.at(0);
  const last = selected.at(-1);
  const startBlock = textBlockOf(first?.node ?? null);
  const endBlock = textBlockOf(last?.node ?? null);
  if (!first || !last || !startBlock || !endBlock) {
    return null;
  }

  const root = startBlock.closest(MESSAGE_CONTENT_SELECTOR);
  if (
    !root ||
    !container.contains(root) ||
    root.closest(`[data-ui="${MESSAGE_EXPLAIN_DATA_UI}"]`)
  ) {
    return null;
  }
  const allInMessageText = selected.every(
    ({ node }) => textBlockOf(node)?.closest(MESSAGE_CONTENT_SELECTOR) === root,
  );
  const messageId = root
    .closest("[data-message-id]")
    ?.getAttribute("data-message-id");
  if (!allInMessageText || !messageId) {
    return null;
  }

  const pre = first.node.parentElement?.closest("pre");
  const isCode = !!pre && pre.contains(last.node);
  const language = isCode
    ? /language-([\w-]+)/.exec(
        pre.querySelector('code[class*="language-"]')?.className ?? "",
      )?.[1]
    : undefined;

  return {
    messageId,
    text,
    anchor: {
      startBlock: startBlock.getAttribute(TEXT_BLOCK_ATTRIBUTE) ?? "",
      startOffset: offsetInBlock(startBlock, first.node, first.start),
      endBlock: endBlock.getAttribute(TEXT_BLOCK_ATTRIBUTE) ?? "",
      endOffset: offsetInBlock(endBlock, last.node, last.end),
    },
    rect: selectionRect(range, startBlock),
    code: isCode ? { language } : null,
  };
}

function boundaryInBlock(
  root: Element,
  blockKey: string,
  offset: number,
): { node: Text; offset: number } | null {
  const block = Array.from(root.querySelectorAll(TEXT_BLOCK_SELECTOR)).find(
    (candidate) =>
      candidate.getAttribute(TEXT_BLOCK_ATTRIBUTE) === blockKey &&
      candidate.closest(MESSAGE_CONTENT_SELECTOR) === root,
  );
  if (!block) {
    return null;
  }
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let lastText: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (remaining <= text.length) {
      return { node: text, offset: remaining };
    }
    remaining -= text.length;
    lastText = text;
  }
  return lastText ? { node: lastText, offset: lastText.length } : null;
}

/** The passage as a live range in the message as it is rendered now. */
export function rangeFromMessageTextAnchor(
  root: Element,
  anchor: MessageTextAnchor,
): Range | null {
  const start = boundaryInBlock(root, anchor.startBlock, anchor.startOffset);
  const end = boundaryInBlock(root, anchor.endBlock, anchor.endOffset);
  if (!start || !end) {
    return null;
  }
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range.collapsed ? null : range;
}
