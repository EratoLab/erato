import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssistantBrowserModal } from "../AssistantBrowserModal";

import type { AssistantToolsMenuDescriptionDisplay } from "@/app/env";

const assistant = {
  id: "researcher",
  name: "Researcher",
  description: "A detailed assistant description that can span multiple lines.",
};

describe("assistant descriptions in the assistant dialog", () => {
  it.each([undefined, "none", "truncated", "full"] as const)(
    "supports description display %s",
    (descriptionDisplay: AssistantToolsMenuDescriptionDisplay | undefined) => {
      render(
        <AssistantBrowserModal
          isOpen
          onClose={vi.fn()}
          assistants={[assistant]}
          onSelect={vi.fn()}
          descriptionDisplay={descriptionDisplay}
        />,
      );

      expect(screen.getByText(assistant.name)).toBeInTheDocument();
      if (descriptionDisplay === "none") {
        expect(
          screen.queryByText(assistant.description),
        ).not.toBeInTheDocument();
      } else if (descriptionDisplay === "full") {
        expect(screen.getByText(assistant.description)).not.toHaveClass(
          "truncate",
        );
      } else {
        expect(screen.getByText(assistant.description)).toHaveClass(
          "truncate",
        );
      }
    },
  );
});
