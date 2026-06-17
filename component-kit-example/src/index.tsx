import "./style.css";

import { ExampleAssistantWelcomeScreen } from "./components/ExampleAssistantWelcomeScreen";
import { ExampleChatHistoryList } from "./components/ExampleChatHistoryList";
import { ExampleChatInputAttachmentPreview } from "./components/ExampleChatInputAttachmentPreview";
import { ExampleChatMessageRenderer } from "./components/ExampleChatMessageRenderer";
import { ExampleChatTopLeftAccessory } from "./components/ExampleChatTopLeftAccessory";
import { ExampleChatWelcomeScreen } from "./components/ExampleChatWelcomeScreen";
import { ExampleEratoEmailCodeBlock } from "./components/ExampleEratoEmailCodeBlock";
import { ExampleFileSourceSelector } from "./components/ExampleFileSourceSelector";
import { ExampleGroupedAttachmentsPreview } from "./components/ExampleGroupedAttachmentsPreview";
import { ExampleMessageControls } from "./components/ExampleMessageControls";
import { ExampleStarterPrompts } from "./components/ExampleStarterPrompts";

import type { ComponentKitRegistration } from "@erato/frontend/library";

declare global {
  interface Window {
    ERATO_COMPONENT_KITS?: ComponentKitRegistration[];
  }
}

const componentKit: ComponentKitRegistration = {
  name: "example",
  components: [
    {
      extensionPoint: "AssistantFileSourceSelector",
      component: ExampleFileSourceSelector,
      priority: 50,
    },
    {
      extensionPoint: "ChatFileSourceSelector",
      component: ExampleFileSourceSelector,
      priority: 50,
    },
    {
      extensionPoint: "ChatInputAttachmentPreview",
      component: ExampleChatInputAttachmentPreview,
      priority: 50,
    },
    {
      extensionPoint: "ChatGroupedAttachmentsPreview",
      component: ExampleGroupedAttachmentsPreview,
      priority: 50,
    },
    {
      extensionPoint: "ChatHistoryList",
      component: ExampleChatHistoryList,
      priority: 50,
    },
    {
      extensionPoint: "ChatWelcomeScreen",
      component: ExampleChatWelcomeScreen,
      priority: 50,
    },
    {
      extensionPoint: "StarterPrompts",
      component: ExampleStarterPrompts,
      priority: 50,
    },
    {
      extensionPoint: "AssistantWelcomeScreen",
      component: ExampleAssistantWelcomeScreen,
      priority: 50,
    },
    {
      extensionPoint: "MessageControls",
      component: ExampleMessageControls,
      priority: 50,
    },
    {
      extensionPoint: "ChatMessageRenderer",
      component: ExampleChatMessageRenderer,
      priority: 50,
    },
    {
      extensionPoint: "ChatTopLeftAccessory",
      component: ExampleChatTopLeftAccessory,
      priority: 50,
    },
    {
      extensionPoint: "EratoEmailCodeBlock",
      component: ExampleEratoEmailCodeBlock,
      priority: 50,
    },
  ],
};

window.ERATO_COMPONENT_KITS ??= [];
window.ERATO_COMPONENT_KITS.push(componentKit);
