import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  recordSidecarLocalTrace,
  useSidecarLocalTraceStore,
} from "@/lib/desktopSidecar/localTraceStore";

import { ToolUseStep } from "./ToolUseStep";

import type { ToolDecision } from "../Trace";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const PART = {
  content_type: "tool_use",
  tool_call_id: "call-live",
  tool_name: "search_sidecar_mailbox",
  status: "in_progress",
  input: { query: "invoices" },
  output: null,
} as unknown as ToolUse & { content_type: "tool_use" };

const renderRunningStep = () =>
  render(
    <ToolUseStep
      part={PART}
      status="running"
      isStreaming
      isCollapsed={false}
      isLastStep
    />,
  );

/** Whether the node sits inside a collapsed (0fr) trace body. */
const isFolded = (node: HTMLElement): boolean =>
  node.closest('div[style*="0fr"]') !== null;

describe("ToolUseStep sidecar trace", () => {
  afterEach(() => useSidecarLocalTraceStore.setState({ traces: {} }));

  it("labels argument generation as Preparing and shows incomplete input only in details", () => {
    render(
      <ToolUseStep
        part={{
          ...PART,
          tool_name: "submit_draft",
          status: "preparing",
          input: '{"title":"Hel' as unknown as ToolUse["input"],
        }}
        status="running"
        isStreaming
        isCollapsed={false}
        isLastStep
      />,
    );
    expect(screen.getByText("Preparing")).toBeInTheDocument();
    const input = screen.getByText(/Input Parameters/i);
    expect(isFolded(input)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /submit_draft/ }));
    expect(isFolded(input)).toBe(false);
    expect(
      screen.getByText('{"title":"Hel', { exact: false }),
    ).toBeInTheDocument();
  });

  it("streams on-device steps in as visible rows, without tool-level payload JSON", () => {
    renderRunningStep();
    act(() => {
      recordSidecarLocalTrace("call-live", {
        steps: [
          { sequence: 0, id: "buildIndex", status: "ok" },
          {
            sequence: 1,
            id: "expandQuery",
            status: "running",
            model: "qwen3:14b",
          },
        ],
      });
    });

    const trace = screen.getByTestId("sidecar-trace");
    expect(isFolded(trace)).toBe(false);
    expect(screen.getByText("Read local mailbox")).toBeInTheDocument();
    expect(screen.getByText("Expand query on device")).toBeInTheDocument();
    // A trace-bearing call renders no Input Parameters / Output sections:
    // real payloads only ever belong to an individual step.
    expect(screen.queryByText(/Input Parameters/i)).toBeNull();
  });

  it("folds and unfolds the rows with the tool step's own toggle", () => {
    renderRunningStep();
    act(() => {
      recordSidecarLocalTrace("call-live", {
        steps: [{ sequence: 0, id: "buildIndex", status: "ok" }],
      });
    });
    const trace = screen.getByTestId("sidecar-trace");
    expect(isFolded(trace)).toBe(false);

    const toolToggle = screen.getByRole("button", {
      name: /search_sidecar_mailbox/,
    });
    fireEvent.click(toolToggle);
    expect(isFolded(trace)).toBe(true);
    fireEvent.click(toolToggle);
    expect(isFolded(trace)).toBe(false);
  });

  it("reveals a nested step's own details only when that step is toggled", () => {
    renderRunningStep();
    act(() => {
      recordSidecarLocalTrace("call-live", {
        steps: [
          {
            sequence: 0,
            id: "expandQuery",
            status: "degraded",
            model: "qwen3:14b",
            detail: "local query expansion unavailable",
          },
        ],
      });
    });

    const detail = screen.getByText("local query expansion unavailable");
    expect(isFolded(detail)).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: /Expand query on device/ }),
    );
    expect(isFolded(detail)).toBe(false);
  });

  it("renders a step without extra details as a plain row without a toggle", () => {
    renderRunningStep();
    act(() => {
      recordSidecarLocalTrace("call-live", {
        steps: [{ sequence: 0, id: "match", status: "ok" }],
      });
    });

    expect(
      screen.getByText("Match messages and attachments"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Match messages and attachments/ }),
    ).toBeNull();
  });

  it("names the MCP server saved with the call next to the tool", () => {
    render(
      <ToolUseStep
        part={{
          ...PART,
          tool_name: "create_record",
          status: "success",
          display: {
            title: "create_record",
            description_truncated: false,
            server_name: "Dynamics 365",
          },
        }}
        status="done"
        isStreaming={false}
        isCollapsed={false}
        isLastStep
      />,
    );

    expect(
      screen.getByRole("button", { name: /create_record/ }),
    ).toHaveTextContent("Dynamics 365");
  });

  it("keeps payloads behind the toggle for tools without a trace", () => {
    render(
      <ToolUseStep
        part={{
          ...PART,
          tool_call_id: "call-plain",
          tool_name: "some_server_tool",
        }}
        status="done"
        isStreaming={false}
        isCollapsed={false}
        isLastStep
      />,
    );

    const input = screen.getByText(/Input Parameters/i);
    expect(isFolded(input)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /some_server_tool/ }));
    expect(isFolded(input)).toBe(false);
  });
});

describe("ToolUseStep decision row", () => {
  const DISPLAY = {
    title: "create_record",
    description_truncated: false,
    server_name: "Dynamics 365",
  };
  const settled = (
    overrides: Partial<ToolUse>,
    status: "done" | "error" = "done",
    decision?: ToolDecision,
  ) =>
    render(
      <ToolUseStep
        part={{
          ...PART,
          tool_name: "create_record",
          status: status === "error" ? "error" : "success",
          display: DISPLAY,
          ...overrides,
        }}
        status={status}
        isStreaming={false}
        isCollapsed={false}
        isLastStep
        decision={decision}
      />,
    );
  const decisionRow = () => screen.queryByTestId("tool-decision-row");

  it("shows an approved call that failed as failed, below who allowed it", () => {
    settled({}, "error", { status: "approved", alwaysAllow: false });

    expect(decisionRow()).toHaveTextContent("You allowed this once");
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
    expect(
      decisionRow()?.compareDocumentPosition(
        screen.getByRole("button", { name: /create_record/ }),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("notes a write that ran without asking, but not a read", () => {
    const { unmount } = settled({ allowed_by: "policy" });
    expect(decisionRow()).toHaveTextContent("Ran without asking");
    unmount();

    settled({
      allowed_by: "policy",
      display: { ...DISPLAY, read_only: true },
    });
    expect(decisionRow()).not.toBeInTheDocument();
  });

  it("says when the user's saved always allow skipped the card, on reads too", () => {
    settled({
      allowed_by: "always_allow",
      display: { ...DISPLAY, read_only: true },
    });

    expect(decisionRow()).toHaveTextContent(
      "Ran under your earlier “Always allow”",
    );
  });

  it("shows a denied call's decision and no Failed", () => {
    settled(
      { output: { status: "rejected" } as unknown as ToolUse["output"] },
      "error",
      {
        status: "denied",
        neverAllow: true,
        withdrawn: false,
      },
    );

    expect(decisionRow()).toHaveTextContent("You chose “Never allow”");
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("shows a call the gate refused without a card as not run, not Failed", () => {
    settled(
      { output: { status: "rejected" } as unknown as ToolUse["output"] },
      "error",
    );

    expect(decisionRow()).toHaveTextContent("Not run");
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it.each([
    [{ status: "approved", alwaysAllow: true }, "You chose “Always allow”"],
    [
      { status: "approved", alwaysAllow: false, covers: "document" },
      "You allowed this for this document",
    ],
    [
      { status: "approved", alwaysAllow: false, covers: "turn" },
      "You allowed this for this response",
    ],
    [
      { status: "denied", neverAllow: false, withdrawn: true },
      "Not run: you no longer allow this tool",
    ],
  ] as [ToolDecision, string][])("words the decision %o", (decision, text) => {
    settled({}, decision.status === "denied" ? "error" : "done", decision);

    expect(decisionRow()).toHaveTextContent(text);
  });

  it("gives an old row without a decision or allowed_by no decision row", () => {
    settled({ display: undefined });

    expect(decisionRow()).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create_record/ }),
    ).toBeInTheDocument();
  });
});
