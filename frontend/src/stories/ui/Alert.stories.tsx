import { useState } from "react";

import { Alert } from "../../components/ui/Feedback/Alert";
import { CheckCircleIcon } from "../../components/ui/icons";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Feedback/Alert",
  component: Alert,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Alert component for displaying informational, warning, error, and success messages. Used for token usage warnings, budget alerts, and other user notifications.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    type: {
      control: "select",
      options: ["info", "warning", "error", "success"],
      description: "The type/severity of the alert",
      table: {
        defaultValue: { summary: "info" },
      },
    },
    title: {
      control: "text",
      description: "Optional title for the alert",
    },
    children: {
      control: "text",
      description: "Alert message content",
    },
    dismissible: {
      control: "boolean",
      description: "Whether the alert can be dismissed",
      table: {
        defaultValue: { summary: "false" },
      },
    },
    className: {
      control: "text",
      description: "Additional CSS classes",
    },
  },
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-secondary p-8">
        <div className="mx-auto max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default info alert with title and message
 */
export const Info: Story = {
  args: {
    type: "info",
    title: "Information",
    children: "This is an informational message to help guide the user.",
  },
};

/**
 * Warning alert shown when user needs to take action
 */
export const Warning: Story = {
  args: {
    type: "warning",
    title: "Warning",
    children:
      "You are approaching your token limit. Consider reducing message length.",
  },
};

/**
 * Error alert for critical issues that need immediate attention
 */
export const Error: Story = {
  args: {
    type: "error",
    title: "Error",
    children:
      "This message exceeds the token limit. Please reduce the message length or remove attached files.",
  },
};

/**
 * Success alert for completed actions
 */
export const Success: Story = {
  args: {
    type: "success",
    title: "Success",
    children: "Your changes have been saved successfully.",
  },
};

/**
 * Alert without a title (message only)
 */
export const WithoutTitle: Story = {
  args: {
    type: "info",
    children: "This is an alert with just a message and no title.",
  },
};

/**
 * Dismissible alert with close button
 */
export const Dismissible: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [visible, setVisible] = useState(true);

    if (!visible) {
      return (
        <button
          onClick={() => setVisible(true)}
          className="rounded bg-theme-primary px-4 py-2 text-sm text-theme-primary-fg"
        >
          Show Alert Again
        </button>
      );
    }

    return (
      <Alert {...args} dismissible onDismiss={() => setVisible(false)}>
        {args.children}
      </Alert>
    );
  },
  args: {
    type: "info",
    title: "Dismissible Alert",
    children: "Click the X button to dismiss this alert.",
  },
};

/**
 * Budget warning - approaching spending limit
 */
export const BudgetWarning: Story = {
  args: {
    type: "warning",
    title: "Approaching Budget Limit",
    children:
      "You are using 75% of your budget ($750.00 of $1,000.00). This is for your 30-day budget period.",
  },
};

/**
 * Budget error - exceeded spending limit
 */
export const BudgetError: Story = {
  args: {
    type: "error",
    title: "Budget Limit Reached",
    children:
      "You have reached or exceeded your budget limit of $1,000.00. Current spending: $1,050.00. This is for your 30-day budget period.",
  },
};

/**
 * Token usage warning - approaching context limit
 */
export const TokenWarning: Story = {
  args: {
    type: "warning",
    title: "Approaching Token Limit",
    children:
      "This message is using 85% of the available token limit (8,500 of 10,000). File attachments account for 2,000 tokens.",
  },
};

/**
 * Token usage error - exceeded context limit
 */
export const TokenError: Story = {
  args: {
    type: "error",
    title: "Token Limit Exceeded",
    children:
      "This message exceeds the token limit of 10,000. Please reduce the message length or remove attached files.",
  },
};

/**
 * Alert with custom icon
 */
export const CustomIcon: Story = {
  args: {
    type: "info",
    title: "Custom Icon",
    children: "This alert uses a custom icon instead of the default.",
    icon: <CheckCircleIcon className="size-5" />,
  },
};

/**
 * Long message content that wraps
 */
export const LongContent: Story = {
  args: {
    type: "warning",
    title: "Detailed Warning",
    children:
      "This is a longer alert message that demonstrates how the component handles multiple lines of text. The content wraps naturally and maintains proper spacing. You can include multiple sentences and detailed information. The alert container will expand to accommodate the content while keeping the icon and dismiss button properly aligned at the top.",
  },
};

/**
 * All alert types shown together for comparison
 */
export const AllTypes: Story = {
  render: () => (
    <div className="space-y-4">
      <Alert type="info" title="Information">
        Informational message with neutral styling
      </Alert>

      <Alert type="warning" title="Warning">
        Warning message with yellow styling
      </Alert>

      <Alert type="error" title="Error">
        Error message with red styling
      </Alert>

      <Alert type="success" title="Success">
        Success message with green styling
      </Alert>
    </div>
  ),
  args: {
    type: "info",
    children: "",
  },
};

/**
 * Real-world examples in chat context
 */
export const ChatExamples: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [alerts, setAlerts] = useState({
      budget: true,
      token: true,
    });

    return (
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-theme-fg-secondary">
          Chat Input Area Examples
        </h3>

        {alerts.budget && (
          <Alert
            type="warning"
            title="Approaching Budget Limit"
            dismissible
            onDismiss={() => setAlerts({ ...alerts, budget: false })}
          >
            You are using 72% of your budget ($720.00 of $1,000.00). This is
            for your 30-day budget period.
          </Alert>
        )}

        {alerts.token && (
          <Alert
            type="warning"
            title="Approaching Token Limit"
            dismissible
            onDismiss={() => setAlerts({ ...alerts, token: false })}
          >
            This message is using 85% of the available token limit (8,500 of
            10,000).
          </Alert>
        )}

        {!alerts.budget && !alerts.token && (
          <div className="rounded-md border border-theme-border-secondary bg-theme-bg-primary p-4 text-center text-sm text-theme-fg-secondary">
            No active alerts
            <div className="mt-2">
              <button
                onClick={() => setAlerts({ budget: true, token: true })}
                className="text-xs text-theme-primary underline"
              >
                Reset alerts
              </button>
            </div>
          </div>
        )}

        <div className="rounded-md border border-theme-border-secondary bg-theme-bg-primary p-3">
          <div className="text-sm text-theme-fg-muted">
            ChatInput would appear here...
          </div>
        </div>
      </div>
    );
  },
  args: {
    type: "warning",
    children: "",
  },
};

/**
 * Interactive playground for testing different states
 */
export const Playground: Story = {
  args: {
    type: "info",
    title: "Alert Title",
    children: "Customize the alert using the controls below.",
    dismissible: false,
  },
};
