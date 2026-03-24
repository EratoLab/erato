import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Alert } from "./Alert";

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "icon-id",
}));

vi.mock("../Controls/Button", () => ({
  Button: ({
    children,
    className,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: React.ReactNode;
  }) => (
    <button className={className} {...props}>
      {icon}
      {children}
    </button>
  ),
}));

vi.mock("../icons", () => ({
  CloseIcon: () => <svg aria-hidden="true" />,
  ResolvedIcon: () => <svg aria-hidden="true" />,
}));

describe("Alert", () => {
  it("keeps the shared alert primitive on its default geometry", () => {
    render(<Alert type="info">Alert content</Alert>);

    const alert = screen.getByRole("alert");

    expect(alert.className).toContain("gap-3");
    expect(alert.className).toContain("rounded-md");
    expect(alert.className).toContain("p-3");
    expect(alert.getAttribute("style")).toBeNull();
  });

  it("supports opt-in message geometry for chat surfaces", () => {
    render(
      <Alert type="info" geometryVariant="message">
        Alert content
      </Alert>,
    );

    const alert = screen.getByRole("alert");

    expect(alert).toHaveStyle({
      borderRadius: "var(--theme-radius-message)",
      gap: "var(--theme-spacing-control-gap)",
      padding:
        "var(--theme-spacing-message-padding-y) var(--theme-spacing-message-padding-x)",
    });
  });
});
