import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatInputControlsProvider } from "@/components/ui/Chat/ChatInputControlsContext";

import { AssistantWelcomeContent } from "./AssistantWelcomeContent";

vi.mock("@/hooks/ui/usePageAlignment", () => ({
  usePageAlignment: () => ({ justifyAlignment: "" }),
}));
vi.mock("@/providers/FeatureConfigProvider", () => ({
  useStarterPromptsFeature: () => {
    throw new Error("Assistant prompts must not read the home feature flag");
  },
}));

describe("AssistantWelcomeContent", () => {
  it("renders Markdown and fills the draft without changing model, facets or attachments", () => {
    const controls = {
      setDraftMessage: vi.fn(),
      focusInput: vi.fn(),
      setSelectedFacetIds: vi.fn(),
      setSelectedChatProviderId: vi.fn(),
      toggleFacetId: vi.fn(),
      addUploadedFiles: vi.fn(),
      removeUploadedFiles: vi.fn(),
      clearQueuedMessage: vi.fn(),
    };
    render(
      <ChatInputControlsProvider value={controls}>
        <AssistantWelcomeContent
          assistant={{
            welcome_message: "## Welcome",
            starter_prompts: [
              { name: "Get started", prompt: "Help with my task" },
            ],
          }}
        />
      </ChatInputControlsProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Welcome" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(controls.setDraftMessage).toHaveBeenCalledWith("Help with my task", {
      focus: false,
    });
    expect(controls.focusInput).toHaveBeenCalledOnce();
    expect(controls.setSelectedFacetIds).not.toHaveBeenCalled();
    expect(controls.setSelectedChatProviderId).not.toHaveBeenCalled();
    expect(controls.addUploadedFiles).not.toHaveBeenCalled();
    expect(controls.removeUploadedFiles).not.toHaveBeenCalled();
  });
  it("renders nothing for an unconfigured assistant", () => {
    const { container } = render(
      <AssistantWelcomeContent
        assistant={{ welcome_message: null, starter_prompts: [] }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
