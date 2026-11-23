import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssistantBrowserModal } from "./AssistantBrowserModal";

import type { MentionableAssistant } from "@/hooks/chat/useMentionableAssistants";

const contracts: MentionableAssistant = {
  id: "a-contracts",
  name: "Contract check",
  description: "Flags unusual clauses",
};
const minutes: MentionableAssistant = {
  id: "a-minutes",
  name: "Meeting minutes",
  description: "Turns notes into minutes",
};
const sales: MentionableAssistant = {
  id: "a-sales",
  name: "Vertrieb Dynamics",
  description: "Meeting briefing from CRM and ERP",
};

const optionNames = () =>
  screen
    .getAllByTestId(/^chat-input-mention-browse-option-/)
    .map((option) =>
      option.dataset.testid?.replace("chat-input-mention-browse-option-", ""),
    );

const renderModal = (
  props: Partial<Parameters<typeof AssistantBrowserModal>[0]> = {},
) => {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <AssistantBrowserModal
      isOpen
      onClose={onClose}
      assistants={[contracts, minutes, sales]}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { onSelect, onClose };
};

describe("AssistantBrowserModal", () => {
  it("is titled for asking an assistant and says the chat keeps its own", () => {
    renderModal();

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Ask an assistant");
    expect(
      screen.getByText(
        "Hands your message to the assistant you pick. This chat stays as it is.",
      ),
    ).toBeInTheDocument();
  });

  it("lists the ones the user turns to most first while nothing is searched", () => {
    renderModal({ suggested: [sales] });

    expect(optionNames()).toEqual(["a-sales", "a-contracts", "a-minutes"]);
  });

  it("finds an assistant by its description", () => {
    renderModal();

    fireEvent.change(screen.getByTestId("chat-input-mention-browse-search"), {
      target: { value: "CRM" },
    });

    expect(optionNames()).toEqual(["a-sales"]);
  });

  it("hides the descriptions when the deployment says so", () => {
    renderModal({ descriptionDisplay: "none" });

    expect(screen.queryByText("Flags unusual clauses")).not.toBeInTheDocument();
  });

  it("mentions the picked assistant and closes", () => {
    const { onSelect, onClose } = renderModal();

    fireEvent.click(
      screen.getByTestId("chat-input-mention-browse-option-a-minutes"),
    );

    expect(onSelect).toHaveBeenCalledWith(minutes);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
