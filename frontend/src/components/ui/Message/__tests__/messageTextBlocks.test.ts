import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EXPLAIN_SLOT_TAG,
  rangeFromMessageTextAnchor,
  rehypeMessageTextBlocks,
  resolveMessageTextSelection,
} from "../messageTextBlocks";

const LIST_HTML = `
  <div data-message-id="m1" data-ui="chat-message">
    <article data-ui="message-content">
      <div data-ui="trace">Tool call row</div>
      <p data-text-block="0:0">First <strong>bold</strong> paragraph.</p>
      <p data-text-block="0:1">Second paragraph.</p>
      <div><pre data-text-block="0:2"><div><code class="language-ts">const a = 1;</code></div></pre></div>
      <div data-ui="message-explain">
        <article data-ui="message-content"><p>An explanation.</p></article>
      </div>
    </article>
    <div><button>Copy message</button><span>2 minutes ago</span></div>
  </div>
  <div data-message-id="m2" data-ui="chat-message">
    <article data-ui="message-content">
      <p data-text-block="0:0">Other message.</p>
    </article>
  </div>
`;

let list: HTMLElement;

const textNode = (selector: string, index = 0): Text => {
  const walker = document.createTreeWalker(
    list.querySelector(selector)!,
    NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();
  for (let step = 0; step < index && node; step += 1) {
    node = walker.nextNode();
  }
  return node as Text;
};

const select = (
  start: [Node, number],
  end: [Node, number],
): Selection | null => {
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return selection;
};

beforeEach(() => {
  list = document.createElement("div");
  list.innerHTML = LIST_HTML;
  document.body.appendChild(list);
});

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  list.remove();
});

describe("resolveMessageTextSelection", () => {
  it("resolves text marked inside one block of one message", () => {
    const bold = textNode('[data-message-id="m1"] strong');
    const marked = resolveMessageTextSelection(
      select([bold, 0], [bold, 4]),
      list,
    );

    expect(marked).toMatchObject({
      messageId: "m1",
      text: "bold",
      anchor: {
        startBlock: "0:0",
        startOffset: 6,
        endBlock: "0:0",
        endOffset: 10,
      },
      code: null,
    });
  });

  it("resolves a selection across two blocks to the block it ends in", () => {
    const first = textNode('[data-message-id="m1"] [data-text-block="0:0"]');
    const second = textNode('[data-message-id="m1"] [data-text-block="0:1"]');
    const marked = resolveMessageTextSelection(
      select([first, 0], [second, 6]),
      list,
    );

    expect(marked?.anchor).toEqual({
      startBlock: "0:0",
      startOffset: 0,
      endBlock: "0:1",
      endOffset: 6,
    });
  });

  it("ends in the marked block when the range stops at the start of the next one", () => {
    const first = textNode('[data-message-id="m1"] [data-text-block="0:0"]');
    const secondBlock = list.querySelector(
      '[data-message-id="m1"] [data-text-block="0:1"]',
    )!;
    const marked = resolveMessageTextSelection(
      select([first, 0], [secondBlock, 0]),
      list,
    );

    expect(marked?.anchor.endBlock).toBe("0:0");
    expect(marked?.anchor.endOffset).toBe("First bold paragraph.".length);
  });

  it("names the language of a selection inside one code block", () => {
    const code = textNode('[data-message-id="m1"] code');
    const marked = resolveMessageTextSelection(
      select([code, 0], [code, 5]),
      list,
    );

    expect(marked).toMatchObject({ text: "const", code: { language: "ts" } });
  });

  it("is not message text when the selection spans two messages", () => {
    const first = textNode('[data-message-id="m1"] [data-text-block="0:1"]');
    const other = textNode('[data-message-id="m2"] [data-text-block="0:0"]');

    expect(
      resolveMessageTextSelection(select([first, 0], [other, 5]), list),
    ).toBeNull();
  });

  it("is not message text when it covers a tool-call row, a button or a timestamp", () => {
    const trace = textNode('[data-ui="trace"]');
    const first = textNode('[data-message-id="m1"] [data-text-block="0:0"]');
    const second = textNode('[data-message-id="m1"] [data-text-block="0:1"]');
    const timestamp = textNode('[data-message-id="m1"] span');

    expect(
      resolveMessageTextSelection(select([trace, 0], [first, 5]), list),
    ).toBeNull();
    expect(
      resolveMessageTextSelection(select([trace, 0], [trace, 4]), list),
    ).toBeNull();
    expect(
      resolveMessageTextSelection(select([second, 0], [timestamp, 3]), list),
    ).toBeNull();
  });

  it("offers nothing inside the small chat of an explanation", () => {
    const explanation = textNode('[data-ui="message-explain"] p');

    expect(
      resolveMessageTextSelection(
        select([explanation, 0], [explanation, 5]),
        list,
      ),
    ).toBeNull();
  });

  it("ignores a collapsed selection and one outside the list", () => {
    const first = textNode('[data-message-id="m1"] [data-text-block="0:0"]');
    const elsewhere = document.createElement("div");

    expect(
      resolveMessageTextSelection(select([first, 2], [first, 2]), list),
    ).toBeNull();
    expect(
      resolveMessageTextSelection(select([first, 0], [first, 5]), elsewhere),
    ).toBeNull();
  });
});

describe("rangeFromMessageTextAnchor", () => {
  it("finds the passage again after the message was re-rendered around it", () => {
    const first = textNode('[data-message-id="m1"] [data-text-block="0:0"]');
    const second = textNode('[data-message-id="m1"] [data-text-block="0:1"]');
    const marked = resolveMessageTextSelection(
      select([first, 6], [second, 6]),
      list,
    )!;
    const root = list.querySelector<HTMLElement>(
      '[data-message-id="m1"] > [data-ui="message-content"]',
    )!;
    root
      .querySelector('[data-text-block="0:1"]')!
      .insertAdjacentHTML("afterend", "<div>A card</div>");

    const range = rangeFromMessageTextAnchor(root, marked.anchor);

    expect(range?.toString().replace(/\s+/g, " ")).toBe(
      "bold paragraph. Second",
    );
  });

  it("gives no range when the block is gone", () => {
    const root = list.querySelector<HTMLElement>(
      '[data-message-id="m2"] [data-ui="message-content"]',
    )!;

    expect(
      rangeFromMessageTextAnchor(root, {
        startBlock: "0:4",
        startOffset: 0,
        endBlock: "0:4",
        endOffset: 3,
      }),
    ).toBeNull();
  });
});

describe("rehypeMessageTextBlocks", () => {
  const paragraph = () => ({
    type: "element",
    tagName: "p",
    properties: {} as Record<string, unknown>,
    children: [],
  });

  it("keys the top-level blocks and puts the card slot after the named one", () => {
    const tree = {
      type: "root",
      children: [
        paragraph(),
        { type: "text", value: "\n" },
        paragraph(),
        paragraph(),
      ],
    };

    rehypeMessageTextBlocks({ prefix: "2", slotAfter: "2:1" })(tree);

    expect(
      tree.children.map((child) =>
        "tagName" in child
          ? [child.tagName, child.properties.dataTextBlock]
          : child.type,
      ),
    ).toEqual([
      ["p", "2:0"],
      "text",
      ["p", "2:1"],
      [EXPLAIN_SLOT_TAG, undefined],
      ["p", "2:2"],
    ]);
  });
});
