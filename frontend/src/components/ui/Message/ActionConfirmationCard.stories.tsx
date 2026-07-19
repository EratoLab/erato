import { useState } from "react";

import {
  ActionConfirmationCard,
  type ActionConfirmationStatus,
} from "./ActionConfirmationCard";
import { Button } from "../Controls/Button";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Message/ActionConfirmationCard",
  component: ActionConfirmationCard,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Inline, message-scoped permission step for an assistant-proposed action. " +
          "Presents the same three-way decision — allow once / always allow / deny — " +
          "with browser-permission semantics, and leaves a compact resolved row in the " +
          "transcript once decided. Used e.g. by the Outlook add-in to gate tool actions.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: "select",
      options: ["pending", "confirmed", "dismissed"],
      description:
        "Lifecycle state — pending shows buttons, resolved shows a row",
    },
    isBusy: {
      control: "boolean",
      description: "Disables the buttons while the allowed action executes",
    },
  },
  args: {
    onAllowOnce: () => {},
    onAlwaysAllow: () => {},
    onDeny: () => {},
  },
  decorators: [
    (Story) => (
      <div className="w-96 bg-theme-bg-secondary p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ActionConfirmationCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default 3-button decision: Allow once / Always allow / Deny.
 */
export const Pending: Story = {
  args: {
    title: "Open a reply to this email?",
    description:
      "The assistant wants to open a reply to Jordan Vega (jordan@contoso.com).",
    status: "pending",
  },
};

/**
 * Omitting `onAlwaysAllow` yields a 2-button card (Allow once / Deny) for
 * consumers with no way to persist the decision.
 */
export const TwoButton: Story = {
  args: {
    title: "Open a reply to this email?",
    description:
      "The assistant wants to open a reply to Jordan Vega (jordan@contoso.com).",
    status: "pending",
    onAlwaysAllow: undefined,
  },
};

/**
 * Buttons disabled while the allowed action runs.
 */
export const Busy: Story = {
  args: {
    title: "Open a reply to this email?",
    description: "Opening the reply form…",
    status: "pending",
    isBusy: true,
  },
};

/**
 * A deployment can enforce per-use confirmation: "Always allow" renders greyed
 * out (kept in tab order via aria-disabled) with the reason below the buttons.
 */
export const AlwaysAllowDisabled: Story = {
  args: {
    title: "Send this message?",
    description: "The assistant wants to send an email to the finance team.",
    status: "pending",
    alwaysAllowDisabledReason:
      "Your organization requires confirmation for every send.",
  },
};

/**
 * The compact resolved row shown after "Allow once" / "Always allow".
 */
export const ResolvedConfirmed: Story = {
  args: {
    status: "confirmed",
    resolvedLabel: "Reply opened",
  },
};

/**
 * The compact resolved row shown after "Deny".
 */
export const ResolvedDismissed: Story = {
  args: {
    status: "dismissed",
    resolvedLabel: "Action skipped",
  },
};

/**
 * How it surfaces today — the add-in tool-consent idiom.
 *
 * The assistant proposes an action, which surfaces a `pending` card. The user's
 * decision resolves the card in place to a compact row (Allow once → confirmed,
 * Deny → dismissed), mirroring how the Outlook add-in surfaces and records a
 * tool-consent step without stealing focus or opening a modal. Reset replays it.
 */
export const SurfacedLifecycle: Story = {
  render: () => {
    const SurfacedLifecycleDemo = () => {
      const [status, setStatus] = useState<ActionConfirmationStatus | "idle">(
        "idle",
      );

      if (status === "idle") {
        return (
          <Button variant="primary" onClick={() => setStatus("pending")}>
            Assistant proposes an action
          </Button>
        );
      }

      return (
        <div className="space-y-3">
          <p className="text-sm text-theme-fg-secondary">
            Assistant: I can open a reply to Jordan Vega for you.
          </p>
          <ActionConfirmationCard
            title="Open a reply to this email?"
            description="The assistant wants to open a reply to Jordan Vega (jordan@contoso.com)."
            status={status}
            resolvedLabel={
              status === "confirmed" ? "Reply opened" : "Action skipped"
            }
            onAllowOnce={() => setStatus("confirmed")}
            onDeny={() => setStatus("dismissed")}
          />
          {status !== "pending" && (
            <Button variant="ghost" size="sm" onClick={() => setStatus("idle")}>
              Reset
            </Button>
          )}
        </div>
      );
    };

    return <SurfacedLifecycleDemo />;
  },
};
