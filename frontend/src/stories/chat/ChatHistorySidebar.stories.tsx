import { action } from "@storybook/addon-actions";
import { useState } from "react";

import { ChatHistorySidebar } from "@/components/ui";
import { FeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import type { ChatSession } from "@/types/chat";
import type { Decorator, Meta, StoryObj } from "@storybook/react";

/**
 * The preview defaults every story to `collapsedMode: "hidden"`, so a story
 * that means to show the slim rail has to say so. Below 640px
 * `useResponsiveCollapsedMode` forces `hidden` back, so slim needs a wide canvas.
 */
const withSidebarConfig = (sidebar: {
  collapsedMode: "hidden" | "slim";
  logoPath?: string;
  logoDarkPath?: string;
}): Decorator =>
  // Named, because a bare arrow here is a component definition without a
  // display name and the lint run fails on it.
  function WithSidebarConfig(Story) {
    return (
      <FeatureConfigProvider config={{ sidebar }}>
        <Story />
      </FeatureConfigProvider>
    );
  };

const meta: Meta<typeof ChatHistorySidebar> = {
  title: "CHAT/ChatHistorySidebar",
  component: ChatHistorySidebar,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `
A collapsible sidebar for chat history navigation.

## Features
- Collapsible sidebar with smooth transitions
- Consistent toggle button positioning
- Optional title display
- New chat functionality
        `,
      },
      canvas: { sourceState: "hidden" },
    },
  },
  argTypes: {
    onNewChat: { action: "New chat clicked" },
    onToggleCollapse: { action: "Sidebar toggled" },
    collapsed: { control: "boolean" },
    showTitle: { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockSessions: ChatSession[] = [
  {
    id: "1",
    title: "Chat about React Performance",
    messages: [],
    updatedAt: new Date("2024-01-01").toISOString(),
    metadata: {
      ownerId: "user-1",
      lastMessage: {
        content: "Let's discuss React performance optimization techniques",
        timestamp: new Date("2024-01-01").toISOString(),
      },
    },
  },
  {
    id: "2",
    title: "TypeScript Best Practices",
    messages: [],
    updatedAt: new Date("2024-01-02").toISOString(),
    metadata: {
      ownerId: "user-1",
      lastMessage: {
        content: "What are your thoughts on TypeScript strict mode?",
        timestamp: new Date("2024-01-02").toISOString(),
      },
    },
  },
];

// Served by Storybook's static dir (.storybook/main.ts -> staticDirs), so the
// sidebar's existence check for a configured logo resolves in the canvas.
const STORY_SIDEBAR_LOGO_PATH = "/erato-e.svg";
const STORY_SIDEBAR_LOGO_DARK_PATH = "/erato-e-dark.svg";

// Interactive story with state management
const InteractiveTemplate = (args: Story["args"]) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <ChatHistorySidebar
      {...args}
      collapsed={isCollapsed}
      onToggleCollapse={() => {
        setIsCollapsed(!isCollapsed);
        action("Sidebar toggled")(isCollapsed ? "expanded" : "collapsed");
      }}
      onNewChat={() => action("New chat clicked")()}
      sessions={mockSessions}
      currentSessionId="1"
      onSessionSelect={(id) => action("Session selected")(id)}
      onSessionArchive={(id) => action("Session deleted")(id)}
      onSessionUnarchive={(id) => action("Session unarchived")(id)}
      isLoading={false}
    />
  );
};

export const Interactive: Story = {
  render: InteractiveTemplate,
  args: {
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionArchive: action("Session archived"),
    onSessionUnarchive: action("Session unarchived"),
    isLoading: false,
    showTitle: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Interactive example with working collapse behavior and new chat functionality.",
      },
    },
  },
};

// Update the stories to pass required props directly
export const Default: Story = {
  args: {
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionArchive: action("Session archived"),
    onSessionUnarchive: action("Session unarchived"),
    isLoading: false,
    showTitle: false,
  },
};

export const Collapsed: Story = {
  args: {
    collapsed: true,
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    showTitle: false,
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionArchive: action("Session archived"),
    onSessionUnarchive: action("Session unarchived"),
    isLoading: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Collapsed under the default `hidden` mode: the sidebar slides off-screen and the only control left is the trigger floating over the conversation. That trigger is the `.floating-control-skin` surface — opaque base, `radius.shell` corner, shell hairline and shadow — so this is the story to watch when retuning it.",
      },
    },
  },
};

export const WithTitle: Story = {
  args: {
    showTitle: true,
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionArchive: action("Session archived"),
    onSessionUnarchive: action("Session unarchived"),
    isLoading: false,
  },
};

export const Loading: Story = {
  args: {
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    sessions: [],
    currentSessionId: null,
    onSessionSelect: action("Session selected"),
    onSessionArchive: action("Session archived"),
    onSessionUnarchive: action("Session unarchived"),
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    sessions: [],
    currentSessionId: null,
    onSessionSelect: action("Session selected"),
    onSessionArchive: action("Session archived"),
    onSessionUnarchive: action("Session unarchived"),
    isLoading: false,
    showTitle: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Empty state when there are no chat sessions and loading is complete.",
      },
    },
  },
};

export const SlimModeWithoutLogo: Story = {
  args: {
    collapsed: true,
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    showTitle: false,
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionArchive: action("Session archived"),
    onSessionUnarchive: action("Session unarchived"),
    isLoading: false,
  },
  decorators: [withSidebarConfig({ collapsedMode: "slim" })],
  parameters: {
    docs: {
      description: {
        story:
          "Slim mode sidebar with icon-only navigation, forced by the story's own feature config — a deployment turns it on with VITE_SIDEBAR_COLLAPSED_MODE=slim or frontend.sidebar_collapsed_mode=slim. No sidebar logo is configured, so the header band shows the bare toggle on the rail centerline.",
      },
    },
  },
};

export const SlimModeWithLogo: Story = {
  args: {
    collapsed: true,
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    showTitle: false,
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionArchive: action("Session archived"),
    onSessionUnarchive: action("Session unarchived"),
    isLoading: false,
  },
  decorators: [
    withSidebarConfig({
      collapsedMode: "slim",
      logoPath: STORY_SIDEBAR_LOGO_PATH,
      logoDarkPath: STORY_SIDEBAR_LOGO_DARK_PATH,
    }),
  ],
  parameters: {
    docs: {
      description: {
        story:
          "The logo face: in slim mode a configured `sidebar_logo_path` replaces the toggle glyph, and hovering fades the logo out under the toggle icon, so one control carries both. The logo path is checked for existence before it is shown, so the story points at an asset the Storybook static dir serves; a deployment sets frontend.sidebar_logo_path (plus the dark variant) instead.",
      },
    },
  },
};
