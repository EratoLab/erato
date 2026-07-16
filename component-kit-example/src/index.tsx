import "./style.css";

import { ERATO_SHARED_SURFACE_VERSION } from "@erato/frontend/shared";

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

// Version handshake against the host's shared import-map surface. The map
// resolves this import to the running host's chunk, so a mismatch means the
// kit was built against a different host generation.
const EXPECTED_SHARED_SURFACE_VERSION = 1;
if (ERATO_SHARED_SURFACE_VERSION !== EXPECTED_SHARED_SURFACE_VERSION) {
  // eslint-disable-next-line no-console
  console.error(
    `component-kit-example: host shared surface v${ERATO_SHARED_SURFACE_VERSION} does not match the kit's expected v${EXPECTED_SHARED_SURFACE_VERSION}; UI may misbehave`,
  );
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
