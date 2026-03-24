import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolCallItem } from "./ToolCallItem";

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
