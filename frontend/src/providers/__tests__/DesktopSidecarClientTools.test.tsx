import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSidecarChatTools } from "@/lib/desktopSidecar/chatTools";
import { fetchUploadFile } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { DesktopSidecarClientTools } from "../DesktopSidecarClientTools";

vi.mock("@/hooks/chat/useClientToolFileApproval", () => ({
  useClientToolFileApproval: () => ({
    approveFiles: vi.fn(async (files: File[]) => new Set(files)),
  }),
}));
vi.mock("@/lib/desktopSidecar/chatTools", () => ({
  createSidecarChatTools: vi.fn(() => []),
}));
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchUploadFile: vi.fn(),
}));
vi.mock("../DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({ client: {} }),
}));
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
