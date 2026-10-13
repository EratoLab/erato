import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatInputAddMenu } from "../ChatInputAddMenu";
import { FacetSelector } from "../FacetSelector";
import { buildAssistantMentionSection } from "../assistantMentionSection";

import type { AssistantToolsMenuDescriptionDisplay } from "@/app/env";

const assistant = {
  id: "researcher",
  name: "Researcher",
  description: "A detailed assistant description that can span multiple lines.",
};

describe.each(["desktop", "mobile"])(
  "assistant descriptions in %s menus",
  (host) => {
    it.each([undefined, "none", "truncated", "full"] as const)(
      "supports description display %s",
      async (
        descriptionDisplay: AssistantToolsMenuDescriptionDisplay | undefined,
      ) => {
        const section = buildAssistantMentionSection({
          assistants: [assistant],
          descriptionDisplay,
          onSelect: vi.fn(),
          onBrowse: vi.fn(),
        });
        if (host === "desktop") {
          render(
            <FacetSelector
              facets={[]}
              selectedFacetIds={[]}
              onSelectionChange={vi.fn()}
              onlySingleFacet={false}
              showFacetIndicatorWithDisplayName={false}
              assistantSection={section}
            />,
          );
        } else {
          render(<ChatInputAddMenu extraSections={[section]} />);
        }
        fireEvent.click(
          screen.getByRole("button", {
            name: host === "desktop" ? "Open menu" : "Add files and tools",
          }),
        );
        expect(await screen.findByText(assistant.name)).toBeInTheDocument();
        if (descriptionDisplay === "none") {
          expect(
            screen.queryByText(assistant.description),
          ).not.toBeInTheDocument();
        } else {
          const description = screen.getByText(assistant.description);
          if (descriptionDisplay === "full") {
            expect(description).not.toHaveClass("line-clamp-2");
            expect(description).toHaveClass("whitespace-normal");
          } else {
            expect(description).toHaveClass(
              "line-clamp-2",
              "whitespace-normal",
            );
            expect(description).not.toHaveClass("truncate", "block");
          }
        }
      },
    );
  },
);
