import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { MessageContent } from "../../components/ui/Message/MessageContent";

import type { ContentPart } from "../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

type TraceStyle = "raw" | "sections";

interface StreamState {
  content: ContentPart[];
  isStreaming: boolean;
}

const SENTENCES = [
  "Let me look at what the user actually asked for here.",
  "The table has three columns, and the second one holds the `config` value I need to compare.",
  "If the values do not match, the earlier assumption about the import order is probably wrong.",
  "That would also explain why the second run produced a different total.",
  "I should check the edge case where the list is empty before going further.",
  "Actually, the first approach double counts the overlap, so I need to subtract it once.",
  "So the plan is: read the file, group the rows by owner, then sum each group.",
  "There is a risk that the dates are in two formats, which would break the grouping.",
];

const LIST =
  "- keep the existing value when both sides agree\n- replace it when only the new side has it\n- ask the user when they conflict\n\n";

/**
 * Reasoning-like prose: `raw` as Chat Completions models stream it, `sections`
 * with a bold heading every ~1200 characters as OpenAI summaries do.
 */
const makeThinkingText = (chars: number, style: TraceStyle): string => {
  let text = "";
  let sinceHeading = Infinity;
  for (let i = 0; text.length < chars; i++) {
    if (style === "sections" && sinceHeading > 1200) {
      text += `**Checking part ${i} of the plan**\n\n`;
      sinceHeading = 0;
    }
    const sentences = Array.from(
      { length: 3 + (i % 3) },
      (_, s) => SENTENCES[(i * 3 + s) % SENTENCES.length],
    );
    const paragraph = `${sentences.join(" ")}\n\n${i % 5 === 4 ? LIST : ""}`;
    text += paragraph;
    sinceHeading += paragraph.length;
  }
  return text.slice(0, chars);
};

const ANSWER =
  "Here is the result. The totals per owner are in the table below, and the two rows with conflicting dates are listed separately so you can decide which one to keep.\n\n";

const reasoning = (text: string): ContentPart => ({
  content_type: "reasoning",
  text,
});
const answer = (text: string): ContentPart => ({ content_type: "text", text });

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const round = (value: number) => Math.round(value * 10) / 10;

interface MeasureOptions {
  style?: TraceStyle;
  phase?: "thinking" | "answer";
  lengths?: number[];
  reps?: number;
}

interface StreamOptions {
  style: TraceStyle;
  chars: number;
  charsPerSecond: number;
}

declare global {
  interface Window {
    /** Timing hooks for measuring the trace in a real browser. */
    __longThinking?: {
      measure: (
        options?: MeasureOptions,
      ) => Array<{ chars: number; medianMs: number }>;
    };
  }
}

const LongThinkingHarness = ({
  style,
  chars,
  charsPerSecond,
}: StreamOptions) => {
  const [state, setState] = useState<StreamState>({
    content: [],
    isStreaming: true,
  });
  const [summary, setSummary] = useState("Streaming…");
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clock = window.performance;
    const apply = (next: StreamState) => {
      const start = clock.now();
      flushSync(() => setState(next));
      return clock.now() - start;
    };

    // One chunk at each trace length; `answer` times a reply chunk under a
    // finished trace of that length.
    window.__longThinking = {
      measure: ({
        style: measureStyle = "raw",
        phase = "thinking",
        lengths = [2_000, 10_000, 25_000, 50_000, 100_000, 200_000],
        reps = 10,
      } = {}) =>
        lengths.map((length) => {
          const text = makeThinkingText(length + 12 * (reps + 2), measureStyle);
          apply({ content: [], isStreaming: true });
          const times = Array.from({ length: reps + 2 }, (_, i) =>
            apply({
              content:
                phase === "thinking"
                  ? [reasoning(text.slice(0, length + 12 * i))]
                  : [
                      reasoning(text.slice(0, length)),
                      answer(ANSWER.slice(0, 20 + 12 * i)),
                    ],
              isStreaming: true,
            }),
          ).slice(2);
          return { chars: length, medianMs: round(median(times)) };
        }),
    };

    // Streams the way the network delivers: a render that runs long gets
    // everything that arrived meanwhile in the next update.
    const text = makeThinkingText(chars, style);
    const startedAt = clock.now();
    const updates: number[] = [];
    let frames = 0;
    let slowFrames = 0;
    let lastFrame = startedAt;
    let frameRequest = 0;
    let timer = 0;
    const onFrame = (now: number) => {
      frames += 1;
      if (now - lastFrame > 50) slowFrames += 1;
      lastFrame = now;
      frameRequest = window.requestAnimationFrame(onFrame);
    };
    frameRequest = window.requestAnimationFrame(onFrame);

    const tick = () => {
      const produced = Math.floor(
        ((clock.now() - startedAt) / 1000) * charsPerSecond,
      );
      const answered = Math.min(
        Math.max(0, produced - text.length),
        ANSWER.length,
      );
      const content =
        answered > 0
          ? [reasoning(text), answer(ANSWER.slice(0, answered))]
          : [reasoning(text.slice(0, produced))];
      updates.push(apply({ content, isStreaming: true }));
      const scroller = scrollerRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      if (answered < ANSWER.length) {
        timer = window.setTimeout(tick, 8);
        return;
      }
      const finishMs = apply({ content, isStreaming: false });
      window.cancelAnimationFrame(frameRequest);
      setSummary(
        `${updates.length} updates, median ${round(median(updates))} ms, last 100 median ${round(median(updates.slice(-100)))} ms, finish ${round(finishMs)} ms, ${slowFrames} of ${frames} frames over 50 ms`,
      );
    };
    tick();

    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frameRequest);
      delete window.__longThinking;
    };
  }, [style, chars, charsPerSecond]);

  return (
    <div style={{ maxWidth: 760, padding: 16 }}>
      <p data-testid="long-thinking-summary" style={{ fontSize: 12 }}>
        {summary}
      </p>
      <div ref={scrollerRef} style={{ height: 680, overflowY: "auto" }}>
        <MessageContent
          messageId="long-thinking-message"
          content={state.content}
          isStreaming={state.isStreaming}
          createdAt="2026-11-19T10:00:00Z"
          updatedAt={state.isStreaming ? undefined : "2026-11-19T10:02:00Z"}
        />
      </div>
    </div>
  );
};

const meta: Meta<typeof LongThinkingHarness> = {
  title: "Chat/Long Thinking Stream",
  component: LongThinkingHarness,
  parameters: { layout: "fullscreen" },
  argTypes: {
    style: { control: "inline-radio", options: ["raw", "sections"] },
  },
};

export default meta;

type Story = StoryObj<typeof LongThinkingHarness>;

/**
 * A long thinking trace streamed into a message, then a short answer. The
 * line above the message reports how long each update took.
 */
export const RawThinking: Story = {
  args: { style: "raw", chars: 60_000, charsPerSecond: 4_000 },
};

export const SummarySections: Story = {
  args: { style: "sections", chars: 60_000, charsPerSecond: 4_000 },
};
