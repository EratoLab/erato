import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { ChatErrorBoundary } from "./ChatErrorBoundary";

function Thrower({ fail }: { fail: { current: boolean } }) {
  if (fail.current) throw new Error("Chat exploded");
  return <p>Chat content</p>;
}

describe("ChatErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the error with a retry that resets and renders the chat again", () => {
    const fail = { current: true };
    const onReset = vi.fn(() => {
      fail.current = false;
    });
    render(
      <StaticFeatureConfigProvider>
        <ChatErrorBoundary onReset={onReset}>
          <Thrower fail={fail} />
        </ChatErrorBoundary>
      </StaticFeatureConfigProvider>,
    );

    expect(screen.getByText("Chat exploded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Chat content")).toBeInTheDocument();
  });

  it("keeps its children mounted across re-renders", () => {
    const mounts = vi.fn();
    function Child() {
      useState(mounts);
      return null;
    }
    const { rerender } = render(
      <ChatErrorBoundary onReset={() => {}}>
        <Child />
      </ChatErrorBoundary>,
    );
    rerender(
      <ChatErrorBoundary onReset={() => {}}>
        <Child />
      </ChatErrorBoundary>,
    );

    expect(mounts).toHaveBeenCalledTimes(1);
  });
});
