import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { extractToolCallsFromContent } from "@/utils/adapters/toolCallAdapter";

import { ToolCallItem } from "./ToolCallItem";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

vi.mock("@/components/ui/icons", () => ({
  ResolvedIcon: () => <svg aria-hidden="true" />,
}));

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: (_category: string, key: string) => key,
}));

describe("ToolCallItem", () => {
  it.each([
    ["success", "Success", "bg-theme-success-bg", "text-theme-success-fg"],
    ["error", "Error", "bg-theme-error-bg", "text-theme-error-fg"],
    ["in_progress", "In Progress", "bg-theme-info-bg", "text-theme-info-fg"],
    ["preparing", "Preparing", "bg-theme-info-bg", "text-theme-info-fg"],
  ] as const)(
    "uses semantic status tokens for the %s expanded row pill",
    (status, label, backgroundClass, foregroundClass) => {
      render(
        <ToolCallItem
          toolCall={{
            id: `call-${status}`,
            name: "Search tool",
            status,
          }}
        />,
      );

      const statusPill = screen.getByText(label);

      expect(statusPill.className).toContain(backgroundClass);
      expect(statusPill.className).toContain(foregroundClass);
    },
  );
});

it("renders all 37 saved Gemini lookups with their own results", () => {
  const content = Array.from({ length: 37 }, (_, index) => ({
    content_type: "tool_use",
    tool_call_id: `01a0f45a-6fea-7d38-b761-25f0b0436423:${Math.floor(index / 5)}:provider:call-${index % 5}`,
    tool_name: "lookup_person",
    status: "success",
    input: `person-query-${index}`,
    output: `person-result-${index}`,
  })) as unknown as ContentPart[];
  const calls = extractToolCallsFromContent(content);
  render(
    <>
      {calls.map((call) => (
        <ToolCallItem key={call.id} toolCall={call} />
      ))}
    </>,
  );
  const rows = screen.getAllByTestId("tool-call-item");
  expect(rows).toHaveLength(37);
  for (const [index, row] of rows.entries()) {
    fireEvent.click(within(row).getByRole("button"));
    expect(
      within(row).getByText(JSON.stringify(`person-query-${index}`)),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(JSON.stringify(`person-result-${index}`)),
    ).toBeInTheDocument();
  }
});
