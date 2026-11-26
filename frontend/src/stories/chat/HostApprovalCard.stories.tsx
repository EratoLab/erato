import { action } from "@storybook/addon-actions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Checkbox } from "@/components/ui/Controls/Checkbox";
import { ActionConfirmationCard } from "@/components/ui/Message/ActionConfirmationCard";
import { McpToolApprovalCard } from "@/components/ui/Message/McpToolApprovalCard";
import { componentRegistry } from "@/config/componentRegistry";
import {
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { ChatContextProviders } from "@/providers/ChatProvider";
import { testChatValue } from "@/test/chatContextValue";

import type { McpToolApprovalRequestPart } from "@/components/ui/Message/McpToolApprovalCard";
import type { ApprovalItemCardProps } from "@/config/componentRegistry";
import type { Meta, StoryObj } from "@storybook/react";

const APPLY_ID = "call-plan.apply";

const display = {
  title: "Change “Vertrag.docx”",
  description: "Updates 2 of 9 sections: § 3 Lieferzeiten, § 5 Haftung",
  description_truncated: false,
};

const chainedRequest = (
  chained: { decide_on_screen: boolean; reason?: string },
  allowAlways: boolean,
): McpToolApprovalRequestPart =>
  ({
    tool_call_id: APPLY_ID,
    tool_name: "apply_document_plan",
    mcp_server_id: "word",
    input: { proposal_call_id: "call-plan", draft_id: "d-1" },
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    preset: "",
    allow_always: allowAlways,
    requested_at: "2026-11-23T10:00:00Z",
    kind: "client_tool",
    display,
    approvals: [
      {
        approval_id: APPLY_ID,
        tool_call_id: APPLY_ID,
        tool_name: "apply_document_plan",
        input: { proposal_call_id: "call-plan", draft_id: "d-1" },
        display,
        child: null,
        follows: { proposal_call_id: "call-plan", ...chained },
      },
    ],
  }) as unknown as McpToolApprovalRequestPart;

const CHANGES = [
  {
    section: "§ 3 Lieferzeiten",
    before: "Lieferung innerhalb von 14 Tagen.",
    after: "Lieferung innerhalb von 10 Werktagen.",
  },
  {
    section: "§ 5 Haftung",
    before: "Die Haftung ist auf den Auftragswert begrenzt.",
    after: "Die Haftung ist auf das Doppelte des Auftragswerts begrenzt.",
  },
];

/**
 * What a host draws for its own tool: the changes with before and after, a
 * tick the change needs, and the usual decisions. Any other tool gets the
 * generic card.
 */
const ExampleHostCard = (props: ApprovalItemCardProps) => {
  const [keepComments, setKeepComments] = useState(false);
  if (
    `${props.serverId}/${props.item.tool_name}` !== "word/apply_document_plan"
  )
    return <>{props.renderDefault()}</>;
  return (
    <div className="space-y-2" data-testid="story-host-card">
      <p className="text-sm font-medium text-theme-fg-primary">
        {props.item.display?.title}
      </p>
      <ul className="space-y-2">
        {CHANGES.map((change) => (
          <li
            key={change.section}
            className="rounded-md border border-theme-border p-2 text-sm"
          >
            <p className="font-medium text-theme-fg-primary">
              {change.section}
            </p>
            <p className="text-theme-fg-muted line-through">{change.before}</p>
            <p className="text-theme-fg-secondary">{change.after}</p>
          </li>
        ))}
      </ul>
      {props.item.follows?.decide_on_screen ? (
        <Checkbox
          checked={keepComments}
          onCheckedChange={setKeepComments}
          label="Remove the passages that have comments"
        />
      ) : null}
      <ActionConfirmationCard
        title="Apply this change?"
        allowOnceLabel="Apply"
        onAllowOnce={() =>
          props.onDecide("approve", {
            clientConfirmation: { remove_commented: keepComments },
          })
        }
        onDeny={() => props.onDecide("reject")}
        denyLabel="Cancel"
        status={props.status}
        resolvedLabel={props.resolvedLabel}
        isBusy={props.isBusy}
      />
    </div>
  );
};

/** The host's card after its review was lost: the server's summary and its line. */
const ReviewGoneHostCard = (props: ApprovalItemCardProps) => (
  <>
    {props.renderDefault({
      note: "The document has to be read again before this change can be made.",
    })}
  </>
);

type Setup = "host" | "reviewGone" | "elsewhere";

const DecisionPlace = ({
  setup,
  request,
}: {
  setup: Setup;
  request: McpToolApprovalRequestPart;
}) => {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [ready] = useState(() => {
    resetClientToolRegistryForTests();
    componentRegistry.ApprovalItemCard =
      setup === "reviewGone" ? ReviewGoneHostCard : ExampleHostCard;
    if (setup !== "elsewhere") {
      registerClientToolExecutor("apply_document_plan", () =>
        Promise.resolve({ ok: true as const, result: {} }),
      );
    }
    return true;
  });
  useEffect(
    () => () => {
      componentRegistry.ApprovalItemCard = null;
      resetClientToolRegistryForTests();
    },
    [],
  );
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ChatContextProviders
        value={testChatValue({
          currentChatId: "story-chat",
          refetchMessages: async () => undefined,
          continueToolApproval: async (input) => {
            action("continue")(input);
          },
        })}
      >
        <div className="max-w-xl">
          <McpToolApprovalCard
            messageId="story-message"
            request={request}
            resolution={null}
          />
        </div>
      </ChatContextProviders>
    </QueryClientProvider>
  );
};

const meta: Meta<typeof DecisionPlace> = {
  title: "Chat/HostApprovalCard",
  component: DecisionPlace,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A change the server applies once the user decides, in the place where the chat asks for decisions. A host draws its own card through `componentRegistry.ApprovalItemCard`; a device without the host's tool shows the generic card with no approval.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof DecisionPlace>;

export const HostCard: Story = {
  args: {
    setup: "host",
    request: chainedRequest({ decide_on_screen: false }, true),
  },
};

export const HostCardNeedsTick: Story = {
  args: {
    setup: "host",
    request: chainedRequest(
      { decide_on_screen: true, reason: "comment_removals" },
      false,
    ),
  },
};

export const HostReviewGone: Story = {
  args: {
    setup: "reviewGone",
    request: chainedRequest({ decide_on_screen: false }, true),
  },
};

export const OnAnotherDevice: Story = {
  args: {
    setup: "elsewhere",
    request: chainedRequest({ decide_on_screen: false }, true),
  },
};
