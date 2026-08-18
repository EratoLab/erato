import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { resolveMentionedAssistantIds } from "@/utils/chat/assistantMentions";

import { AssistantMentionBackdrop } from "./AssistantMentionBackdrop";

import type { AssistantMention } from "@/utils/chat/assistantMentions";

const researcher: AssistantMention = { id: "a1", name: "Researcher" };
const dataAssistant: AssistantMention = { id: "a2", name: "Data" };
const dataAnalyst: AssistantMention = { id: "a3", name: "Data Analyst" };

function Composer({
  text,
  tracked,
  dimmed,
}: {
  text: string;
  tracked: AssistantMention[];
  dimmed?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <AssistantMentionBackdrop
        text={text}
        tracked={tracked}
        textareaRef={textareaRef}
        dimmed={dimmed}
      />
      <textarea
        ref={textareaRef}
        value={text}
        readOnly
        data-testid="composer-textarea"
      />
    </div>
  );
}

const backdrop = () => screen.getByTestId("chat-input-mention-backdrop");
const highlights = () =>
  screen.queryAllByTestId("chat-input-mention-highlight");

describe("AssistantMentionBackdrop", () => {
  it("highlights a tracked mention and leaves a look-alike alone", () => {
    render(
      <Composer text="@Researcher and @Ghost please" tracked={[researcher]} />,
    );

    expect(highlights().map((span) => span.textContent)).toEqual([
      "@Researcher",
    ]);
  });

  it("highlights nothing while no mention is tracked", () => {
    render(<Composer text="@Researcher please" tracked={[]} />);

    expect(highlights()).toHaveLength(0);
  });

  it("highlights every repetition of the same mention", () => {
    render(<Composer text="@Data then @Data" tracked={[dataAssistant]} />);

    expect(highlights().map((span) => span.textContent)).toEqual([
      "@Data",
      "@Data",
    ]);
  });

  it("highlights the same assistants the composer would submit", () => {
    const text = "@Data and @Data Analyst and @Ghost";
    const tracked = [dataAssistant, dataAnalyst];
    render(<Composer text={text} tracked={tracked} />);

    expect(highlights().map((span) => span.textContent)).toEqual([
      "@Data",
      "@Data Analyst",
    ]);
    expect(new Set(highlights().map((span) => span.dataset.mentionId))).toEqual(
      new Set(resolveMentionedAssistantIds(text, tracked)),
    );
  });

  // The mirror only stays aligned while it holds character-for-character what
  // the textarea holds; anything else is a highlight over the wrong glyphs.
  it.each([
    ["@Researcher please", "plain"],
    ["@Researcher\nsecond line", "newline"],
    ["@Researcher done\n", "trailing newline"],
    ["  spaced   out  @Researcher ", "runs of spaces"],
    ["<script>alert(1)</script> @Researcher & co", "markup and entities"],
  ])("mirrors the textarea value exactly (%s)", (text) => {
    render(<Composer text={text} tracked={[researcher]} />);

    expect(backdrop().textContent).toBe(
      screen.getByTestId<HTMLTextAreaElement>("composer-textarea").value,
    );
  });

  it("escapes markup instead of injecting it", () => {
    render(
      <Composer
        text={'<script>alert("x")</script> @Researcher <b>& co</b>'}
        tracked={[researcher]}
      />,
    );

    expect(backdrop().querySelector("script")).toBeNull();
    expect(backdrop().querySelector("b")).toBeNull();
    expect(highlights().map((span) => span.textContent)).toEqual([
      "@Researcher",
    ]);
  });

  it("re-mirrors the value as it changes", () => {
    const { rerender } = render(
      <Composer text="@Res" tracked={[researcher]} />,
    );
    expect(highlights()).toHaveLength(0);

    rerender(<Composer text="@Researcher hi" tracked={[researcher]} />);

    expect(backdrop().textContent).toBe("@Researcher hi");
    expect(highlights()).toHaveLength(1);
  });

  // The composer surface is the only background the pill ever sits on, and the
  // fill is a few percent away from it there; without the outline the pill is a
  // wash rather than a mark.
  it("outlines the pill as well as filling it, both from theme tokens", () => {
    render(<Composer text="@Researcher please" tracked={[researcher]} />);

    expect(highlights()[0]).toHaveClass(
      "bg-theme-info-bg",
      "shadow-[inset_0_0_0_1px_var(--theme-info-border)]",
    );
  });

  it("fades with the composer while it is locked", () => {
    const { rerender } = render(
      <Composer text="@Researcher please" tracked={[researcher]} />,
    );
    expect(backdrop()).not.toHaveClass("opacity-50");

    rerender(
      <Composer text="@Researcher please" tracked={[researcher]} dimmed />,
    );

    expect(backdrop()).toHaveClass("opacity-50");
  });

  it("follows the textarea's scroll offset", () => {
    render(
      <Composer text={"@Researcher\n".repeat(40)} tracked={[researcher]} />,
    );
    const textarea = screen.getByTestId("composer-textarea");
    // jsdom has no layout, so neither element scrolls on its own.
    const applied: number[] = [];
    Object.defineProperty(textarea, "scrollTop", {
      configurable: true,
      value: 128,
    });
    Object.defineProperty(backdrop(), "scrollTop", {
      configurable: true,
      set: (value: number) => {
        applied.push(value);
      },
      get: () => applied[applied.length - 1] ?? 0,
    });

    fireEvent.scroll(textarea);

    expect(applied.at(-1)).toBe(128);
  });
});
