import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DelegatedRunHeader } from "./DelegatedRunHeader";

import type { DelegatedRunHeaderProps } from "./DelegatedRunHeader";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const run = (
  overrides: Partial<DelegatedRunHeaderProps> = {},
): DelegatedRunHeaderProps => ({
  provenanceKind: "delegation",
  originChatId: "origin-1",
  originChatTitle: "Quarterly planning",
  originAssistantId: "assistant-9",
  assistantName: "Research Helper",
  ...overrides,
});

describe("DelegatedRunHeader", () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  it("routes the origin link through the SPA instead of reloading", () => {
    render(<DelegatedRunHeader {...run()} />);

    fireEvent.click(screen.getByTestId("delegated-run-origin-link"));
    expect(navigateMock).toHaveBeenCalledWith("/a/assistant-9/origin-1");

    // Cmd/ctrl-click keeps the browser's open-in-new-tab behaviour. The
    // document-level listener only keeps jsdom from following the href.
    navigateMock.mockClear();
    const swallowNavigation = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("click", swallowNavigation);
    fireEvent.click(screen.getByTestId("delegated-run-origin-link"), {
      metaKey: true,
    });
    document.removeEventListener("click", swallowNavigation);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("names the run, its delegate and the conversation that dispatched it", () => {
    render(<DelegatedRunHeader {...run()} />);

    const header = screen.getByTestId("delegated-run-header");
    expect(header).toHaveTextContent("Delegated run");
    expect(header).toHaveTextContent("Research Helper");
    const origin = screen.getByTestId("delegated-run-origin-link");
    expect(origin).toHaveTextContent("From Quarterly planning");
    expect(origin).toHaveAttribute("href", "/a/assistant-9/origin-1");
  });

  it("labels a deleted origin without linking to it", () => {
    render(
      <DelegatedRunHeader
        {...run({ originChatTitle: undefined, originAssistantId: undefined })}
      />,
    );

    expect(
      screen.queryByTestId("delegated-run-origin-link"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("delegated-run-origin")).toHaveTextContent(
      "From a conversation that no longer exists",
    );
  });

  it("links an untitled origin that still exists", () => {
    render(
      <DelegatedRunHeader {...run({ originChatTitle: "Untitled Chat" })} />,
    );

    expect(screen.getByTestId("delegated-run-origin-link")).toHaveTextContent(
      "From an untitled conversation",
    );
  });

  it("renders the run parameters as labelled fields and omits absent ones", () => {
    render(
      <DelegatedRunHeader
        {...run({ expectedOutput: "One number per line." })}
      />,
    );

    expect(screen.getByText("Expected output")).toBeInTheDocument();
    expect(screen.getByText("One number per line.")).toBeInTheDocument();
    expect(screen.queryByText("Constraints")).not.toBeInTheDocument();
  });

  it("shows neither field list nor state note for a bare run", () => {
    render(<DelegatedRunHeader {...run()} />);

    expect(screen.queryByText("Expected output")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delegated-run-state")).not.toBeInTheDocument();
  });

  it("explains the states that refuse a message", () => {
    const { rerender } = render(
      <DelegatedRunHeader {...run({ isRunning: true })} />,
    );
    expect(screen.getByTestId("delegated-run-state")).toHaveTextContent(
      "The delegate is still working on this run.",
    );

    rerender(<DelegatedRunHeader {...run({ isArchived: true })} />);
    expect(screen.getByTestId("delegated-run-state")).toHaveTextContent(
      "This run is archived and no longer takes messages.",
    );
  });

  it("never says the run-behaviour boilerplate the delegate was given", () => {
    render(
      <DelegatedRunHeader
        {...run({
          expectedOutput: "One number per line.",
          constraints: "Only the attached figures.",
        })}
      />,
    );

    const header = screen.getByTestId("delegated-run-header");
    expect(header).not.toHaveTextContent("clarifying questions");
    expect(header).not.toHaveTextContent("system-reminder");
  });

  it("renders nothing for a chat that is not a delegated run", () => {
    const { container } = render(
      <DelegatedRunHeader {...run({ provenanceKind: undefined })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a handoff, which carries provenance too", () => {
    const { container } = render(
      <DelegatedRunHeader {...run({ provenanceKind: "handoff_branch" })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
