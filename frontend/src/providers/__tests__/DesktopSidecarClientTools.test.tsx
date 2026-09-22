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
