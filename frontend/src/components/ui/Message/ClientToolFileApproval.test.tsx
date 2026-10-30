import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useClientToolFileApproval } from "@/hooks/chat/useClientToolFileApproval";
import { fetchProfile } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { OutlookSourceNavigationProvider } from "@/providers/OutlookSourceNavigationProvider";

import { ClientToolFileApprovals } from "./ClientToolFileApproval";

import type {
  OutlookFileProvenance,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchProfile: vi.fn(),
}));
vi.mock("@/providers/DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({
    snapshot: {
      state: "ready",
      discoveryExtensions: {
        "x-erato-outlook-navigation": {
          version: 1,
          target: "classicOutlook",
          launchUriPrefix: "erato-launch://outlook/open?reference=",
          maxReferenceBytes: 16384,
        },
      },
    },
  }),
}));
vi.mock("../FileUpload/AttachmentTile", () => ({
  AttachmentTile: ({
    file,
    selection,
    onActivate,
  }: {
    file: File;
    selection: { selected: boolean; onToggle: () => void };
    onActivate: () => void;
  }) => (
    <div>
      <label>
        <input
          type="checkbox"
          checked={selection.selected}
          onChange={selection.onToggle}
        />
        {file.name}
      </label>
      <button onClick={onActivate}>Preview {file.name}</button>
    </div>
  ),
}));
vi.mock("../FilePreview/FilePreviewContent", () => ({
  FilePreviewContent: ({ url }: { url: string }) => (
    <div data-testid="preview">{url}</div>
  ),
}));
let approveFiles: ReturnType<typeof useClientToolFileApproval>["approveFiles"];
const context = { chatId: "chat", messageId: "message", toolCallId: "call" };
function Harness({
  messageId = "message",
  taskBriefsByChatId,
}: {
  messageId?: string;
  taskBriefsByChatId?: ReadonlyMap<string, string | undefined>;
}) {
  const approval = useClientToolFileApproval();
  approveFiles = approval.approveFiles;
  return (
    <ClientToolFileApprovals
      messageId={messageId}
      taskBriefsByChatId={taskBriefsByChatId}
    />
  );
}
const files = [
  new File(["first"], "first.txt"),
  new File(["second"], "second.txt"),
];
beforeEach(() => {
  vi.mocked(fetchProfile).mockReset();
  vi.mocked(fetchProfile).mockResolvedValue({
    client_tool_file_approval: "ask",
  } as UserProfile);
});
it("previews local bytes and returns only selected files", async () => {
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:local-preview");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  render(<Harness />);
  let result!: Promise<ReadonlySet<File>>;
  await act(async () => {
    result = approveFiles(files, context);
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview first.txt" }));
  expect(create).toHaveBeenCalledWith(files[0]);
  expect(screen.getByTestId("preview")).toHaveTextContent("blob:local-preview");
  expect(
    screen.getByRole("dialog", { name: "Preview: first.txt" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
  expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  expect(revoke).toHaveBeenCalledWith("blob:local-preview");
  expect(screen.getByRole("checkbox", { name: "first.txt" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Preview first.txt" }));
  expect(screen.getByTestId("preview")).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Preview second.txt" }));
  expect(create).toHaveBeenLastCalledWith(files[1]);
  fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "second.txt" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Upload selected files" }),
  );
  expect(await result).toEqual(new Set([files[0]]));
  expect(revoke).toHaveBeenCalledWith("blob:local-preview");
});
it.each(["office", "desktop"])(
  "opens the containing email through %s before consent without approving or selecting files",
  async (host) => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-preview");
    const parent = {
      external_ids: [
        { key: "ews_id", value: "containing-email" },
        { key: "email_message_id", value: "<parent@example.test>" },
      ],
      mailbox: { emailAddress: "shared@example.test" },
    };
    const provenance: OutlookFileProvenance = {
      version: 1,
      origins: [{ topLevelParent: parent }],
    };
    const open = vi.fn(async () => {});
    const settled = vi.fn();
    render(
      <OutlookSourceNavigationProvider
        navigator={host === "office" ? { canOpen: () => true, open } : null}
      >
        <Harness />
      </OutlookSourceNavigationProvider>,
    );
    let result!: Promise<ReadonlySet<File>>;
    await act(async () => {
      result = approveFiles(files, context, new Map([[files[0], provenance]]));
      void result.then(settled);
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "first.txt" }));
    const role = host === "office" ? "button" : "link";
    const action = screen.getByRole(role, { name: "Open in Outlook" });
    if (host === "desktop") {
      const encoded = action.getAttribute("href")!.split("reference=")[1];
      expect(
        JSON.parse(
          globalThis.atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
        ),
      ).toEqual(parent);
      action.addEventListener("click", (event) => event.preventDefault());
    }
    await act(async () => {
      fireEvent.click(action);
    });
    if (host === "office") expect(open).toHaveBeenCalledExactlyOnceWith(parent);
    expect(settled).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: "first.txt" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Preview first.txt" }));
    expect(
      within(screen.getByRole("dialog")).getByRole(role, {
        name: "Open in Outlook",
      }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(settled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(await result).toEqual(new Set());
  },
);
it.each(["never_allow", "always_allow"] as const)(
  "honors backend policy %s without prompting",
  async (policy) => {
    vi.mocked(fetchProfile).mockResolvedValue({
      client_tool_file_approval: policy,
    } as UserProfile);
    render(<Harness />);
    expect(await approveFiles(files, context)).toEqual(
      new Set(policy === "always_allow" ? files : []),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);
it.each(["abort", "unmount", "reject"])(
  "rejects pending files on %s",
  async (mode) => {
    const controller = new AbortController();
    const { unmount } = render(<Harness />);
    let result!: Promise<ReadonlySet<File>>;
    await act(async () => {
      result = approveFiles(files, { ...context, signal: controller.signal });
    });
    await act(async () => {
      if (mode === "abort") controller.abort();
      else if (mode === "unmount") unmount();
      else fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    });
    expect(await result).toEqual(new Set());
  },
);
it("fails closed when the backend preference cannot be read", async () => {
  vi.mocked(fetchProfile).mockRejectedValue(new Error("offline"));
  render(<Harness />);
  await expect(approveFiles(files, context)).rejects.toThrow("offline");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps approvals with their originating messages when navigating and holds the queue", async () => {
  const { rerender } = render(<Harness />);
  let first!: Promise<ReadonlySet<File>>;
  let second!: Promise<ReadonlySet<File>>;
  await act(async () => {
    first = approveFiles(files, context);
    second = approveFiles([files[0]], {
      ...context,
      messageId: "second-message",
      toolCallId: "second-call",
    });
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(useConfirmationRegistryStore.getState().hasPending("chat")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "second.txt" }));
  rerender(<Harness messageId="unrelated-message" />);
  expect(
    screen.queryByTestId("client-tool-file-approval"),
  ).not.toBeInTheDocument();
  rerender(<Harness messageId="second-message" />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Upload selected files" }),
  );
  expect(await second).toEqual(new Set([files[0]]));
  expect(useConfirmationRegistryStore.getState().hasPending("chat")).toBe(true);
  rerender(<Harness />);
  expect(
    screen.getByRole("checkbox", { name: "second.txt" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
  expect(await first).toEqual(new Set());
  expect(useConfirmationRegistryStore.getState().hasPending("chat")).toBe(
    false,
  );
});

describe("a delegated task's file approval", () => {
  const taskCall = {
    chatId: "task-chat",
    messageId: "task-message",
    toolCallId: "task-call",
    hostGrant: {
      ownerChatId: "owner-chat",
      ownerMessageId: "owner-message",
      requestingChatId: "task-chat",
      requestingMessageId: "task-message",
    },
  };
  afterEach(() => {
    useGenerationStatusStore.getState().reset();
  });

  const ownerStatus = () =>
    useGenerationStatusStore.getState().statusByChatId["owner-chat"];

  it("asks in the owner chat and gives back its running turn once answered", async () => {
    const startedAt = "2026-10-30T10:00:00.000Z";
    useGenerationStatusStore.getState().seedRunning("owner-chat", startedAt);
    render(<Harness messageId="owner-message" />);
    let result!: Promise<ReadonlySet<File>>;
    await act(async () => {
      result = approveFiles(files, taskCall);
    });
    const registry = useConfirmationRegistryStore.getState();
    expect(registry.hasPending("owner-chat")).toBe(true);
    expect(registry.hasPending("task-chat")).toBe(false);
    expect(
      useGenerationStatusStore.getState().statusByChatId["owner-chat"],
    ).toMatchObject({ kind: "action_required" });
    expect(
      useGenerationStatusStore.getState().statusByChatId["task-chat"],
    ).toBeUndefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Upload selected files" }),
    );
    expect(await result).toEqual(new Set(files));
    expect(
      useConfirmationRegistryStore.getState().hasPending("owner-chat"),
    ).toBe(false);
    expect(ownerStatus()).toMatchObject({ kind: "running", startedAt });
    // The poll keeps reporting the generation the prompt interrupted.
    useGenerationStatusStore
      .getState()
      .applyPollSnapshot([
        { chat_id: "owner-chat", state: "running", started_at: startedAt },
      ]);
    expect(ownerStatus()).toMatchObject({ kind: "running", startedAt });
  });

  it("leaves a parked owner parked and an unknown one unknown once answered", async () => {
    render(<Harness messageId="owner-message" />);
    await act(async () => {
      void approveFiles(files, taskCall);
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(ownerStatus()).toBeUndefined();

    const parkedAt = "2026-10-30T10:00:00.000Z";
    useGenerationStatusStore
      .getState()
      .seedActionRequired("owner-chat", parkedAt);
    let result!: Promise<ReadonlySet<File>>;
    await act(async () => {
      result = approveFiles(files, taskCall);
    });
    expect(ownerStatus()).not.toMatchObject({ startedAt: parkedAt });
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(await result).toEqual(new Set());
    expect(ownerStatus()).toMatchObject({
      kind: "action_required",
      startedAt: parkedAt,
    });
  });

  it("gives the owner back its turn only after the last of two task prompts", async () => {
    const startedAt = "2026-10-30T10:00:00.000Z";
    useGenerationStatusStore.getState().seedRunning("owner-chat", startedAt);
    render(<Harness messageId="owner-message" />);
    let first!: Promise<ReadonlySet<File>>;
    await act(async () => {
      first = approveFiles(files, taskCall);
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    let second!: Promise<ReadonlySet<File>>;
    await act(async () => {
      second = approveFiles(files, {
        ...taskCall,
        chatId: "task-chat-2",
        toolCallId: "task-call-2",
        hostGrant: {
          ...taskCall.hostGrant,
          requestingChatId: "task-chat-2",
        },
      });
    });
    const rejectButtons = () =>
      screen.getAllByRole("button", { name: "Reject all" });
    fireEvent.click(rejectButtons()[0]);
    await first;
    expect(ownerStatus()).toMatchObject({ kind: "action_required" });
    fireEvent.click(rejectButtons()[0]);
    await second;
    expect(ownerStatus()).toMatchObject({ kind: "running", startedAt });
  });

  it("shows on the message that started the task and names the task", async () => {
    const { rerender } = render(<Harness messageId="task-message" />);
    let result!: Promise<ReadonlySet<File>>;
    await act(async () => {
      result = approveFiles(files, taskCall);
    });
    expect(
      screen.queryByTestId("client-tool-file-approval"),
    ).not.toBeInTheDocument();
    rerender(
      <Harness
        messageId="owner-message"
        taskBriefsByChatId={new Map([["task-chat", "Search Jane's mail"]])}
      />,
    );
    expect(
      screen.getByTestId("client-tool-file-approval-task"),
    ).toHaveTextContent("Requested by a task: Search Jane's mail");
    expect(
      screen.getByTestId("client-tool-file-approval-open-task"),
    ).toHaveAttribute("href", expect.stringContaining("task-chat"));
    rerender(<Harness messageId="owner-message" />);
    expect(
      screen.getByTestId("client-tool-file-approval-task"),
    ).toHaveTextContent("Requested by a task: A task this response started");
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(await result).toEqual(new Set());
  });

  it("names no task on the user's own call", async () => {
    render(<Harness />);
    await act(async () => {
      void approveFiles(files, context);
    });
    expect(
      screen.queryByTestId("client-tool-file-approval-task"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
  });
});
