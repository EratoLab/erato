import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResolvedIcon } from "./ResolvedIcon";

vi.mock("virtual:erato-icon-catalogs", async () => {
  const { forwardRef } = await import("react");
  return {
    loadSimpleIconBucket: vi.fn(async (bucket: string) =>
      bucket === "e"
        ? {
            erato: {
              title: "Erato",
              path: "M0 0h24v24H0z",
            },
          }
        : {},
    ),
    loadIconoirIconBucket: vi.fn(async (bucket: string) =>
      bucket === "a"
        ? {
            airplane: forwardRef<SVGSVGElement>(() => (
              <svg data-testid="deferred-iconoir-icon" />
            )),
          }
        : {},
    ),
  };
});

describe("ResolvedIcon", () => {
  it("renders built-in and Iconoir icons synchronously", () => {
    const { rerender } = render(<ResolvedIcon iconId="builtin-chatgpt" />);
    expect(screen.getByTitle("ChatGPT")).toBeInTheDocument();

    rerender(<ResolvedIcon iconId="tools" />);
    expect(document.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByTitle("Erato")).not.toBeInTheDocument();
  });

  it("loads a Simple Icons brand only when Iconoir cannot resolve it", async () => {
    render(<ResolvedIcon iconId="erato" />);

    expect(await screen.findByTitle("Erato")).toBeInTheDocument();
  });

  it("loads an uncommon Iconoir icon on demand", async () => {
    render(<ResolvedIcon iconId="airplane" />);

    expect(
      await screen.findByTestId("deferred-iconoir-icon"),
    ).toBeInTheDocument();
  });
});
