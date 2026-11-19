import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OwnCallApprovalItem } from "./OwnCallApprovalItem";

import type { ToolDisplayMetadata } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "icon-id",
}));

const broken = { gist: false, argumentView: false };

vi.mock("@/components/ui/ToolCall/ToolCallGist", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/ui/ToolCall/ToolCallGist")
    >();
  return {
    ...actual,
    ToolCallGist: (props: Parameters<typeof actual.ToolCallGist>[0]) => {
      if (broken.gist) throw new Error("gist failed");
      return actual.ToolCallGist(props);
    },
  };
});

vi.mock("@/components/ui/ToolCall/ToolArgumentView", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/ui/ToolCall/ToolArgumentView")
    >();
  return {
    ...actual,
    ToolArgumentView: (
      props: Parameters<typeof actual.ToolArgumentView>[0],
    ) => {
      if (broken.argumentView) throw new Error("view failed");
      return actual.ToolArgumentView(props);
    },
  };
});

const input = { title: "Hiring", visibility: "private" };

const display: ToolDisplayMetadata = {
  title: "Create folder",
  description_truncated: false,
  server_name: "Records",
  label: {
    action: "create",
    object_kind: "folder",
    source: "rules",
    arguments: {
      path: "",
      kind: "group",
      children: [
        { path: "/title", kind: "value" },
        { path: "/visibility", kind: "value" },
      ],
    },
    items: [
      {
        title: {
          pointer: "/title",
          values: [{ path: "/title", text: "Hiring" }],
        },
      },
    ],
  },
};

const renderItem = (
  shown: ToolDisplayMetadata = display,
  onDecide = vi.fn(),
) => {
  const ui = (value: ToolDisplayMetadata) => (
    <OwnCallApprovalItem
      toolName="create_folder"
      display={value}
      input={input}
      serverId="records"
      isClientTool={false}
      openWorld={false}
      allowAlways
      status="pending"
      resolvedLabel={undefined}
      isBusy={false}
      scrollIntoViewOnMount={false}
      onDecide={onDecide}
    />
  );
  const result = render(ui(shown));
  return {
    ...result,
    onDecide,
    rerenderWith: (next: ToolDisplayMetadata) => result.rerender(ui(next)),
  };
};

describe("ApprovalReferent", () => {
  afterEach(() => {
    broken.gist = false;
    broken.argumentView = false;
    vi.restoreAllMocks();
  });

  it("falls back to the tool heading and raw input when the gist fails to render, and the buttons still decide", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    broken.gist = true;
    const { onDecide } = renderItem();

    expect(screen.queryByTestId("tool-call-gist")).not.toBeInTheDocument();
    expect(screen.getByText("Create folder")).toBeInTheDocument();
    expect(screen.getByText("Records")).toBeInTheDocument();
    expect(screen.getByText("Input Parameters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onDecide).toHaveBeenCalledWith("approve");
  });

  it("keeps the raw input in the details when the generic card's argument view fails there", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    broken.argumentView = true;
    const { onDecide } = renderItem({
      ...display,
      label: { ...display.label!, source: "generic", items: [] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.queryByTestId("tool-argument-view")).not.toBeInTheDocument();
    expect(screen.getByText("Input Parameters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onDecide).toHaveBeenCalledWith("reject");
  });

  it("describes a call with no verb in one sentence above what it changes, its arguments in the details, without claiming a loss", () => {
    renderItem({
      ...display,
      label: {
        ...display.label!,
        action: "other",
        object_kind: "other",
        change: {
          recipients: {
            total: 1,
            groups: [
              {
                name: "To",
                raw_name: "to",
                kind: "to",
                count: 1,
                values: ["ana@fabrikam.example"],
              },
            ],
            outside: ["ana@fabrikam.example"],
            outside_known: true,
          },
          counts: {},
          complete: true,
        } as unknown as ToolDisplayMetadata["label"] extends infer L
          ? L extends { change?: infer C }
            ? C
            : never
          : never,
      },
    });
    expect(screen.getByTestId("approval-call-sentence")).toHaveTextContent(
      /^Create folder in Records$/,
    );
    expect(
      screen.getByTestId("tool-call-change-outside-badge"),
    ).toHaveTextContent("outside your organisation");
    expect(screen.queryByTestId("tool-argument-view")).toBeNull();
    expect(screen.queryByTestId("tool-call-change-emptied")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByTestId("tool-argument-view")).toHaveTextContent(
      "Hiring",
    );
  });

  it("tries the label again once a new one arrives", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    broken.gist = true;
    const { rerenderWith } = renderItem();
    expect(screen.queryByTestId("tool-call-gist")).not.toBeInTheDocument();

    broken.gist = false;
    rerenderWith({ ...display, label: { ...display.label! } });

    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      "Create folder Hiring",
    );
    expect(screen.getByTestId("tool-call-other-arguments")).toHaveTextContent(
      "private",
    );
  });

  it("renders a descriptor whose text fields are not text", () => {
    renderItem({
      ...display,
      title: { text: "x" },
      server_name: ["Records"],
      description: 42,
    } as unknown as ToolDisplayMetadata);

    expect(screen.getByTestId("tool-call-gist-line")).toBeInTheDocument();
    expect(screen.getByText("records")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Allow once" }),
    ).toBeInTheDocument();
  });
});
