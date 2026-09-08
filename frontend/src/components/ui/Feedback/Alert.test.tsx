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

    expect(alert).toHaveAttribute("data-ui", "alert");
    expect(alert).toHaveAttribute("data-tone", "info");
    expect(alert).toHaveClass("alert-geometry", "gap-3", "p-3");
    expect(alert.className).not.toContain("rounded-md");
    expect(alert.className).not.toContain("message-frame-geometry");
    expect(alert.getAttribute("style")).toBeNull();
  });

  it("supports opt-in message geometry for chat surfaces", () => {
    render(
      <Alert type="error" geometryVariant="message">
        Alert content
      </Alert>,
    );

    const alert = screen.getByRole("alert");

    expect(alert).toHaveAttribute("data-ui", "alert");
    expect(alert).toHaveAttribute("data-tone", "error");
    expect(alert).toHaveClass("message-frame-geometry");
    expect(alert.className).not.toContain("alert-geometry");
    expect(alert).not.toHaveClass("gap-3");
    expect(alert).not.toHaveClass("p-3");
    expect(alert.getAttribute("style")).toBeNull();
  });
});
