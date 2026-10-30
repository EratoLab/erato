import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getChildClientToolHeaders,
  getClientToolHeaders,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { executorStreamHeaderSets } from "@/lib/clientOperations/executorStream";
import { clientOperationHandlerRegistry } from "@/lib/clientOperations/handlers";
import {
  createSidecarChatTools,
  SIDECAR_CHAT_TOOL_METHODS,
} from "@/lib/desktopSidecar/chatTools";
import { fetchUploadFile } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { DesktopSidecarClientTools } from "../DesktopSidecarClientTools";

import type { SidecarChatTool } from "@/lib/desktopSidecar/chatTools";
import type { SidecarSnapshot } from "@erato/desktop-sidecar-protocol";

const sidecar = vi.hoisted((): { snapshot: Partial<SidecarSnapshot> } => ({
  snapshot: { state: "ready" },
}));

vi.mock("@/hooks/chat/useClientToolFileApproval", () => ({
  useClientToolFileApproval: () => ({
    approveFiles: vi.fn(async (files: File[]) => new Set(files)),
  }),
}));
vi.mock("@/lib/desktopSidecar/chatTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktopSidecar/chatTools")>()),
  createSidecarChatTools: vi.fn(() => []),
}));
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchUploadFile: vi.fn(),
}));
vi.mock("../DesktopSidecarProvider", () => {
  const client = { getSnapshot: () => sidecar.snapshot };
  return {
    useDesktopSidecar: () => ({ client, snapshot: sidecar.snapshot }),
  };
});
vi.mock("../FeatureConfigProvider", () => ({
  useUploadFeature: () => ({ enabled: true, maxSizeBytes: 1000 }),
  useChatInputFeature: () => ({ maxFiles: 10 }),
}));

describe("DesktopSidecarClientTools uploads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends provenance before file bytes so it survives API persistence", async () => {
    vi.mocked(fetchUploadFile).mockResolvedValue({
      files: [{ id: "file-id" }],
    } as Awaited<ReturnType<typeof fetchUploadFile>>);
    render(<DesktopSidecarClientTools />);
    const options = vi.mocked(createSidecarChatTools).mock.calls[0][1];
    const provenance = {
      version: 1,
      origins: [
        {
          topLevelParent: {
            external_ids: [
              { key: "email_message_id", value: "<mail@example.test>" },
            ],
            mailbox: { emailAddress: "shared@example.test" },
          },
        },
      ],
    };
    await options.uploadAttachment(
      new File(["pdf"], "a.pdf"),
      "chat-id",
      undefined,
      undefined,
      provenance,
    );
    const body = vi.mocked(fetchUploadFile).mock.calls[0][0]
      .body as unknown as FormData;
    expect([...body.keys()]).toEqual(["outlook_provenance", "file"]);
    expect(JSON.parse(body.get("outlook_provenance") as string)).toEqual(
      provenance,
    );
  });

  it.each([undefined, "AAMk+opaque/id==&value%"])(
    "preserves an EWS ID when provided and omits absent metadata (%s)",
    async (externalIdEwsId) => {
      vi.mocked(fetchUploadFile).mockResolvedValue({
        files: [{ id: "file-id" }],
      } as Awaited<ReturnType<typeof fetchUploadFile>>);
      render(<DesktopSidecarClientTools />);
      const options = vi.mocked(createSidecarChatTools).mock.calls[0][1];
      const file = new File(["source"], "source.txt");
      const signal = new AbortController().signal;

      expect(
        await options.uploadAttachment(
          file,
          "chat-id",
          signal,
          externalIdEwsId,
        ),
      ).toEqual({ id: "file-id" });

      const [request, requestSignal] = vi.mocked(fetchUploadFile).mock.calls[0];
      expect(request.queryParams).toStrictEqual(
        externalIdEwsId === undefined
          ? { chat_id: "chat-id" }
          : { chat_id: "chat-id", external_id_ews_id: externalIdEwsId },
      );
      expect((request.body as unknown as FormData).get("file")).toMatchObject({
        name: file.name,
        size: file.size,
        type: file.type,
      });
      expect(requestSignal).toBe(signal);
    },
  );
});

describe("DesktopSidecarClientTools for delegated tasks", () => {
  const names = SIDECAR_CHAT_TOOL_METHODS.map(({ name }) => name).sort();
  const binding = {
    device_id: expect.any(String),
    realm: "desktop-sidecar",
    host_context: { kind: "desktop_sidecar", identity: "local" },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    // Each tool is available while the app is ready in normal mode, as the
    // real tools are.
    vi.mocked(createSidecarChatTools).mockImplementation(() =>
      SIDECAR_CHAT_TOOL_METHODS.map(
        ({ name, method }): SidecarChatTool => ({
          name,
          method,
          isAvailable: () =>
            sidecar.snapshot.state === "ready" &&
            !sidecar.snapshot.localDelegation,
          execute: vi.fn(),
        }),
      ),
    );
  });
  afterEach(() => {
    resetClientToolRegistryForTests();
    sidecar.snapshot = { state: "ready" };
  });

  it("sends the app's binding beside the primary one and takes the tasks' calls", () => {
    const { unmount } = render(<DesktopSidecarClientTools />);
    const headers = getClientToolHeaders();
    expect(headers).not.toHaveProperty("X-Erato-Executor");
    expect(JSON.parse(headers["X-Erato-Additional-Executors"])).toEqual([
      binding,
    ]);
    expect(headers["X-Erato-Client-Tools"]).toBe(names.join(","));
    expect(getChildClientToolHeaders()["X-Erato-Child-Client-Tools"]).toBe(
      names.join(","),
    );
    expect(executorStreamHeaderSets()).toEqual([
      {
        headers: {
          "X-Erato-Executor": JSON.stringify(
            JSON.parse(headers["X-Erato-Additional-Executors"])[0],
          ),
          "X-Erato-Client-Tools": names.join(","),
          "X-Erato-Child-Client-Tools": names.join(","),
        },
        shared: true,
      },
    ]);
    expect(
      clientOperationHandlerRegistry
        .handlers()
        .map((handler) => handler.executor()),
    ).toEqual(names.map(() => binding));
    unmount();
    expect(getClientToolHeaders()).not.toHaveProperty(
      "X-Erato-Additional-Executors",
    );
    expect(clientOperationHandlerRegistry.handlers()).toEqual([]);
  });

  it.each<[string, Partial<SidecarSnapshot>]>([
    ["is not running when the user sends", { state: "unavailable" }],
    [
      "declares strict local delegation",
      {
        state: "ready",
        localDelegation: { enforcement: "unavailable" },
        strictLocalDelegation: false,
      },
    ],
  ])("offers no binding and no tool while the app %s", (_name, snapshot) => {
    sidecar.snapshot = snapshot;
    render(<DesktopSidecarClientTools />);
    expect(getClientToolHeaders()).toEqual({ "X-Erato-Client-Tools": "" });
    expect(getChildClientToolHeaders()).toEqual({});
    expect(executorStreamHeaderSets()).toEqual([]);
  });

  it("asks for a sweep when the app comes or goes", () => {
    const sweep = vi.spyOn(clientOperationHandlerRegistry, "nudge");
    const { rerender } = render(<DesktopSidecarClientTools />);
    const before = sweep.mock.calls.length;
    sidecar.snapshot = { state: "unavailable" };
    rerender(<DesktopSidecarClientTools />);
    expect(sweep.mock.calls.length).toBeGreaterThan(before);
    sweep.mockRestore();
  });
});
