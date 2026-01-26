import { i18n } from "@lingui/core";
import { useMemo, useState } from "react";

import { InfoTooltip } from "../../components/ui/Controls/InfoTooltip";

import type { Meta, StoryObj } from "@storybook/react";

// Helper component that adds translations and renders children
const WithTranslations: React.FC<{
  translations: Record<string, string>;
  children: React.ReactNode;
}> = ({ translations, children }) => {
  // Use useMemo to only load translations once
  useMemo(() => {
    const currentLocale = i18n.locale || "en";
    // Access internal messages - this works at runtime
    const existingMessages =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      (i18n as unknown as { _messages: Record<string, string> })._messages ||
      {};

    i18n.load(currentLocale, {
      ...existingMessages,
      ...translations,
    });
    i18n.activate(currentLocale);
  }, [translations]);

  return <>{children}</>;
};

const meta = {
  title: "UI/Controls/InfoTooltip",
  component: InfoTooltip,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
A conditional tooltip component controlled by translation files.

Renders an info icon ("i" in a circle) with a tooltip **only** when a translation 
exists for the given translationId. If no translation is provided, the component 
renders nothing.

This enables customer-configurable tooltips via language files:
- If a customer adds a translation → tooltip is shown
- If no translation is provided → nothing is rendered

**Usage:**
\`\`\`tsx
<InfoTooltip translationId="assistant.myAssistant.tooltip" />
\`\`\`
        `,
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    translationId: {
      control: "text",
      description: "The Lingui translation ID for the tooltip content",
    },
    position: {
      control: "select",
      options: ["top", "right", "bottom", "left"],
      description: "Position of the tooltip relative to the icon",
      table: {
        defaultValue: { summary: "top" },
      },
    },
    size: {
      control: "select",
      options: ["sm", "md"],
      description: "Size of the info icon",
      table: {
        defaultValue: { summary: "sm" },
      },
    },
    className: {
      control: "text",
      description: "Additional CSS classes for the icon wrapper",
    },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-[200px] items-center justify-center bg-theme-bg-primary p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InfoTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * When a translation exists, the info icon is shown.
 * Hover over the icon to see the tooltip.
 */
export const WithTranslation: Story = {
  render: (args) => (
    <WithTranslations
      translations={{
        "story.tooltip.example":
          "This is helpful information about the feature.",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-theme-fg-primary">Feature Name</span>
        <InfoTooltip {...args} translationId="story.tooltip.example" />
      </div>
    </WithTranslations>
  ),
  args: {
    translationId: "story.tooltip.example",
    position: "top",
    size: "sm",
  },
};

/**
 * When no translation exists for the ID, nothing is rendered.
 * Compare to "With Translation" - only "Feature Name" appears here, no icon.
 */
export const WithoutTranslation: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <span className="text-theme-fg-primary">Feature Name</span>
      <InfoTooltip translationId="story.tooltip.nonexistent.xyz" />
    </div>
  ),
  args: {
    translationId: "story.tooltip.nonexistent.xyz",
  },
};

/**
 * Different tooltip positions
 */
export const Positions: Story = {
  render: () => (
    <WithTranslations
      translations={{
        "story.tooltip.top": "Tooltip positioned at the top",
        "story.tooltip.right": "Tooltip positioned at the right",
        "story.tooltip.bottom": "Tooltip positioned at the bottom",
        "story.tooltip.left": "Tooltip positioned at the left",
      }}
    >
      <div className="grid grid-cols-2 gap-8">
        <div className="flex items-center gap-2">
          <span className="text-theme-fg-primary">Top</span>
          <InfoTooltip translationId="story.tooltip.top" position="top" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-theme-fg-primary">Right</span>
          <InfoTooltip translationId="story.tooltip.right" position="right" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-theme-fg-primary">Bottom</span>
          <InfoTooltip translationId="story.tooltip.bottom" position="bottom" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-theme-fg-primary">Left</span>
          <InfoTooltip translationId="story.tooltip.left" position="left" />
        </div>
      </div>
    </WithTranslations>
  ),
  args: {
    translationId: "story.tooltip.positions",
  },
};

/**
 * Different icon sizes
 */
export const Sizes: Story = {
  render: () => (
    <WithTranslations
      translations={{
        "story.tooltip.size.sm": "Small icon tooltip",
        "story.tooltip.size.md": "Medium icon tooltip",
      }}
    >
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <span className="text-theme-fg-primary">Small (default)</span>
          <InfoTooltip translationId="story.tooltip.size.sm" size="sm" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-theme-fg-primary">Medium</span>
          <InfoTooltip translationId="story.tooltip.size.md" size="md" />
        </div>
      </div>
    </WithTranslations>
  ),
  args: {
    translationId: "story.tooltip.sizes",
  },
};

/**
 * Real-world example: Assistant card with optional tooltip
 */
export const AssistantCardExample: Story = {
  render: () => (
    <WithTranslations
      translations={{
        "assistant.supportBot.tooltip":
          "This assistant is configured to help with customer support queries. It has access to your knowledge base.",
        // Note: assistant.salesBot.tooltip is intentionally NOT added
      }}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-theme-border bg-theme-bg-secondary p-4">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-theme-fg-primary">Support Bot</h3>
            <InfoTooltip translationId="assistant.supportBot.tooltip" />
          </div>
          <p className="mt-1 text-sm text-theme-fg-muted">
            Handles customer inquiries
          </p>
        </div>

        <div className="rounded-lg border border-theme-border bg-theme-bg-secondary p-4">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-theme-fg-primary">Sales Bot</h3>
            <InfoTooltip translationId="assistant.salesBot.tooltip" />
          </div>
          <p className="mt-1 text-sm text-theme-fg-muted">
            Assists with sales questions
          </p>
        </div>
      </div>
    </WithTranslations>
  ),
  args: {
    translationId: "assistant.example.tooltip",
  },
};

/**
 * Interactive demo to toggle translation availability
 */
export const InteractiveDemo: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [hasTranslation, setHasTranslation] = useState(true);

    return (
      <WithTranslations
        translations={
          hasTranslation
            ? {
                "story.tooltip.interactive":
                  "This tooltip is visible because the translation exists!",
              }
            : {}
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setHasTranslation(!hasTranslation)}
              className="rounded bg-theme-bg-tertiary px-3 py-1 text-sm text-theme-fg-primary hover:opacity-80"
            >
              {hasTranslation ? "Remove Translation" : "Add Translation"}
            </button>
            <span className="text-xs text-theme-fg-muted">
              Translation is: {hasTranslation ? "present" : "absent"}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded border border-theme-border bg-theme-bg-secondary p-4">
            <span className="text-theme-fg-primary">Feature Name</span>
            <InfoTooltip translationId="story.tooltip.interactive" />
          </div>
        </div>
      </WithTranslations>
    );
  },
  args: {
    translationId: "story.tooltip.interactive",
  },
};

/**
 * Long tooltip content
 */
export const LongContent: Story = {
  render: () => (
    <WithTranslations
      translations={{
        "story.tooltip.long":
          "This is a longer tooltip that contains multiple sentences. It demonstrates how the tooltip handles more detailed explanations. The content wraps naturally within the tooltip container.",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-theme-fg-primary">Feature with details</span>
        <InfoTooltip translationId="story.tooltip.long" />
      </div>
    </WithTranslations>
  ),
  args: {
    translationId: "story.tooltip.long",
  },
};
