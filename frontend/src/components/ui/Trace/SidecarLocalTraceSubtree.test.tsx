import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  recordSidecarLocalTrace,
  resetSidecarLocalTracesForTests,
} from "@/lib/desktopSidecar/localTraceStore";

import { SidecarLocalTraceSubtree } from "./SidecarLocalTraceSubtree";

const TRACE = {
  steps: [
    {
      sequence: 0,
      id: "buildIndex",
      status: "ok",
      startedAtOffsetMs: 0,
      durationMs: 1200,
      cacheHit: true,
    },
    {
      sequence: 1,
      id: "summarize",
      status: "ok",
      startedAtOffsetMs: 1200,
      durationMs: 4300,
      model: "qwen3:14b",
    },
  ],
  totalDurationMs: 5600,
};

describe("SidecarLocalTraceSubtree", () => {
  afterEach(() => resetSidecarLocalTracesForTests());

  it("renders nothing for a tool call without a trace", () => {
    const { container } = render(
      <SidecarLocalTraceSubtree toolCallId="call-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the session trace when no result was persisted (declined path)", () => {
    recordSidecarLocalTrace("call-1", TRACE);
    render(<SidecarLocalTraceSubtree toolCallId="call-1" />);
    expect(screen.getByTestId("sidecar-trace")).toBeInTheDocument();
    expect(screen.getAllByText(/qwen3:14b/).length).toBeGreaterThan(0);
    expect(screen.getByText(/from cache/)).toBeInTheDocument();
  });

  it("prefers the persisted result trace so it survives a reload", () => {
    render(
      <SidecarLocalTraceSubtree
        toolCallId="call-2"
        toolName="search_sidecar_mailbox"
        output={{ status: "success", result: { localTrace: TRACE } }}
      />,
    );
    expect(screen.getByTestId("sidecar-trace")).toBeInTheDocument();
  });

  it("ignores a persisted trace on a tool that is not a sidecar tool", () => {
    const { container } = render(
      <SidecarLocalTraceSubtree
        toolCallId="call-2"
        toolName="some_server_tool"
        output={{ status: "success", result: { localTrace: TRACE } }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("degrades a malformed persisted trace to nothing instead of throwing", () => {
    const { container } = render(
      <SidecarLocalTraceSubtree
        toolCallId="call-2"
        toolName="search_sidecar_mailbox"
        output={{ status: "success", result: { localTrace: {} } }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders unknown step ids and statuses verbatim", () => {
    recordSidecarLocalTrace("call-3", {
      steps: [{ sequence: 0, id: "futureStep", status: "futureStatus" }],
    });
    render(<SidecarLocalTraceSubtree toolCallId="call-3" />);
    expect(screen.getByText("futureStep")).toBeInTheDocument();
    expect(screen.getByText(/futureStatus/)).toBeInTheDocument();
  });
});
