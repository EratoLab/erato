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
import { AbsoluteUrl, formatNumber } from "./polyfills";
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

/**
 * What a reader sees on the web, clamped lines cut as the browser draws
 * them. `withToggles: false` leaves out the disclosure buttons' labels, which
 * the web changes once open and a Teams toggle cannot.
 */
const visibleText = (node: Node, withToggles = true): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.tagName === "svg" || node.classList.contains("sr-only")) return "";
  if (node.style.gridTemplateRows === "0fr") return "";
  if (!withToggles && node.matches("button[aria-controls]")) return "";
  const text = [...node.childNodes]
    .map((child) => visibleText(child, withToggles))
    .join("");
  const clamp = /(?:^|\s)line-clamp-(\d+)(?:\s|$)/.exec(node.className);
  const lines = text.split("\n");
  return clamp && lines.length > Number(clamp[1])
    ? lines.slice(0, Number(clamp[1])).join("\n")
    : text;
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

/** Hints show only while closed; a closed region's preview gives way to the whole. */
const closedOnly = (element: AcElement) =>
  element.type === "Container" &&
  typeof element.id === "string" &&
  /(h\d+|r\d+c)$/.test(element.id);

/**
 * What the card says, in order: `shown` before any toggle is pressed, `open`
 * with every toggle pressed.
 */
const cardText = (elements: AcElement[], state: "shown" | "open"): string =>
  elements
    .map((element): string => {
      if (state === "open" && closedOnly(element)) return "";
      if (state === "shown" && element.isVisible === false) return "";
      switch (element.type) {
        case "RichTextBlock":
          return (element.inlines as { text: string }[])
            .map((run) => run.text)
            .join("");
        case "ColumnSet":
          return (element.columns as { items: AcElement[] }[])
            .map((column) => cardText(column.items, state))
            .join("");
        case "Container":
          return cardText(element.items as AcElement[], state);
        case "ActionSet":
          return (element.actions as { type: string; title: string }[])
            .filter(
              (action) =>
                state === "shown" || action.type !== "Action.ToggleVisibility",
            )
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
  text.replace(/[\s\u201c\u201d\u201e\u00ab\u00bb\u2022\u2026]/g, "");

/** The web's text closed and with every disclosure opened. */
const webText = async (element: React.ReactElement) => {
  const view = render(element);
  const shown = visibleText(view.container);
  await openAll(view.container);
  const open = visibleText(view.container, false);
  view.unmount();
  return { shown, open };
};

const expectSameText = (
  elements: AcElement[],
  web: { shown: string; open: string },
) => {
  expect(comparable(cardText(elements, "shown"))).toBe(comparable(web.shown));
  expect(comparable(cardText(elements, "open"))).toBe(comparable(web.open));
};

const itemProps = (call: FixtureCall) => ({
  toolName: call.tool_name,
  display: call.display as never,
  input: call.input,
  serverId: call.server_id,
  isClientTool: false,
});

interface Outcome {
  output?: unknown;
  resultDetails?: unknown;
}

const part = (
  call: FixtureCall,
  status: "success" | "error",
  outcome: Outcome = {},
): ToolUse =>
  ({
    tool_call_id: `call-${call.id}`,
    tool_name: call.tool_name,
    status,
    input: call.input,
    output:
      outcome.output ??
      (status === "error" ? { error: "The record is locked." } : { ok: true }),
    result_details: outcome.resultDetails,
    display: call.display,
  }) as unknown as ToolUse;

const expectSameAsWeb = async (
  call: FixtureCall,
  locale: string,
  outcome: Outcome = {},
) => {
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
  expectSameText(
    card.referent,
    await webText(<ApprovalReferent {...itemProps(call)} />),
  );
  expectSameText(
    card.details,
    await webText(<ApprovalTechnicalDetails {...itemProps(call)} />),
  );
  for (const status of ["success", "error"] as const) {
    const row = resultRow({ locale, part: part(call, status, outcome) });
    expect(row.errors).toEqual([]);
    i18n.activate(locale);
    expectSameText(
      row.elements,
      await webText(
        <ToolUseStep
          part={{ ...part(call, status, outcome), content_type: "tool_use" }}
          status={status === "success" ? "done" : "error"}
          isStreaming={false}
          isCollapsed
          isLastStep
        />,
      ),
    );
  }
  return card;
};

const fixture = (id: string): FixtureCall => {
  const call = fixtureCalls.find((candidate) => candidate.id === id);
  if (!call) throw new Error(`fixture ${id} missing`);
  return JSON.parse(JSON.stringify(call)) as FixtureCall;
};

/** A note of twelve lines: the web shows six until "See the full text". */
const longNote = (): FixtureCall => {
  const call = fixture("create-09-note-very-long");
  const text = Array.from(
    { length: 12 },
    (_, line) => `Line ${line + 1} of the visit note.`,
  ).join("\n");
  (call.input as { item: { notetext: string } }).item.notetext = text;
  const label = (
    call.display as {
      label: { change: { texts: Record<string, unknown>[] } };
    }
  ).label;
  label.change.texts[0] = {
    ...label.change.texts[0],
    text,
    lines: 12,
    chars: text.length,
  };
  return call;
};

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
        await expectSameAsWeb(call, locale);
      },
    );

    it("a long text shows its first lines until the toggle shows the whole", async () => {
      const card = await expectSameAsWeb(longNote(), locale);
      const shown = cardText(card.referent, "shown");
      expect(shown).toContain("Line 1 of the visit note.");
      expect(shown).not.toContain("Line 12 of the visit note.");
      expect(cardText(card.referent, "open")).toContain(
        "Line 12 of the visit note.",
      );
    });

    it("a finished call keeps its result link, and a long failure its toggle", async () => {
      const call = fixture("create-01-task-long-description");
      await expectSameAsWeb(call, locale, {
        resultDetails: {
          links: [
            {
              uri: "https://example.com/tasks/1",
              title: "Technisches Layout abstimmen",
            },
          ],
        },
        output: Array.from(
          { length: 30 },
          (_, line) =>
            `Line ${line + 1}: the record is locked by another user.`,
        ).join("\n"),
      });
      const row = resultRow({
        locale,
        part: part(call, "success", {
          resultDetails: {
            links: [{ uri: "https://example.com/tasks/1" }],
          },
        }),
      });
      expect(JSON.stringify(row.elements)).toContain(
        '"url":"https://example.com/tasks/1"',
      );
    });
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

describe("URLs without a URL of the engine's own", () => {
  it("reads an https link as a browser does", () => {
    const url = new AbsoluteUrl("https://CRM.example.com:443/a/b?x=1#top");
    expect([
      url.protocol,
      url.hostname,
      url.host,
      url.pathname,
      url.search,
      url.hash,
    ]).toEqual([
      "https:",
      "crm.example.com",
      "crm.example.com",
      "/a/b",
      "?x=1",
      "#top",
    ]);
    expect(url.href).toBe("https://crm.example.com/a/b?x=1#top");
    expect(new AbsoluteUrl("https://crm.example.com:8443").host).toBe(
      "crm.example.com:8443",
    );
  });

  it("reports user info, and ends the host at a backslash", () => {
    const withUser = new AbsoluteUrl("https://user:pw@evil.example/x");
    expect([withUser.username, withUser.password, withUser.hostname]).toEqual([
      "user",
      "pw",
      "evil.example",
    ]);
    expect(
      new AbsoluteUrl("https://evil.example\\@good.example/").hostname,
    ).toBe("evil.example");
  });

  it.each([
    "javascript:alert(1)",
    "https://exa mple.com",
    "https://",
    "https://ex%61mple.com",
    "/relative/path",
  ])("refuses %s", (input) => {
    expect(() => new AbsoluteUrl(input)).toThrow();
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
