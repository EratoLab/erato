import { i18n } from "@lingui/core";
import { act, fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  ApprovalReferent,
  ApprovalTechnicalDetails,
} from "@/components/ui/Message/ApprovalReferent";
import { ToolUseStep } from "@/components/ui/Trace/steps/ToolUseStep";
import calls from "@/lib/toolCallGist/fixtures/spokenCards/calls.json";
import { messages as deMessages } from "@/locales/de/messages.json";
import { messages as enMessages } from "@/locales/en/messages.json";

import { renderTree } from "./hostTree";
import { formatNumber } from "./polyfills";
import { toAdaptiveElements } from "./toAdaptiveCard";
import { approvalItem, loadCatalogs, resultRow } from "./toolCallCards";

import type { AcElement } from "./toAdaptiveCard";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => undefined,
}));

interface FixtureCall {
  id: string;
  tool_name: string;
  server_id: string;
  input: unknown;
  display: unknown;
}

const fixtureCalls = (calls as unknown as { calls: FixtureCall[] }).calls;

/** What a reader sees on the web, with every disclosure opened. */
const visibleText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.tagName === "svg" || node.classList.contains("sr-only")) return "";
  if (node.style.gridTemplateRows === "0fr") return "";
  return [...node.childNodes].map(visibleText).join("");
};

const openAll = async (container: HTMLElement) => {
  for (let round = 0; round < 8; round++) {
    const closed = [
      ...container.querySelectorAll<HTMLElement>(
        "button[aria-expanded='false'][aria-controls]",
      ),
    ];
    if (closed.length === 0) return;
    for (const button of closed) {
      await act(async () => {
        fireEvent.click(button);
      });
    }
  }
};

const isHint = (element: AcElement) =>
  element.type === "Container" &&
  typeof element.id === "string" &&
  /h\d+$/.test(element.id);

/** What the card says, in order, leaving out hints a web reader no longer sees once open. */
const cardText = (elements: AcElement[]): string =>
  elements
    .map((element): string => {
      if (isHint(element)) return "";
      switch (element.type) {
        case "RichTextBlock":
          return (element.inlines as { text: string }[])
            .map((run) => run.text)
            .join("");
        case "ColumnSet":
          return (element.columns as { items: AcElement[] }[])
            .map((column) => cardText(column.items))
            .join("");
        case "Container":
          return cardText(element.items as AcElement[]);
        case "ActionSet":
          return (element.actions as { title: string }[])
            .map((action) => action.title)
            .join("");
        default:
          return "";
      }
    })
    .join("");

/**
 * Spaces, and the marks a browser draws itself (quotes around `<q>`, list
 * bullets), differ by surface, not the words.
 */
const comparable = (text: string) =>
  text.replace(/[\s\u201c\u201d\u201e\u00ab\u00bb\u2022]/g, "");

const itemProps = (call: FixtureCall) => ({
  toolName: call.tool_name,
  display: call.display as never,
  input: call.input,
  serverId: call.server_id,
  isClientTool: false,
});

const part = (call: FixtureCall, status: "success" | "error"): ToolUse =>
  ({
    tool_call_id: `call-${call.id}`,
    tool_name: call.tool_name,
    status,
    input: call.input,
    output:
      status === "error" ? { error: "The record is locked." } : { ok: true },
    display: call.display,
  }) as unknown as ToolUse;

beforeAll(() => {
  loadCatalogs({
    en: enMessages as unknown as Messages,
    de: deMessages as unknown as Messages,
  });
});

describe("tool call cards for Adaptive Card surfaces", () => {
  describe.each(["en", "de"])("say what the web card says (%s)", (locale) => {
    it.each(fixtureCalls.map((call) => [call.id, call] as const))(
      "%s",
      async (_id, call) => {
        const card = approvalItem({
          locale,
          toolName: call.tool_name,
          display: call.display,
          input: call.input,
          serverId: call.server_id,
        });
        expect(card.errors).toEqual([]);
        expect(card.kind).not.toBe("legacy");

        i18n.activate(locale);
        const referent = render(<ApprovalReferent {...itemProps(call)} />);
        await openAll(referent.container);
        expect(comparable(cardText(card.referent))).toBe(
          comparable(visibleText(referent.container)),
        );
        referent.unmount();

        const details = render(
          <ApprovalTechnicalDetails {...itemProps(call)} />,
        );
        await openAll(details.container);
        expect(comparable(cardText(card.details))).toBe(
          comparable(visibleText(details.container)),
        );
        details.unmount();

        for (const status of ["success", "error"] as const) {
          const row = resultRow({ locale, part: part(call, status) });
          expect(row.errors).toEqual([]);
          i18n.activate(locale);
          const web = render(
            <ToolUseStep
              part={{ ...part(call, status), content_type: "tool_use" }}
              status={status === "success" ? "done" : "error"}
              isStreaming={false}
              isCollapsed
              isLastStep
            />,
          );
          expect(comparable(cardText(row.elements))).toBe(
            comparable(visibleText(web.container)),
          );
          web.unmount();
        }
      },
    );
  });

  it("puts the question, the facts and the decision words in the card's language", () => {
    const call = fixtureCalls.find((c) => c.id === "update-06-many-fields");
    if (!call) throw new Error("fixture missing");
    const card = approvalItem({
      locale: "de",
      toolName: call.tool_name,
      display: call.display,
      input: call.input,
      serverId: call.server_id,
    });
    expect(card.question).toBe("Aktion in Dynamics 365 ausführen?");
    expect(card.allowOnce).not.toBe("Allow once");
    expect(card.locale).toBe("de");
    expect(approvalItem({ locale: "xx", toolName: "t" }).locale).toBe("en");
  });

  it("keeps a label-less call on the surface's own card", () => {
    const card = approvalItem({
      locale: "en",
      toolName: "search",
      input: { q: "x" },
    });
    expect(card.kind).toBe("legacy");
  });
});

describe("toAdaptiveElements", () => {
  const map = (element: React.ReactNode) =>
    toAdaptiveElements(renderTree(element, true), {
      locale: "en",
      idPrefix: "x",
    });

  it("writes text only as TextRuns, so Markdown and HTML stay literal", () => {
    const elements = map(
      <p>{"**bold** [link](https://evil.example) <b>x</b>"}</p>,
    );
    expect(elements).toEqual([
      {
        type: "RichTextBlock",
        inlines: [
          {
            type: "TextRun",
            text: "**bold** [link](https://evil.example) <b>x</b>",
          },
        ],
      },
    ]);
  });

  it("makes links only of https URLs without user info", () => {
    const elements = map(
      <div>
        <a href="https://example.com/a">Open</a>
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- the unsafe link under test */}
        <a href="javascript:alert(1)">Script</a>
        <a href="https://user:pw@example.com">Creds</a>
      </div>,
    );
    expect(elements[0]).toEqual({
      type: "ActionSet",
      actions: [
        { type: "Action.OpenUrl", title: "Open", url: "https://example.com/a" },
      ],
    });
    expect(JSON.stringify(elements)).not.toContain("javascript:");
    expect(JSON.stringify(elements)).not.toContain("user:pw");
  });

  it("leaves out what a sighted reader does not see, and keeps visible aria-hidden text", () => {
    const elements = map(
      <p>
        <span className="sr-only">changes to</span>
        <span aria-hidden="true">→</span>
        <svg>
          <text>icon</text>
        </svg>
      </p>,
    );
    expect(JSON.stringify(elements)).not.toContain("changes to");
    expect(JSON.stringify(elements)).not.toContain("icon");
    expect(JSON.stringify(elements)).toContain("→");
  });

  it("styles struck-out and new values, and keeps their padding as a plain space", () => {
    const [block] = map(
      <p>
        <span className="px-1 text-[var(--theme-diff-removed-fg)] line-through">
          old
        </span>
        <span className="px-1">→</span>
        <span className="px-1 text-[var(--theme-diff-added-fg)]">new</span>
      </p>,
    );
    expect(block.inlines).toEqual([
      { type: "TextRun", text: "old", strikethrough: true, color: "Attention" },
      { type: "TextRun", text: " → " },
      { type: "TextRun", text: "new", color: "Good" },
    ]);
  });
});

describe("number formatting without Intl", () => {
  it.each([
    ["en", 1154, "1,154"],
    ["de", 1154, "1.154"],
    ["es", 1154, "1154"],
    ["es", 12345, "12.345"],
    ["pl", 1154, "1154"],
    ["fr", 1154, "1\u202f154"],
    ["de", 2.5, "2,5"],
  ])("%s %d", (language, value, expected) => {
    expect(formatNumber(language, value)).toBe(expected);
  });
});
