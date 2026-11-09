import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComponentSlot } from "./ComponentSlot";

const Own = ({ label }: { label: string }) => <span>own {label}</span>;
const Kit = ({ label }: { label: string }) => <span>kit {label}</span>;
const Broken = (_: { label: string }): never => {
  throw new Error("kit failed");
};

describe("ComponentSlot", () => {
  it("renders the host's component without an override", () => {
    render(
      <ComponentSlot
        name="Point"
        override={null}
        fallback={Own}
        slotProps={{ label: "a" }}
      />,
    );
    expect(screen.getByText("own a")).toBeDefined();
  });

  it("renders the override with the same props", () => {
    render(
      <ComponentSlot
        name="Point"
        override={Kit}
        fallback={Own}
        slotProps={{ label: "b" }}
      />,
    );
    expect(screen.getByText("kit b")).toBeDefined();
  });

  it("falls back to the host's component when the override throws", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ComponentSlot
        name="Point"
        override={Broken}
        fallback={Own}
        slotProps={{ label: "c" }}
      />,
    );
    expect(screen.getByText("own c")).toBeDefined();
    expect(
      logged.mock.calls.some(([message]) =>
        String(message).includes("override of Point failed"),
      ),
    ).toBe(true);
    logged.mockRestore();
  });
});
