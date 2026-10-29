import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { DelegatedRunOpenProvider } from "@/providers/DelegatedRunOpenProvider";

import { ParkedTaskNotice } from "./ParkedTaskNotice";

import type { ReactElement } from "react";

const renderNotice = (ui: ReactElement) =>
  render(<ThemeProvider enableCustomTheme={false}>{ui}</ThemeProvider>);

describe("ParkedTaskNotice", () => {
  it("says where the decision waits and opens the task in a new tab", () => {
    renderNotice(
      <ParkedTaskNotice childChatId="child-1" brief="Publish the notes" />,
    );

    expect(screen.getByTestId("parked-task-notice")).toHaveTextContent(
      "This task is waiting for your decision in its own chat.",
    );
    expect(screen.getByText("Publish the notes")).toBeInTheDocument();
    const link = screen.getByTestId("parked-task-open");
    expect(link).toHaveAttribute("href", "/chat/child-1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("opens the task through the host when it has its own opener", () => {
    const onOpen = vi.fn();
    renderNotice(
      <DelegatedRunOpenProvider onOpen={onOpen}>
        <ParkedTaskNotice childChatId="child-1" />
      </DelegatedRunOpenProvider>,
    );

    const open = screen.getByTestId("parked-task-open");
    expect(open.tagName).toBe("BUTTON");
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledWith("child-1");
  });

  it("says a task waits for the device when its slot is client_pending", () => {
    renderNotice(
      <ParkedTaskNotice
        childChatId="child-1"
        brief="Check the calendar"
        reason="client_pending"
      />,
    );

    expect(screen.getByTestId("parked-task-notice")).toHaveTextContent(
      "This task is waiting for one of its calls to run on this device.",
    );
    expect(screen.getByTestId("parked-task-open")).toHaveAttribute(
      "href",
      "/chat/child-1",
    );
  });
});
