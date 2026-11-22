import { MessageContent } from "../../components/ui/Message/MessageContent";

import type { ContentPart } from "../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

const PART = { tries_remaining: 2, calls_remaining: 30 };

const call = (
  id: string,
  name: string,
  status: "success" | "error" | "preparing",
  output: Record<string, unknown> | null,
  input: Record<string, unknown> = {},
): ContentPart =>
  ({
    content_type: "tool_use",
    status,
    tool_call_id: id,
    tool_name: name,
    input,
    output,
    progress_message: null,
    started_at: null,
    ended_at: null,
  }) as unknown as ContentPart;

const reasoning = (text: string): ContentPart => ({
  content_type: "reasoning",
  text,
});

const read = (id: string) =>
  call(id, "read_document_blocks", "success", {
    status: "success",
    result: {},
  });

const written = (id: string) =>
  call(id, "write_document_section", "success", {
    status: "success",
    result: {},
    part: PART,
  });

const sentAgain = (id: string) =>
  call(id, "write_document_section", "error", {
    status: "error",
    validation_errors: [
      { path: "/ops", code: "numbers", message: "A number changed." },
    ],
    part: PART,
  });

const plan = call("plan", "plan_document_sections", "success", {
  status: "success",
  result: { draft_id: "draft" },
  part: PART,
});

const finish = call("finish", "submit_document_plan", "success", {
  status: "success",
  result: {},
  submission: { status: "accepted", attempts_remaining: 4 },
  submission_outcome: { status: "accepted", attempts_used: 1, max_attempts: 5 },
});

const thinking = reasoning(
  "**Reading the contract**\n\nThe whole contract first, then the sections that change.",
);

function TraceInPane({
  content,
  isStreaming = false,
}: {
  content: ContentPart[];
  isStreaming?: boolean;
}) {
  return (
    <div style={{ width: 360 }}>
      <MessageContent
        messageId="submission-in-parts"
        content={content}
        isStreaming={isStreaming}
        createdAt="2026-11-21T10:00:00Z"
        updatedAt={isStreaming ? undefined : "2026-11-21T10:03:00Z"}
      />
    </div>
  );
}

const meta = {
  title: "Chat/Trace: submission in parts",
  component: TraceInPane,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A large change Erato writes in parts, in the 360 px pane: the reads and every part call show as one Writing the changes step, only its line while Erato writes and folded once done, until the user opens it; a part sent again leaves no red row.",
      },
    },
  },
} satisfies Meta<typeof TraceInPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WhilePlanning: Story = {
  args: {
    content: [
      thinking,
      read("read-1"),
      read("read-2"),
      call("plan", "plan_document_sections", "preparing", null),
    ],
    isStreaming: true,
  },
};

export const WhileWriting: Story = {
  args: {
    content: [
      thinking,
      read("read-1"),
      read("read-2"),
      plan,
      sentAgain("part-2a"),
      written("part-2b"),
      call("part-3", "write_document_section", "preparing", null),
    ],
    isStreaming: true,
  },
};

export const PartsSentAgain: Story = {
  args: {
    content: [
      thinking,
      read("read-1"),
      read("read-2"),
      plan,
      sentAgain("part-2a"),
      written("part-2b"),
      read("read-3"),
      written("part-3"),
      sentAgain("part-4a"),
      written("part-4b"),
      written("part-5"),
      finish,
      {
        content_type: "text",
        text: "The changes are ready in the card below.",
      },
    ],
  },
};
