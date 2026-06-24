import React, { createElement as h } from "react";

import {
  loadExampleComponentKit,
  storybookComponentKitMode,
} from "./component-kit-loader";

import type {
  ComponentKitRegistration,
  ComponentRegistry,
  MessageAction,
  UiChatMessage,
} from "@erato/frontend/library";
import type { Meta, StoryObj } from "@storybook/react";

type PropsOf<TKey extends keyof ComponentRegistry> = React.ComponentProps<
  NonNullable<ComponentRegistry[TKey]>
>;

const logAction = (label: string, value?: unknown) => {
  console.info(`[component-kit-storybook] ${label}`, value);
};

const getComponent = <TKey extends keyof ComponentRegistry>(
  componentKit: ComponentKitRegistration,
  extensionPoint: TKey,
): NonNullable<ComponentRegistry[TKey]> => {
  const registration = componentKit.components.find(
    (component) => component.extensionPoint === extensionPoint,
  );

  if (!registration) {
    throw new Error(`No component registered for ${String(extensionPoint)}`);
  }

  return registration.component as NonNullable<ComponentRegistry[TKey]>;
};

const sampleMessage: UiChatMessage = {
  id: "message-1",
  role: "assistant",
  sender: "Assistant",
  content: [
    {
      content_type: "text",
      text: "This message is rendered through the component kit.",
    },
  ],
  createdAt: new Date().toISOString(),
} as unknown as UiChatMessage;

const sampleFile = {
  id: "file-1",
  filename: "quarterly-plan.pdf",
  name: "quarterly-plan.pdf",
  size: 24000,
  mime_type: "application/pdf",
} as unknown as File;

const sampleAttachment = {
  id: "attachment-1",
  filename: "customer-notes.docx",
  name: "customer-notes.docx",
  size: 32000,
  mime_type:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as unknown as File;

const assistantProps = {
  assistant: {
    id: "assistant-1",
    name: "Research Assistant",
    description: "Answers questions from selected documents.",
    files: [],
  },
  className: "storybook-example-class",
} as unknown as PropsOf<"AssistantWelcomeScreen">;

const chatHistoryProps = {
  sessions: [
    {
      id: "chat-1",
      title: "Market summary",
      updated_at: new Date().toISOString(),
    },
    {
      id: "chat-2",
      title: "Launch notes",
      updated_at: new Date().toISOString(),
    },
  ],
  currentSessionId: "chat-1",
  onSessionSelect: (sessionId: string) =>
    logAction("session selected", sessionId),
  className: "storybook-example-class",
} as unknown as PropsOf<"ChatHistoryList">;

const attachmentPreviewProps = {
  attachedFiles: [sampleFile, sampleAttachment],
  maxFiles: 4,
  onRemoveFile: (fileId: string) => logAction("remove file", fileId),
  onRemoveAllFiles: () => logAction("remove all files"),
  disabled: false,
} as unknown as PropsOf<"ChatInputAttachmentPreview">;

const groupedAttachmentsProps = {
  groups: [
    {
      id: "email-source",
      label: "Email attachments",
      items: [
        {
          id: "attachment-1",
          kind: "attachment",
          file: { name: "proposal.pdf", size: 31000 },
        },
        {
          id: "context-1",
          kind: "context",
          labelOverride: "Pinned context",
          file: { name: "account-brief.txt", size: 12000 },
        },
      ],
    },
  ],
  onRemoveFile: (fileId: string) => logAction("remove grouped file", fileId),
  disabled: false,
  className: "storybook-example-class",
} as unknown as PropsOf<"ChatGroupedAttachmentsPreview">;

const fileSourceSelectorProps = {
  availableProviders: ["sharepoint"],
  onSelectDisk: () => logAction("select disk"),
  onSelectCloud: (provider: string) => logAction("select cloud", provider),
  disabled: false,
  isProcessing: false,
  className: "storybook-example-class",
} as unknown as PropsOf<"ChatFileSourceSelector">;

const starterPromptsProps = {
  starterPrompts: [
    {
      id: "summarize",
      icon: "chat",
      resolvedTitle: "Summarize",
      resolvedSubtitle: "Create a short summary",
      prompt: "Summarize the attached material.",
    },
    {
      id: "risks",
      icon: "warning",
      resolvedTitle: "Find risks",
      resolvedSubtitle: "Extract open risks",
      prompt: "List the main risks.",
    },
  ],
  onStarterPromptSelect: (starterPrompt: { id: string }) =>
    logAction("starter prompt selected", starterPrompt.id),
  className: "storybook-example-class",
} as unknown as PropsOf<"StarterPrompts">;

const messageControlsProps = {
  messageId: "message-1",
  isUserMessage: false,
  onAction: async (action: MessageAction) => {
    logAction("message action", action);
    return true;
  },
  context: {},
  className: "storybook-example-class",
} as unknown as PropsOf<"MessageControls">;

const messageRendererProps = {
  message: sampleMessage,
  controls: undefined,
  controlsContext: {},
  onMessageAction: async (action: MessageAction) => {
    logAction("renderer message action", action);
    return true;
  },
} as unknown as PropsOf<"ChatMessageRenderer">;

const emailCodeBlockProps = {
  content: "Subject: Follow-up\n\nThanks for the discussion today.",
  isHtml: false,
} as unknown as PropsOf<"EratoEmailCodeBlock">;

const Panel = ({
  title,
  wide = false,
  children,
}: {
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) => (
  <section
    className={
      wide ? "storybook-panel storybook-panel-wide" : "storybook-panel"
    }
  >
    <h2 className="storybook-panel-title">{title}</h2>
    <div className="storybook-panel-content">{children}</div>
  </section>
);

const ComponentKitShowcase = () => {
  const [componentKit, setComponentKit] =
    React.useState<ComponentKitRegistration | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let isCurrent = true;

    void loadExampleComponentKit()
      .then((loadedComponentKit) => {
        if (isCurrent) {
          setComponentKit(loadedComponentKit);
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(
            loadError instanceof Error
              ? loadError
              : new Error(String(loadError)),
          );
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (error) {
    return <div className="storybook-shell">{error.message}</div>;
  }

  if (!componentKit) {
    return <div className="storybook-shell">Loading component kit...</div>;
  }

  const AssistantWelcomeScreen = getComponent(
    componentKit,
    "AssistantWelcomeScreen",
  );
  const ChatHistoryList = getComponent(componentKit, "ChatHistoryList");
  const ChatInputAttachmentPreview = getComponent(
    componentKit,
    "ChatInputAttachmentPreview",
  );
  const ChatGroupedAttachmentsPreview = getComponent(
    componentKit,
    "ChatGroupedAttachmentsPreview",
  );
  const ChatWelcomeScreen = getComponent(componentKit, "ChatWelcomeScreen");
  const StarterPrompts = getComponent(componentKit, "StarterPrompts");
  const MessageControls = getComponent(componentKit, "MessageControls");
  const ChatMessageRenderer = getComponent(componentKit, "ChatMessageRenderer");
  const ChatFileSourceSelector = getComponent(
    componentKit,
    "ChatFileSourceSelector",
  );
  const AssistantFileSourceSelector = getComponent(
    componentKit,
    "AssistantFileSourceSelector",
  );
  const ChatTopLeftAccessory = getComponent(
    componentKit,
    "ChatTopLeftAccessory",
  );
  const EratoEmailCodeBlock = getComponent(componentKit, "EratoEmailCodeBlock");

  return (
    <main className="storybook-shell">
      <header className="storybook-header">
        <h1 className="storybook-title">Component Kit Example</h1>
        <span className="storybook-mode">{storybookComponentKitMode}</span>
      </header>

      <div className="storybook-grid">
        <Panel title="Chat Welcome">
          <ChatWelcomeScreen className="storybook-example-class" />
        </Panel>
        <Panel title="Assistant Welcome">
          <AssistantWelcomeScreen {...assistantProps} />
        </Panel>
        <Panel title="Starter Prompts">
          <StarterPrompts {...starterPromptsProps} />
        </Panel>
        <Panel title="File Source Selector">
          <ChatFileSourceSelector {...fileSourceSelectorProps} />
          <AssistantFileSourceSelector {...fileSourceSelectorProps} />
        </Panel>
        <Panel title="Chat Input Attachments">
          <ChatInputAttachmentPreview {...attachmentPreviewProps} />
        </Panel>
        <Panel title="Grouped Attachments">
          <ChatGroupedAttachmentsPreview {...groupedAttachmentsProps} />
        </Panel>
        <Panel title="Chat History">
          <ChatHistoryList {...chatHistoryProps} />
        </Panel>
        <Panel title="Message Controls">
          <MessageControls {...messageControlsProps} />
        </Panel>
        <Panel title="Chat Accessory">
          <ChatTopLeftAccessory />
        </Panel>
        <Panel title="Email Code Block">
          <EratoEmailCodeBlock {...emailCodeBlockProps} />
        </Panel>
        <Panel title="Message Renderer" wide>
          <ChatMessageRenderer {...messageRendererProps} />
        </Panel>
      </div>
    </main>
  );
};

const meta = {
  title: "Component Kit/Runtime Registration",
  component: ComponentKitShowcase,
} satisfies Meta<typeof ComponentKitShowcase>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllExtensionPoints: Story = {};
