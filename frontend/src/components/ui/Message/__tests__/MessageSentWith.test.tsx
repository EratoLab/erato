import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { MessageSentWith } from "../MessageSentWith";

import type { SentWithChip } from "@/utils/chat/sentWith";
import type { Messages } from "@lingui/core";

const chips: SentWithChip[] = [
  {
    id: "word.document",
    kind: "word.document",
    icon: "document",
    label: "Supply agreement.docx",
    meta: "86 ¶",
  },
  {
    id: "word.selection",
    kind: "word.selection",
    icon: "selection",
    label: "“The Supplier shall …”",
  },
];

const renderRow = (items: readonly SentWithChip[]) =>
  render(
    <I18nProvider i18n={i18n}>
      <MessageSentWith chips={items} />
    </I18nProvider>,
  );

describe("MessageSentWith", () => {
  beforeAll(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("labels the list and reads each chip as its label and meta", () => {
    renderRow(chips);
    const list = screen.getByRole("list", { name: "Sent with" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Supply agreement.docx, 86 ¶",
      "“The Supplier shall …”",
    ]);
    expect(items[0]).toHaveAttribute("title", "Supply agreement.docx · 86 ¶");
    expect(items[1]).toHaveAttribute("title", "“The Supplier shall …”");
    expect(items[0]).toHaveAttribute("data-kind", "word.document");
  });

  it("is read-only: no buttons and no tab stops", () => {
    const { container } = renderRow(chips);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(0);
  });

  it("hides the glyphs from screen readers", () => {
    const { container } = renderRow(chips);
    const glyphs = container.querySelectorAll(
      '[data-ui="message-sent-with-chip"] svg',
    );
    expect(glyphs.length).toBe(2);
    glyphs.forEach((glyph) => {
      expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
    });
  });

  it("renders nothing without chips", () => {
    const { container } = renderRow([]);
    expect(container).toBeEmptyDOMElement();
  });
});
