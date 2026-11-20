import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Collapse } from "./Collapse";

const gridOf = (text: string) =>
  screen.getByText(text).closest("div.grid") as HTMLElement;

describe("Collapse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("animates by default", () => {
    render(<Collapse isOpen={false}>Body</Collapse>);
    expect(gridOf("Body").className).toContain(
      "transition-[grid-template-rows]",
    );
  });

  it("opens and closes at once while its content is taller than the viewport", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
      window.innerHeight * 3,
    );

    render(
      <Collapse isOpen instantWhenTall>
        Long body
      </Collapse>,
    );
    expect(gridOf("Long body").className).not.toContain(
      "transition-[grid-template-rows]",
    );
  });
});
