import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recordSidecarLocalTrace,
  useSidecarLocalTraceStore,
} from "@/lib/desktopSidecar/localTraceStore";
import { WORD_SUBMIT_COMMENT_CHANGES_TOOL } from "@/lib/wordReview/wordCommentChanges";

import { ToolUseStep } from "./ToolUseStep";

import type { ToolDecision } from "../Trace";
import type {
  ToolCallLabel,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

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

describe("ToolUseStep with a change description", () => {
  const change = {
    effects: [
      { path: "/owner", name: "Owner", raw_name: "owner", effect: "emptied" },
      {
        path: "/stage",
        name: "Stage",
        raw_name: "stage",
        effect: "changed",
        values: [{ text: "customer" }],
        old: { text: "lead" },
      },
    ],
    counts: { emptied: 1, changed: 1, unchanged: 10 },
    complete: true,
  };
  const label = {
    action: "update",
    object_kind: "row",
    source: "rules",
    items: [
      {
        title: {
          pointer: "/name",
          values: [{ path: "/name", text: "Tailspin Toys" }],
        },
      },
    ],
    change,
  };

  it("says the sentence in the past tense with counts and losses", () => {
    render(
      <ToolUseStep
        part={
          {
            content_type: "tool_use",
            tool_call_id: "call",
            tool_name: "update_company",
            status: "success",
            input: { name: "Tailspin Toys" },
            output: {},
            display: { title: "Update", label },
          } as unknown as ToolUse & { content_type: "tool_use" }
        }
        status="done"
        isStreaming={false}
        isCollapsed={false}
        isLastStep
      />,
    );
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      /^Updated row Tailspin Toys$/,
    );
    const counts = screen.getByTestId("trace-step-title-after");
    expect(counts).toHaveTextContent("· 1 emptied, 1 changed, 10 unchanged");
    // A long title wraps to a second line rather than losing a verb that
    // comes last; the counts after it are never cut with it.
    expect(counts.closest(".truncate")).toBeNull();
    const title = screen.getByTestId("tool-call-gist-line").parentElement!;
    expect(title).toHaveClass("line-clamp-2");
    expect(title).not.toHaveClass("truncate");
    // One line: losses first, then values as they are now.
    const details = screen.getByTestId("tool-call-change-row-details");
    expect(details).toHaveTextContent("Emptied: Owner · Stage → customer");
  });

  it("puts the counts right after the sentence, after a middle dot", () => {
    const row = (itemLabel: object) =>
      render(
        <ToolUseStep
          part={
            {
              content_type: "tool_use",
              tool_call_id: "call",
              tool_name: "save_issue",
              status: "success",
              input: {
                name: "Tailspin Toys",
                id: "5f0c2a10-0000-4000-8000-00000000a001",
              },
              output: {},
              display: {
                title: "Save",
                server_name: "Tracker",
                label: { ...label, ...itemLabel },
              },
            } as unknown as ToolUse & { content_type: "tool_use" }
          }
          status="done"
          isStreaming={false}
          isCollapsed={false}
          isLastStep
        />,
      );
    const named = row({});
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      /^Updated row Tailspin Toys$/,
    );
    expect(screen.getByTestId("trace-step-title-after")).toHaveTextContent(
      /^· 1 emptied, 1 changed, 10 unchanged\s*Tracker$/,
    );
    named.unmount();

    row({
      items: [
        {
          id: {
            pointer: "/id",
            values: [
              {
                path: "/id",
                text: "5f0c2a10-0000-4000-8000-00000000a001",
                machine_id: true,
              },
            ],
          },
        },
      ],
    });
    const line = screen.getByTestId("tool-call-gist-line");
    expect(line.textContent).not.toMatch(/:\s*$/);
    expect(screen.getByTestId("trace-step-title-after")).toHaveTextContent(
      /^· 1 emptied, 1 changed, 10 unchanged\s*Tracker$/,
    );
  });

  it.each([
    ["failed", "error", "Could not update row Tailspin Toys"],
    ["still running", "in_progress", "Update row Tailspin Toys"],
  ])(
    "states no counts or losses for a call that %s",
    (_name, status, sentence) => {
      render(
        <ToolUseStep
          part={
            {
              content_type: "tool_use",
              tool_call_id: "call",
              tool_name: "update_company",
              status,
              input: { name: "Tailspin Toys" },
              output: { error: "server said no" },
              display: { title: "Update", label },
            } as unknown as ToolUse & { content_type: "tool_use" }
          }
          status={status === "error" ? "error" : "running"}
          isStreaming={false}
          isCollapsed={false}
          isLastStep
        />,
      );
      expect(screen.getByTestId("tool-call-gist-line").textContent).toBe(
        sentence,
      );
      expect(screen.queryByTestId("tool-call-change-row-details")).toBeNull();
      expect(document.body.textContent).not.toContain("Emptied");
    },
  );

  it("states no counts or losses for a call the user denied", () => {
    render(
      <ToolUseStep
        part={
          {
            content_type: "tool_use",
            tool_call_id: "call",
            tool_name: "update_company",
            status: "error",
            input: { name: "Tailspin Toys" },
            output: {},
            display: { title: "Update", label },
          } as unknown as ToolUse & { content_type: "tool_use" }
        }
        decision={{ kind: "denied" } as unknown as ToolDecision}
        status="error"
        isStreaming={false}
        isCollapsed={false}
        isLastStep
      />,
    );
    expect(screen.getByTestId("tool-call-gist-line")).not.toHaveTextContent(
      "emptied",
    );
    expect(screen.queryByTestId("tool-call-change-row-details")).toBeNull();
  });

  it("keeps the raw call behind the row's toggle", () => {
    render(
      <ToolUseStep
        part={
          {
            content_type: "tool_use",
            tool_call_id: "call",
            tool_name: "update_company",
            status: "error",
            input: { name: "Tailspin Toys" },
            output: { error: "denied by server" },
            display: { title: "Update", label },
          } as unknown as ToolUse & { content_type: "tool_use" }
        }
        status="error"
        isStreaming={false}
        isCollapsed={false}
        isLastStep
      />,
    );
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      "Could not update row Tailspin Toys",
    );
    expect(screen.getByTestId("tool-failure-message")).toHaveTextContent(
      "denied by server",
    );
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

  it("shows an approved call that failed as failed, closed by where it ran and who allowed it", () => {
    settled({}, "error", { status: "approved", alwaysAllow: false });

    expect(decisionRow()).toHaveTextContent(
      /^Dynamics 365 · You allowed this once$/,
    );
    expect(decisionRow()).toHaveClass("text-xs", "text-theme-fg-muted");
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
    const title = screen.getByRole("button", { name: /create_record/ });
    // The server is named once, at the end, not in the title too.
    expect(title).not.toHaveTextContent("Dynamics 365");
    expect(title.compareDocumentPosition(decisionRow() as HTMLElement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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

  it("shows a call that ran and failed with a rejected-looking server result as Failed", () => {
    settled(
      {
        allowed_by: "policy",
        output: {
          status: "rejected",
          error: "record locked",
        } as unknown as ToolUse["output"],
      },
      "error",
    );

    expect(decisionRow()).toHaveTextContent("Ran without asking");
    expect(decisionRow()).not.toHaveTextContent("Not run");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows no note for a reason from a newer version, and a call it ran as Failed", () => {
    settled(
      {
        allowed_by: "other",
        output: {
          status: "rejected",
          error: "record locked",
        } as unknown as ToolUse["output"],
      },
      "error",
    );

    expect(decisionRow()).not.toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
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

  it.each([["selection"], [{ scope: "turn" }], [7]])(
    "words an approval for a scope it does not know (%o) plainly",
    (covers) => {
      settled({}, "done", {
        status: "approved",
        alwaysAllow: true,
        covers: covers as unknown as "turn",
      });

      expect(decisionRow()).toHaveTextContent(
        /^Dynamics 365 · You allowed this$/,
      );
    },
  );

  it("notes a write whose display carries a read_only that is not true", () => {
    settled({
      allowed_by: "policy",
      display: { ...DISPLAY, read_only: "yes" as unknown as boolean },
    });

    expect(decisionRow()).toHaveTextContent("Ran without asking");
  });

  const STEP_STATUS = {
    preparing: "running",
    in_progress: "running",
    success: "done",
    error: "error",
  } as const;
  const DECISIONS: (ToolDecision | undefined)[] = [
    undefined,
    { status: "approved", alwaysAllow: false },
    { status: "approved", alwaysAllow: true },
    { status: "approved", alwaysAllow: false, covers: "turn" },
    {
      status: "approved",
      alwaysAllow: true,
      covers: { nested: [] } as unknown as "turn",
    },
    { status: "denied", neverAllow: false, withdrawn: false },
    { status: "denied", neverAllow: true, withdrawn: false },
    { status: "denied", neverAllow: true, withdrawn: true },
  ];
  const OUTPUTS: unknown[] = [
    null,
    { status: "rejected" },
    { status: "rejected", error: "record locked" },
    "\u202Eplain <b>text</b>",
    [{ status: "rejected" }],
    { status: { status: "rejected" } },
    42,
  ];
  const DISPLAYS: unknown[] = [
    undefined,
    null,
    DISPLAY,
    { ...DISPLAY, read_only: true },
  ];

  it.each(
    (Object.keys(STEP_STATUS) as (keyof typeof STEP_STATUS)[]).flatMap(
      (rowStatus) =>
        [
          undefined,
          null,
          "policy",
          "always_allow",
          "other",
          "later_reason",
          7,
        ].map((allowedBy) => [rowStatus, allowedBy] as const),
    ),
  )(
    "renders one call with at most one decision row for status %s and allowed_by %o",
    (rowStatus, allowedBy) => {
      const stepStatus = STEP_STATUS[rowStatus];
      DECISIONS.forEach((decision, index) => {
        OUTPUTS.forEach((output) => {
          const { unmount } = render(
            <ToolUseStep
              part={{
                ...PART,
                tool_name: "create_record",
                status: rowStatus,
                output: output as ToolUse["output"],
                allowed_by: allowedBy as ToolUse["allowed_by"],
                display: DISPLAYS[
                  index % DISPLAYS.length
                ] as ToolUse["display"],
              }}
              status={stepStatus}
              isStreaming={stepStatus === "running"}
              isCollapsed={false}
              isLastStep
              decision={decision}
            />,
          );
          const context = JSON.stringify({ decision, output, allowedBy });
          expect(screen.getAllByTestId("tool-call-item"), context).toHaveLength(
            1,
          );
          const rows = screen.queryAllByTestId("tool-decision-row");
          expect(rows.length, context).toBeLessThanOrEqual(1);
          if (rows[0]) expect(rows[0].textContent, context).not.toBe("");
          const refused =
            rowStatus === "error" &&
            decision === undefined &&
            allowedBy == null &&
            (output as { status?: unknown } | null)?.status === "rejected";
          expect(rows[0]?.textContent === "Not run", context).toBe(refused);
          expect(screen.queryByText("Failed") !== null, context).toBe(
            rowStatus === "error" && decision?.status !== "denied" && !refused,
          );
          if (decision === undefined && allowedBy === "always_allow") {
            expect(rows[0], context).toHaveTextContent("Always allow");
          }
          unmount();
        });
      });
    },
  );

  it("gives an old row without a decision or allowed_by no decision row", () => {
    settled({ display: undefined });

    expect(decisionRow()).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create_record/ }),
    ).toBeInTheDocument();
  });
});

describe("ToolUseStep gist row", () => {
  const RECORD_ID = "7a2c9e10-5f6b-4d3e-8c7a-1b2c3d4e5f60";
  const updateLabel = {
    action: "update" as const,
    object_kind: "page" as const,
    source: "rules" as const,
    items: [
      {
        id: {
          pointer: "/page_id",
          values: [
            { path: "/page_id", text: RECORD_ID, resolved: "Northwind" },
          ],
        },
        fields: [
          {
            pointer: "/properties/Status",
            name: "Status",
            values: [
              {
                path: "/properties/Status",
                text: "Customer",
                resolved: "Lead",
              },
            ],
          },
        ],
      },
    ],
  };
  const labelled = (
    overrides: Partial<ToolUse>,
    status: "done" | "error" = "done",
    decision?: ToolDecision,
  ) =>
    render(
      <ToolUseStep
        part={{
          ...PART,
          tool_call_id: "call-update",
          tool_name: "update_page",
          status: status === "error" ? "error" : "success",
          input: {
            page_id: RECORD_ID,
            properties: { Status: "Customer" },
          } as unknown as ToolUse["input"],
          output: { ok: true } as unknown as ToolUse["output"],
          display: {
            title: "Update page",
            description_truncated: false,
            server_name: "Records",
            label: updateLabel,
          },
          ...overrides,
        }}
        status={status}
        isStreaming={false}
        isCollapsed={false}
        isLastStep
        decision={decision}
      />,
    );
  const toggle = () => screen.getByRole("button", { name: /Northwind/ });

  it("says what the run did, with old → new visible while the details are folded", () => {
    labelled({});

    expect(toggle()).toHaveTextContent("Updated page Northwind");
    expect(toggle()).toHaveTextContent("Records");
    expect(screen.getByTestId("tool-call-gist-line")).toHaveAttribute(
      "title",
      "Updated page Northwind",
    );
    const values = screen.getByTestId("tool-call-gist-values");
    expect(isFolded(values)).toBe(false);
    expect(values).toHaveTextContent("Status");
    const earlier = screen.getByTestId("tool-call-gist-earlier");
    expect(earlier).toHaveTextContent("Lead");
    expect(earlier.querySelector("[data-origin]")).toHaveAttribute(
      "title",
      "Value from an earlier result in this chat",
    );
    expect(values).toHaveTextContent("Customer");
    expect(isFolded(screen.getByText(/Input Parameters/i))).toBe(true);
    expect(toggle()).not.toHaveTextContent("update_page");

    fireEvent.click(toggle());
    const identity = screen.getByTestId("tool-call-identity");
    expect(isFolded(identity)).toBe(false);
    expect(identity).toHaveTextContent("update_page");
    expect(identity).toHaveTextContent("Records");
    expect(screen.getByText("update_page")).toHaveAttribute("dir", "auto");
  });

  it("says a failed run could not, with the server's own message", () => {
    labelled(
      {
        output:
          "The page changed since it was read.\u202E" as unknown as ToolUse["output"],
      },
      "error",
      { status: "approved", alwaysAllow: false },
    );

    expect(toggle()).toHaveTextContent("Could not update page Northwind");
    expect(screen.getByText("Failed")).toBeInTheDocument();
    const message = screen.getByTestId("tool-failure-message");
    expect(message).toHaveTextContent("The page changed since it was read.");
    expect(message.textContent).not.toContain("\u202E");
    expect(message).toHaveAttribute("dir", "auto");
    expect(isFolded(message)).toBe(false);
  });

  it("frames a failed run's server message as the tool's word, with its ids masked", () => {
    const id = "aaaaaaaa-0000-4000-8000-0000000000a1";
    labelled(
      {
        output: {
          error: `User (Id=${id}, type=8, ObjectId='${id}', unitId=${id}), lacks the createRecord permission on the record.`,
        } as unknown as ToolUse["output"],
      },
      "error",
      { status: "approved", alwaysAllow: false },
    );

    const failure = screen.getByTestId("tool-failure");
    expect(failure).toHaveTextContent(/^The call failed\./);
    expect(failure).toHaveTextContent("The tool says:");
    expect(failure.textContent).not.toContain(id);
    const message = screen.getByTestId("tool-failure-message");
    expect(message).toHaveTextContent(
      "User (Id=an ID (see Technical details), type=8,",
    );
    expect(message.className).not.toContain("error");
    const more = within(failure).getByRole("button", {
      name: "Show the whole message",
    });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  it("says in Erato's words when the tool gave no answer, never as the tool's", () => {
    const erato =
      "Failed to call MCP tool: error sending request: connection refused";
    for (const [overrides, line] of [
      [
        {
          output: { status: "error", error: erato },
          result_details: { failure: "no_answer" },
        },
        "Erato got no answer from the tool. The call may or may not have run.",
      ],
      [
        {
          output: {
            status: "error",
            error: "Failed to process MCP tool output: bad file",
          },
          result_details: { failure: "answer_unreadable" },
        },
        "The tool answered, but Erato could not read its answer.",
      ],
      [
        {
          output: {
            status: "error",
            error: "The tool is not available on this device.",
          },
          result_details: { failure: "not_run" },
        },
        "Erato did not run the call.",
      ],
      // Rows stored before Erato marked its own failures.
      [
        { output: { status: "error", error: erato } },
        "Erato got no answer from the tool. The call may or may not have run.",
      ],
      [
        {
          output: {
            status: "error",
            error: "Client tool execution is unavailable for this request.",
          },
        },
        "Erato did not run the call.",
      ],
      [
        {
          output: {
            status: "error",
            error:
              "The tool 'update_page' is not available on this device; the call was not executed.",
          },
        },
        "Erato did not run the call.",
      ],
    ] as const) {
      const row = labelled(overrides as unknown as Partial<ToolUse>, "error", {
        status: "approved",
        alwaysAllow: false,
      });
      const failure = screen.getByTestId("tool-failure");
      expect(failure).toHaveTextContent(line);
      expect(failure).not.toHaveTextContent("The tool says");
      expect(failure.textContent).not.toContain("Failed to");
      row.unmount();
    }
  });

  it("never says a call failed or could not when it may have run", () => {
    const unreadable = labelled(
      {
        output: {
          status: "error",
          error: "Failed to process MCP tool output: bad file",
          mcp_output: "Page updated",
        } as unknown as ToolUse["output"],
        result_details: { failure: "answer_unreadable" },
      },
      "error",
      { status: "approved", alwaysAllow: false },
    );
    expect(screen.getByTestId("tool-failure")).not.toHaveTextContent(
      "The call failed.",
    );
    expect(toggle()).toHaveTextContent("Update page Northwind");
    expect(toggle()).not.toHaveTextContent("Could not");
    unreadable.unmount();

    const unanswered = labelled(
      {
        output: {
          status: "error",
          error: "Failed to call MCP tool: connection reset",
        } as unknown as ToolUse["output"],
        result_details: { failure: "no_answer" },
      },
      "error",
      { status: "approved", alwaysAllow: false },
    );
    expect(toggle()).toHaveTextContent("Update page Northwind");
    expect(toggle()).not.toHaveTextContent("Could not");
    unanswered.unmount();
  });

  it("says only that the call failed for a failure kind it does not know", () => {
    labelled(
      {
        output: {
          status: "error",
          error: "Failed to call MCP tool: quota",
        } as unknown as ToolUse["output"],
        result_details: { failure: "a_kind_from_a_newer_erato" },
      } as unknown as Partial<ToolUse>,
      "error",
      { status: "approved", alwaysAllow: false },
    );
    const failure = screen.getByTestId("tool-failure");
    expect(failure).toHaveTextContent(/^The call failed\.$/);
    // Erato does not know whether such a call ran.
    expect(toggle()).toHaveTextContent("Update page Northwind");
    expect(toggle()).not.toHaveTextContent("Could not");
  });

  it("never shows part of a machine ID where a long message is cut", () => {
    const id = "d26fe964-230b-42dd-8f3a-0c4e2b1a9d77";
    const lead =
      "The user is missing the delete privilege on this record. ".repeat(5);
    for (const keep of [1, 6, 12, 20]) {
      const text = `${lead.slice(0, 300 - "privilege (Id=".length - keep)}privilege (Id=${id}) and more text after it.`;
      const row = labelled(
        { output: { error: text } as unknown as ToolUse["output"] },
        "error",
        { status: "approved", alwaysAllow: false },
      );
      const message = screen.getByTestId("tool-failure-message");
      expect(message.textContent).not.toMatch(/d26fe964|230b|[0-9a-f]{4,}…/);
      row.unmount();
    }
  });

  it("keeps the asked line on a call that never ran", () => {
    labelled(
      { output: { status: "rejected" } as unknown as ToolUse["output"] },
      "error",
      { status: "denied", neverAllow: false, withdrawn: false },
    );

    expect(toggle()).toHaveTextContent("Update page Northwind");
    expect(screen.queryByTestId("tool-failure-message")).toBeNull();
  });

  it("links the result outside the toggle", () => {
    labelled({
      result_details: {
        links: [
          {
            uri: "https://records.example/pages/northwind",
            host: "records.example",
            matches_server_host: true,
            title: "Northwind",
          },
        ],
      },
    });

    const link = screen.getByRole("link", { name: "Open in Records" });
    expect(link).toHaveAttribute(
      "href",
      "https://records.example/pages/northwind",
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(toggle()).not.toContainElement(link);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it.each([
    ["another host", "https://files.example/n", "files.example", false],
    [
      "a stored match the URL contradicts",
      "https://evil.example/n",
      "records.example",
      true,
    ],
    [
      "a lookalike host",
      "https://rëcords.example/n",
      "xn--rcords-fva.example",
      false,
    ],
  ])(
    "names the host instead of the server for %s",
    (_name, uri, host, matches) => {
      labelled({
        result_details: {
          links: [{ uri, host, matches_server_host: matches }],
        },
      });

      const link = screen.getByTestId("tool-result-link");
      const shown = new URL(uri).host;
      expect(link).toHaveTextContent(`Open link - ${shown}`);
      expect(link).not.toHaveTextContent("Records");
      expect(link).toHaveAttribute("href", new URL(uri).href);
    },
  );

  it.each<[string, unknown]>([
    ["links that are not a list", { links: "https://records.example" }],
    ["a URI that is not text", { links: [{ uri: 42 }, null, "x"] }],
    ["an http link", { links: [{ uri: "http://records.example/a" }] }],
    [
      "a link with user info",
      { links: [{ uri: "https://user:pw@records.example/a" }] },
    ],
    ["a URI that does not parse", { links: [{ uri: "https://" }] }],
    [
      "a URI longer than any stored one",
      { links: [{ uri: `https://records.example/${"a".repeat(5_000)}` }] },
    ],
  ])("shows no link for %s", (_name, details) => {
    labelled({ result_details: details as ToolUse["result_details"] });

    expect(toggle()).toHaveTextContent("Updated page Northwind");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it.each<[string, unknown]>([
    ["a label that is text", "update page"],
    ["items that are not a list", { ...updateLabel, items: { a: 1 } }],
    [
      "values of the wrong types",
      {
        ...updateLabel,
        items: [
          {
            id: {
              pointer: 7,
              values: [{ path: "/page_id", text: { a: 1 } }],
            },
          },
          { id: { pointer: "/page_id", values: [null, { path: "/page_id" }] } },
        ],
      },
    ],
    ["a source from a newer server", { ...updateLabel, source: "adapter" }],
    ["a warning from a newer server", { ...updateLabel, warnings: ["x"] }],
  ])("shows %s as the plain tool row", (_name, label) => {
    labelled({
      display: {
        title: "Update page",
        description_truncated: false,
        server_name: "Records",
        label: label as typeof updateLabel,
      },
    });

    expect(
      screen.getByRole("button", { name: /update_page/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-gist-line")).toBeNull();
  });

  it("falls back to the plain row when the label cannot be read at all", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const label = { ...updateLabel };
    Object.defineProperty(label, "items", {
      get() {
        throw new Error("unreadable");
      },
    });
    labelled({
      display: {
        title: "Update page",
        description_truncated: false,
        server_name: "Records",
        label,
      },
      result_details: {
        links: [
          {
            uri: "https://records.example/pages/northwind",
            host: "records.example",
            matches_server_host: true,
          },
        ],
      },
    });

    expect(
      screen.getByRole("button", { name: /update_page/ }),
    ).toHaveTextContent("Records");
    expect(screen.queryByTestId("tool-call-gist-line")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    vi.restoreAllMocks();
  });

  it("keeps a huge failure message to a few sentences", () => {
    labelled(
      {
        output:
          `${"Quota exceeded. ".repeat(200_000)}` as unknown as ToolUse["output"],
      },
      "error",
      { status: "approved", alwaysAllow: false },
    );

    const message = screen.getByTestId("tool-failure-message");
    expect(message.textContent!.length).toBeLessThanOrEqual(301);
    expect(message.textContent!.endsWith("…")).toBe(true);
  });

  it("shows a generic label's call by its tool name, as before", () => {
    labelled({
      display: {
        title: "Update page",
        description_truncated: false,
        server_name: "Records",
        label: { action: "other", object_kind: "other", source: "generic" },
      },
    });

    expect(
      screen.getByRole("button", { name: /update_page/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-gist-line")).toBeNull();
    expect(screen.queryByTestId("tool-call-gist-values")).toBeNull();
    expect(screen.queryByTestId("tool-call-identity")).toBeNull();
  });
});

describe("ToolUseStep proposal row", () => {
  const commentChanges = (ops: string[]) => ({
    changes: ops.map((op, index) => ({
      op,
      anchor: null,
      thread: `t_${index}`,
      target: null,
      text: op === "reply" ? "Reply text A" : null,
    })),
  });
  const proposal = (
    overrides: Partial<ToolUse>,
    status: "done" | "error" = "done",
  ) =>
    render(
      <ToolUseStep
        part={{
          ...PART,
          tool_call_id: "call-comments",
          tool_name: WORD_SUBMIT_COMMENT_CHANGES_TOOL,
          status: status === "error" ? "error" : "success",
          input: commentChanges(["reply"]) as unknown as ToolUse["input"],
          output: {
            status: "success",
            result: { rows: 1 },
          } as unknown as ToolUse["output"],
          display: {
            title: WORD_SUBMIT_COMMENT_CHANGES_TOOL,
            description_truncated: false,
            label: {
              action: "comment",
              object_kind: "comment",
              source: "own_mapping",
              items: [
                {
                  fields: [
                    {
                      pointer: "/changes/*/op",
                      name: "op",
                      values: [{ path: "/changes/0/op", text: "reply" }],
                    },
                  ],
                },
              ],
            },
          },
          ...overrides,
        }}
        status={status}
        isStreaming={false}
        isCollapsed={false}
        isLastStep
      />,
    );

  it("names the proposal in one line and keeps the raw call behind the toggle", () => {
    proposal({});

    const toggle = screen.getByRole("button", { name: /Proposed/ });
    expect(toggle).toHaveTextContent("Proposed a reply to a comment");
    expect(toggle).not.toHaveTextContent(WORD_SUBMIT_COMMENT_CHANGES_TOOL);
    expect(screen.getByTestId("tool-call-proposal-line")).toHaveAttribute(
      "title",
      "Proposed a reply to a comment",
    );
    expect(screen.queryByTestId("tool-call-gist-values")).toBeNull();
    expect(screen.queryByTestId("tool-call-proposal-changes")).toBeNull();
    expect(isFolded(screen.getByText(/Input Parameters/i))).toBe(true);

    fireEvent.click(toggle);
    expect(screen.getByTestId("tool-call-identity")).toHaveTextContent(
      WORD_SUBMIT_COMMENT_CHANGES_TOOL,
    );
    expect(isFolded(screen.getByText(/Input Parameters/i))).toBe(false);
  });

  it("counts a mixed batch in the line and lists its changes without their text", () => {
    proposal({
      input: commentChanges([
        "reply",
        "resolve",
        "resolve",
      ]) as unknown as ToolUse["input"],
    });

    const toggle = screen.getByRole("button", { name: /Proposed/ });
    expect(toggle).toHaveTextContent(
      "Proposed 3 comment changes · 1 reply · 2 resolved",
    );
    const rows = screen.getByTestId("tool-call-proposal-changes");
    expect(isFolded(rows)).toBe(true);
    fireEvent.click(toggle);
    expect(isFolded(rows)).toBe(false);
    expect(
      [...rows.querySelectorAll("li")].map((row) => row.textContent),
    ).toEqual(["Reply", "Resolve", "Resolve"]);
    expect(rows).not.toHaveTextContent("Reply text A");
    expect(toggle).not.toHaveTextContent("Reply text A");
  });

  it("lists at most 50 changes of a long mixed batch and counts the rest", () => {
    const ops = Array.from({ length: 120 }, (_, index) =>
      index % 2 === 0 ? "reply" : "resolve",
    );
    proposal({ input: commentChanges(ops) as unknown as ToolUse["input"] });

    expect(screen.getByRole("button", { name: /Proposed/ })).toHaveTextContent(
      "Proposed 120 comment changes · 60 replies · 60 resolved",
    );
    const rows = screen.getByTestId("tool-call-proposal-changes");
    expect(rows.querySelectorAll("li[data-op]")).toHaveLength(50);
    expect(
      screen.getByTestId("tool-call-proposal-changes-more"),
    ).toHaveTextContent("+70 more");
  });

  it("shows a proposal whose stored label is malformed without breaking the row", () => {
    proposal({
      display: {
        title: WORD_SUBMIT_COMMENT_CHANGES_TOOL,
        description_truncated: false,
        label: {
          action: "comment",
          object_kind: "comment",
          source: "own_mapping",
          items: [{ fields: [null, { name: "op", pointer: 42 }] }],
        } as unknown as ToolCallLabel,
      },
    });

    expect(screen.getByTestId("tool-call-proposal-line")).toHaveTextContent(
      "Proposed comment changes",
    );
  });

  it("says a proposal the host refused could not be made", () => {
    proposal(
      {
        output: {
          status: "error",
          error: "Submission validation failed",
        } as unknown as ToolUse["output"],
      },
      "error",
    );

    expect(screen.getByRole("button", { name: /propose/ })).toHaveTextContent(
      "Could not propose a reply to a comment",
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("names the action a client action call proposes", () => {
    proposal({
      tool_name: "propose_client_action",
      input: { action: "outlook.reply" } as unknown as ToolUse["input"],
      display: {
        title: "propose_client_action",
        description_truncated: false,
        label: { action: "send", object_kind: "email", source: "own_mapping" },
      },
    });
    expect(screen.getByTestId("tool-call-proposal-line")).toHaveTextContent(
      "Proposed an email",
    );
  });

  it("shows an old row without a label by its tool name, as before", () => {
    proposal({ display: undefined });

    expect(
      screen.getByRole("button", {
        name: new RegExp(WORD_SUBMIT_COMMENT_CHANGES_TOOL),
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-proposal-line")).toBeNull();
    expect(screen.queryByTestId("tool-call-identity")).toBeNull();
  });
});
