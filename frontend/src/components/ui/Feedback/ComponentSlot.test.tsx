import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";

import { ComponentSlot } from "./ComponentSlot";

import type { AlertProps } from "./Alert";

const Own = ({ children }: AlertProps) => <span>own {children}</span>;
const Kit = ({ children }: AlertProps) => <span>kit {children}</span>;
const Broken = (_: AlertProps): never => {
  throw new Error("kit failed");
};

const renderSlot = (children: string) =>
  render(
    <ComponentSlot
      extensionPoint="DesktopReviewNotice"
      fallback={Own}
      slotProps={{ type: "info", children }}
    />,
  );

describe("ComponentSlot", () => {
  afterEach(() => {
    componentRegistry.DesktopReviewNotice = null;
  });

  it("renders the host's component without an override", () => {
    renderSlot("a");
    expect(screen.getByText("own a")).toBeDefined();
  });

  it("renders the registered override with the same props", () => {
    componentRegistry.DesktopReviewNotice = Kit;
    renderSlot("b");
    expect(screen.getByText("kit b")).toBeDefined();
  });

  it("falls back to the host's component when the override throws", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    componentRegistry.DesktopReviewNotice = Broken;
    renderSlot("c");
    expect(screen.getByText("own c")).toBeDefined();
    expect(
      logged.mock.calls.some(([message]) =>
        String(message).includes("override of DesktopReviewNotice failed"),
      ),
    ).toBe(true);
    logged.mockRestore();
  });
});
